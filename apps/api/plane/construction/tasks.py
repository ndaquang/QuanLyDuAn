# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Daily reminders: tasks due soon, overdue tasks, projects behind schedule."""

from datetime import timedelta

from celery import shared_task
from django.utils import timezone

from plane.db.models import Issue
from plane.db.models.state import StateGroup
from plane.utils.exception_logger import log_exception

from .models import Notification, ProjectProfile, ScheduleItem
from .services import notifications
from .services.progress import is_behind, leaves, project_progress

DUE_SOON_DAYS = 2
OPEN_GROUPS = [StateGroup.BACKLOG.value, StateGroup.UNSTARTED.value, StateGroup.STARTED.value]


def run_reminders(today=None):
    today = today or timezone.localdate()
    stamp = today.isoformat()
    sent = 0
    profiles = ProjectProfile.objects.filter(project__archived_at__isnull=True).select_related("project", "workspace")
    by_project = {p.project_id: p for p in profiles}
    ids = list(by_project)

    items = leaves(
        ScheduleItem.objects.filter(
            project_id__in=ids, assignee__isnull=False, end_date__lte=today + timedelta(days=DUE_SOON_DAYS)
        )
    ).exclude(status=ScheduleItem.Status.COMPLETED)
    for item in items.select_related("project"):
        profile = by_project[item.project_id]
        overdue = item.end_date < today
        recipients = [item.assignee_id] + ([profile.manager_id] if overdue and profile.manager_id else [])
        sent += notifications.notify(
            profile.workspace,
            recipients,
            Notification.Type.TASK_OVERDUE if overdue else Notification.Type.TASK_DUE_SOON,
            (f"Quá hạn {(today - item.end_date).days} ngày: " if overdue else f"Sắp đến hạn {item.end_date:%d/%m}: ")
            + f"{item.code} {item.name}",
            message=f"Dự án {item.project.name} - hoàn thành {item.progress}%",
            project_id=item.project_id,
            entity_type="schedule_item",
            entity_id=item.id,
            link=f"/schedule?project={item.project_id}&item={item.id}",
            dedup_key=f"{'overdue' if overdue else 'due'}:schedule:{item.id}:{stamp}",
        )

    tasks = (
        Issue.issue_objects.filter(
            project_id__in=ids, target_date__lte=today + timedelta(days=DUE_SOON_DAYS), state__group__in=OPEN_GROUPS
        )
        .prefetch_related("assignees")
        .select_related("project")
    )
    for task in tasks:
        profile = by_project[task.project_id]
        overdue = task.target_date < today
        sent += notifications.notify(
            profile.workspace,
            [u.id for u in task.assignees.all()],
            Notification.Type.TASK_OVERDUE if overdue else Notification.Type.TASK_DUE_SOON,
            ("Công việc quá hạn: " if overdue else f"Công việc sắp đến hạn {task.target_date:%d/%m}: ") + task.name,
            message=f"Dự án {task.project.name}",
            project_id=task.project_id,
            entity_type="task",
            entity_id=task.id,
            link=f"/tasks/{task.id}",
            dedup_key=f"{'overdue' if overdue else 'due'}:task:{task.id}:{stamp}",
        )

    progress = project_progress(ids, today)
    for pid, profile in by_project.items():
        if profile.manager_id and is_behind(profile, progress[pid], today):
            # Weekly reminder (ISO week) is enough for project-level delays.
            week = f"{today.isocalendar()[0]}-W{today.isocalendar()[1]}"
            sent += notifications.notify(
                profile.workspace,
                [profile.manager_id],
                Notification.Type.SCHEDULE_DELAYED,
                f"Dự án {profile.code} đang chậm tiến độ",
                message=f"Kế hoạch {progress[pid]['planned']}% - thực tế {progress[pid]['actual']}%",
                project_id=pid,
                entity_type="project",
                entity_id=pid,
                link=f"/projects/{pid}",
                dedup_key=f"delayed:{pid}:{week}",
            )
    return sent


@shared_task
def construction_daily_reminders():
    try:
        return run_reminders()
    except Exception as e:
        log_exception(e)
        return 0
