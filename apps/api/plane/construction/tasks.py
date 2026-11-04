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
    sent += tender_reminders(today)
    return sent


TENDER_SUBMISSION_ALERT_DAYS = (7, 3, 1, 0)
CAPABILITY_EXPIRY_DAYS = 30


def tender_reminders(today):
    """Tender deadlines, assigned tender tasks and expiring capability documents."""
    from .models import CapabilityDocument, Employee, Tender, TenderItem

    stamp = today.isoformat()
    sent = 0
    open_tenders = Tender.objects.filter(status__in=(Tender.Status.SCREENING, Tender.Status.PREPARING)).select_related(
        "workspace"
    )
    for t in open_tenders:
        days = (timezone.localtime(t.submission_deadline).date() - today).days
        if days in TENDER_SUBMISSION_ALERT_DAYS:
            assignees = set(
                TenderItem.objects.filter(tender=t)
                .exclude(status=TenderItem.Status.DONE)
                .values_list("assignee_id", flat=True)
            )
            when = "HÔM NAY" if days == 0 else f"còn {days} ngày"
            sent += notifications.notify(
                t.workspace,
                {t.owner_id, *assignees} - {None},
                Notification.Type.TENDER_DEADLINE,
                f"[{t.code}] Hạn nộp thầu {when} ({timezone.localtime(t.submission_deadline):%d/%m %H:%M}): {t.name}",
                message="Kiểm tra mọi công việc đã hoàn thành và hồ sơ đã đủ.",
                entity_type="tender",
                entity_id=t.id,
                link=f"/tenders/{t.id}",
                dedup_key=f"tender:submission:{t.id}:{stamp}",
            )
        for kind, label, value in (
            ("clarification", "Hạn hỏi đáp làm rõ HSMT", t.clarification_deadline),
            ("site_visit", "Khảo sát hiện trường", t.site_visit_date and timezone.localtime(t.site_visit_date).date()),
            (
                "pre_bid",
                "Hội nghị tiền đấu thầu",
                t.pre_bid_meeting_date and timezone.localtime(t.pre_bid_meeting_date).date(),
            ),
        ):
            if value and 0 <= (value - today).days <= 1:
                sent += notifications.notify(
                    t.workspace,
                    [t.owner_id] if t.owner_id else [],
                    Notification.Type.TENDER_DEADLINE,
                    f"[{t.code}] {label} {'hôm nay' if value == today else 'ngày mai'}: {t.name}",
                    entity_type="tender",
                    entity_id=t.id,
                    link=f"/tenders/{t.id}",
                    dedup_key=f"tender:{kind}:{t.id}:{stamp}",
                )

    items = (
        TenderItem.objects.filter(
            tender__status__in=(Tender.Status.SCREENING, Tender.Status.PREPARING),
            tender__deleted_at__isnull=True,
            assignee__isnull=False,
            due_date__lte=today + timedelta(days=1),
        )
        .exclude(status=TenderItem.Status.DONE)
        .select_related("tender", "tender__workspace")
    )
    for item in items:
        overdue = item.due_date < today
        recipients = [item.assignee_id] + ([item.tender.owner_id] if overdue and item.tender.owner_id else [])
        sent += notifications.notify(
            item.tender.workspace,
            recipients,
            Notification.Type.TASK_OVERDUE if overdue else Notification.Type.TASK_DUE_SOON,
            f"[{item.tender.code}] {'Quá hạn' if overdue else 'Sắp đến hạn'} công việc thầu: {item.name}",
            entity_type="tender_item",
            entity_id=item.id,
            link=f"/tenders/{item.tender_id}?tab=tasks&item={item.id}",
            dedup_key=f"tender:item:{item.id}:{stamp}",
        )

    week = f"{today.isocalendar()[0]}-W{today.isocalendar()[1]}"
    expiring = CapabilityDocument.objects.filter(
        is_active=True, expiry_date__isnull=False, expiry_date__lte=today + timedelta(days=CAPABILITY_EXPIRY_DAYS)
    ).select_related("workspace")
    for doc in expiring:
        keepers = Employee.objects.filter(
            workspace=doc.workspace,
            status=Employee.Status.ACTIVE,
            user__isnull=False,
            role__role_permissions__permission__code="capability.update",
        ).values_list("user_id", flat=True)
        state = "ĐÃ HẾT HẠN" if doc.expiry_date < today else f"hết hạn {doc.expiry_date:%d/%m/%Y}"
        sent += notifications.notify(
            doc.workspace,
            set(keepers),
            Notification.Type.DOCUMENT_EXPIRY,
            f"Hồ sơ năng lực {state}: {doc.title}",
            message="Cập nhật bản mới để dùng cho các gói thầu.",
            entity_type="capability",
            entity_id=doc.id,
            link=f"/capabilities?id={doc.id}",
            dedup_key=f"capability:{doc.id}:{week}",
        )
    return sent


@shared_task
def construction_daily_reminders():
    try:
        return run_reminders()
    except Exception as e:
        log_exception(e)
        return 0
