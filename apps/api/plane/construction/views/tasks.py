# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Module 6 - assigned work ("Công việc").

Tasks are Plane issues, so they also appear in Plane's own boards/lists and keep a single
source of truth. This API adds the construction access rules and a Vietnamese status model.
"""

from html import escape

from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from django.utils.html import strip_tags
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response

from plane.db.models import Issue, IssueAssignee, IssueComment, ProjectMember, State
from plane.db.models.state import StateGroup

from ..exports import xlsx_response
from ..models import Attachment, Notification
from ..serializers import user_brief
from ..services import audit, notifications
from .base import CxViewSet, paginate

STATUS_GROUPS = {
    "todo": [StateGroup.BACKLOG.value, StateGroup.UNSTARTED.value],
    "in_progress": [StateGroup.STARTED.value],
    "done": [StateGroup.COMPLETED.value],
    "cancelled": [StateGroup.CANCELLED.value],
}
GROUP_STATUS = {g: s for s, groups in STATUS_GROUPS.items() for g in groups}
PRIORITIES = {"urgent", "high", "medium", "low", "none"}


def _text_to_html(text):
    text = (text or "").strip()
    if not text:
        return "<p></p>"
    return "".join(f"<p>{escape(line)}</p>" for line in text.splitlines() if line.strip()) or "<p></p>"


def _parse_date(value, field):
    if value in (None, ""):
        return None
    from datetime import date

    try:
        return date.fromisoformat(str(value))
    except ValueError:
        raise ValidationError({field: "Ngày không hợp lệ (định dạng YYYY-MM-DD)."})


class TaskViewSet(CxViewSet):
    permission_module = "task"
    permission_map = {"partial_update": "task.view", "comments": "task.view"}

    def base_queryset(self):
        qs = (
            Issue.issue_objects.filter(
                workspace=self.cx.workspace,
                project__construction_profile__isnull=False,
                project__construction_profile__deleted_at__isnull=True,
            )
            .select_related("project", "state", "created_by", "project__construction_profile")
            .prefetch_related("assignees")
            .annotate(
                comment_count=Count("issue_comments", filter=Q(issue_comments__deleted_at__isnull=True), distinct=True)
            )
        )
        return self.cx.filter_projects(qs, "project_id")

    def filter_queryset(self, qs):
        p = self.request.query_params
        if p.get("project"):
            qs = qs.filter(project_id=p["project"])
        if p.get("q"):
            qs = qs.filter(Q(name__icontains=p["q"]) | Q(description_stripped__icontains=p["q"]))
        if p.get("status"):
            groups = [g for s in p["status"].split(",") for g in STATUS_GROUPS.get(s, [])]
            qs = qs.filter(state__group__in=groups)
        if p.get("priority"):
            qs = qs.filter(priority__in=p["priority"].split(","))
        if p.get("assignee") == "me":
            qs = qs.filter(assignees=self.request.user)
        elif p.get("assignee"):
            qs = qs.filter(assignees__id=p["assignee"])
        if p.get("created_by") == "me":
            qs = qs.filter(created_by=self.request.user)
        if p.get("overdue") == "true":
            qs = qs.filter(target_date__lt=timezone.localdate()).exclude(
                state__group__in=[StateGroup.COMPLETED.value, StateGroup.CANCELLED.value]
            )
        if p.get("due_from"):
            qs = qs.filter(target_date__gte=_parse_date(p["due_from"], "due_from"))
        if p.get("due_to"):
            qs = qs.filter(target_date__lte=_parse_date(p["due_to"], "due_to"))
        ordering = p.get("ordering") or "target_date"
        if ordering.lstrip("-") in ("target_date", "created_at", "priority", "name"):
            qs = qs.order_by(ordering, "-created_at")
        return qs.distinct()

    def serialize(self, issue, detail=False):
        today = timezone.localdate()
        group = issue.state.group if issue.state else StateGroup.BACKLOG.value
        task_status = GROUP_STATUS.get(group, "todo")
        data = {
            "id": str(issue.id),
            "key": f"{issue.project.identifier}-{issue.sequence_id}",
            "title": issue.name,
            "description": issue.description_stripped or "",
            "project": str(issue.project_id),
            "project_name": issue.project.name,
            "project_code": issue.project.construction_profile.code,
            "assigner": user_brief(issue.created_by),
            "assignees": [user_brief(u) for u in issue.assignees.all()],
            "start_date": issue.start_date,
            "due_date": issue.target_date,
            "priority": issue.priority,
            "status": task_status,
            "is_overdue": bool(
                issue.target_date and issue.target_date < today and task_status in ("todo", "in_progress")
            ),
            "comment_count": getattr(issue, "comment_count", None),
            "attachment_count": Attachment.objects.filter(entity_type="task", entity_id=issue.id).count(),
            "completed_at": issue.completed_at,
            "created_at": issue.created_at,
            "updated_at": issue.updated_at,
        }
        if detail:
            data["comments"] = self._comments(issue)
        return data

    def _comments(self, issue):
        return [
            {
                "id": str(c.id),
                "author": user_brief(c.actor),
                "text": c.comment_stripped,
                "created_at": c.created_at,
            }
            for c in IssueComment.objects.filter(issue=issue).select_related("actor").order_by("created_at")
        ]

    def get_object(self):
        issue = self.base_queryset().filter(pk=self.kwargs["pk"]).first()
        if issue is None:
            raise NotFound("Không tìm thấy công việc.")
        return issue

    # --------------------------------------------------------------- endpoints
    def list(self, request, *args, **kwargs):
        qs = self.filter_queryset(self.get_queryset())
        if request.query_params.get("export") == "xlsx":
            rows = [self.serialize(i) for i in qs[:5000]]
            return xlsx_response(
                "cong-viec",
                "Danh sách công việc",
                [
                    ("Mã", "key"),
                    ("Tiêu đề", "title"),
                    ("Dự án", "project_name"),
                    ("Người giao", "assigner"),
                    ("Người thực hiện", lambda r: ", ".join(a["display_name"] for a in r["assignees"])),
                    ("Hạn hoàn thành", "due_date"),
                    ("Độ ưu tiên", "priority"),
                    ("Trạng thái", "status"),
                    ("Quá hạn", lambda r: "Có" if r["is_overdue"] else ""),
                ],
                rows,
            )
        return paginate(request, qs, lambda chunk: [self.serialize(i) for i in chunk])

    def retrieve(self, request, *args, **kwargs):
        return Response(self.serialize(self.get_object(), detail=True))

    def _state_for(self, project_id, task_status):
        groups = STATUS_GROUPS.get(task_status)
        if not groups:
            raise ValidationError({"status": "Trạng thái không hợp lệ."})
        states = State.objects.filter(project_id=project_id, group__in=groups, is_triage=False)
        state = states.filter(default=True).first() or states.order_by("sequence").first()
        if state is None:
            raise ValidationError({"status": "Dự án chưa cấu hình trạng thái tương ứng."})
        return state

    def _validated_assignees(self, project_id, ids):
        if not isinstance(ids, list):
            raise ValidationError({"assignee_ids": "Danh sách người thực hiện không hợp lệ."})
        members = set(
            str(m)
            for m in ProjectMember.objects.filter(project_id=project_id, is_active=True, member_id__in=ids).values_list(
                "member_id", flat=True
            )
        )
        missing = {str(i) for i in ids} - members
        if missing:
            raise ValidationError({"assignee_ids": "Người thực hiện phải là thành viên dự án."})
        return list(members)

    def _set_assignees(self, issue, user_ids):
        IssueAssignee.objects.filter(issue=issue).exclude(assignee_id__in=user_ids).delete(soft=False)
        existing = set(str(a) for a in IssueAssignee.objects.filter(issue=issue).values_list("assignee_id", flat=True))
        new = [u for u in user_ids if u not in existing]
        IssueAssignee.objects.bulk_create(
            [
                IssueAssignee(
                    issue=issue,
                    assignee_id=u,
                    project_id=issue.project_id,
                    workspace_id=issue.workspace_id,
                    created_by=self.request.user,
                )
                for u in new
            ]
        )
        return new

    def create(self, request, *args, **kwargs):
        d = request.data
        title = (d.get("title") or "").strip()
        if not title:
            raise ValidationError({"title": "Vui lòng nhập tiêu đề công việc."})
        if len(title) > 255:
            raise ValidationError({"title": "Tiêu đề tối đa 255 ký tự."})
        project_id = d.get("project")
        if not project_id:
            raise ValidationError({"project": "Vui lòng chọn dự án."})
        self.cx.require_project(project_id)
        from ..models import ProjectProfile

        if not ProjectProfile.objects.filter(project_id=project_id, workspace=self.cx.workspace).exists():
            raise ValidationError({"project": "Dự án không hợp lệ."})
        priority = d.get("priority") or "medium"
        if priority not in PRIORITIES:
            raise ValidationError({"priority": "Độ ưu tiên không hợp lệ."})
        start, due = _parse_date(d.get("start_date"), "start_date"), _parse_date(d.get("due_date"), "due_date")
        if start and due and due < start:
            raise ValidationError({"due_date": "Hạn hoàn thành phải sau ngày bắt đầu."})
        assignees = self._validated_assignees(project_id, d.get("assignee_ids") or [])
        with transaction.atomic():
            issue = Issue(
                workspace=self.cx.workspace,
                project_id=project_id,
                name=title,
                description_html=_text_to_html(d.get("description")),
                priority=priority,
                start_date=start,
                target_date=due,
                state=self._state_for(project_id, d.get("status") or "todo"),
            )
            issue.save()
            self._set_assignees(issue, assignees)
        audit.record(request, "create", issue, entity_type="issues", label=title, project_id=issue.project_id)
        self._notify_new(issue, assignees)
        issue = self.get_object_by_id(issue.id)
        return Response(self.serialize(issue, detail=True), status=status.HTTP_201_CREATED)

    def get_object_by_id(self, pk):
        self.kwargs["pk"] = str(pk)
        return self.get_object()

    def partial_update(self, request, *args, **kwargs):
        issue = self.get_object()
        d = request.data
        is_assignee = issue.assignees.filter(id=request.user.id).exists()
        if not self.cx.has("task.update"):
            # Assignees may move their own task through the workflow, nothing else.
            if not is_assignee or not set(d) <= {"status"}:
                raise PermissionDenied("Bạn chỉ được cập nhật trạng thái công việc được giao cho mình.")
        before = self.serialize(issue)
        new_assignees = []
        with transaction.atomic():
            if "title" in d:
                title = (d.get("title") or "").strip()
                if not title:
                    raise ValidationError({"title": "Vui lòng nhập tiêu đề công việc."})
                issue.name = title[:255]
            if "description" in d:
                issue.description_html = _text_to_html(d.get("description"))
            if "priority" in d:
                if d["priority"] not in PRIORITIES:
                    raise ValidationError({"priority": "Độ ưu tiên không hợp lệ."})
                issue.priority = d["priority"]
            if "start_date" in d:
                issue.start_date = _parse_date(d.get("start_date"), "start_date")
            if "due_date" in d:
                issue.target_date = _parse_date(d.get("due_date"), "due_date")
            if issue.start_date and issue.target_date and issue.target_date < issue.start_date:
                raise ValidationError({"due_date": "Hạn hoàn thành phải sau ngày bắt đầu."})
            if "status" in d:
                issue.state = self._state_for(issue.project_id, d["status"])
            issue.save()
            if "assignee_ids" in d:
                new_assignees = self._set_assignees(
                    issue, self._validated_assignees(issue.project_id, d.get("assignee_ids") or [])
                )
        issue = self.get_object_by_id(issue.id)
        after = self.serialize(issue)
        changes = {
            k: {"old": str(before[k]), "new": str(after[k])}
            for k in ("title", "priority", "due_date", "status")
            if before[k] != after[k]
        }
        if changes or new_assignees:
            audit.record(
                request,
                "update",
                issue,
                entity_type="issues",
                label=issue.name,
                changes=changes,
                project_id=issue.project_id,
            )
        self._notify_new(issue, new_assignees)
        return Response(self.serialize(issue, detail=True))

    def destroy(self, request, *args, **kwargs):
        issue = self.get_object()
        issue.deleted_at = timezone.now()
        issue.save(update_fields=["deleted_at", "updated_at"])
        audit.record(request, "delete", issue, entity_type="issues", label=issue.name, project_id=issue.project_id)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["get", "post"])
    def comments(self, request, slug, pk=None):
        issue = self.get_object()
        if request.method == "POST":
            text = (request.data.get("text") or "").strip()
            if not text:
                raise ValidationError({"text": "Nội dung bình luận trống."})
            IssueComment.objects.create(
                issue=issue,
                project_id=issue.project_id,
                workspace_id=issue.workspace_id,
                actor=request.user,
                comment_html=_text_to_html(text),
            )
            recipients = {a.id for a in issue.assignees.all()} | (
                {issue.created_by_id} if issue.created_by_id else set()
            )
            notifications.notify(
                self.cx.workspace,
                recipients,
                Notification.Type.TASK_NEW,
                f"Bình luận mới: {issue.name}",
                message=strip_tags(text)[:300],
                project_id=issue.project_id,
                entity_type="task",
                entity_id=issue.id,
                link=f"/tasks/{issue.id}",
                exclude=request.user,
            )
        return Response(self._comments(issue))

    def _notify_new(self, issue, user_ids):
        if not user_ids:
            return
        due = f" - hạn {issue.target_date:%d/%m/%Y}" if issue.target_date else ""
        notifications.notify(
            self.cx.workspace,
            user_ids,
            Notification.Type.TASK_NEW,
            f"Công việc mới: {issue.name}",
            message=f"Dự án {issue.project.name}{due}",
            project_id=issue.project_id,
            entity_type="task",
            entity_id=issue.id,
            link=f"/tasks/{issue.id}",
            exclude=self.request.user,
        )
