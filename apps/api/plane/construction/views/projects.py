# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from plane.db.models import ProjectMember

from ..models import DailyReport, Milestone, Notification, ProjectProfile, ScheduleItem, TaskDependency, WorkLog
from ..serializers import (
    DailyReportSerializer,
    MilestoneSerializer,
    ProjectSerializer,
    ScheduleItemSerializer,
    TaskDependencySerializer,
    WorkLogSerializer,
)
from ..services import audit, notifications
from ..services import projects as project_service
from ..services.progress import project_progress, recompute_parents
from .base import CxViewSet


class ProjectViewSet(CxViewSet):
    """Construction projects. URL id = Plane project id."""

    model = ProjectProfile
    serializer_class = ProjectSerializer
    permission_module = "project"
    permission_map = {"members": "project.view", "add_member": "project.update", "remove_member": "project.update"}
    lookup_field = "project_id"
    project_field = "project_id"
    select_related = ("project", "manager", "department")
    search_fields = ("code", "project__name", "investor", "location")
    filter_fields = {
        "status": "status__in",
        "project_type": "project_type",
        "department": "department_id",
        "manager": "manager_id",
        "start_from": "planned_end_date__gte",
        "start_to": "start_date__lte",
    }
    ordering_fields = ("code", "start_date", "planned_end_date", "contract_value", "created_at")
    export_title = "Danh sách dự án"
    export_columns = [
        ("Mã dự án", "code"),
        ("Tên công trình", "name"),
        ("Chủ đầu tư", "investor"),
        ("Địa điểm", "location"),
        ("Loại công trình", "project_type"),
        ("Ngày bắt đầu", "start_date"),
        ("Ngày kết thúc dự kiến", "planned_end_date"),
        ("Người phụ trách", "manager_detail"),
        ("Trạng thái", "status"),
        ("Giá trị hợp đồng (VNĐ)", "contract_value"),
        ("% kế hoạch", "progress.planned"),
        ("% thực tế", "progress.actual"),
    ]

    def get_queryset(self):
        return self.base_queryset().filter(project__archived_at__isnull=True)

    def extra_context(self):
        ctx = {"with_members": self.action in ("retrieve", "members")}
        if self.action in ("list", "retrieve", "update", "partial_update", "create"):
            # Progress is computed for the rows actually serialized (see list()).
            ctx["progress"] = getattr(self, "_progress", {})
        return ctx

    def list(self, request, *args, **kwargs):
        qs = self.filter_queryset(self.get_queryset())
        self._progress = project_progress(list(qs.values_list("project_id", flat=True)))
        return super().list(request, *args, **kwargs)

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        self._progress = project_progress([instance.project_id])
        return Response(self.get_serializer(instance).data)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        member_ids = data.pop("member_ids", [])
        name = data.pop("project")["name"]
        with transaction.atomic():
            project = project_service.create_plane_project(
                self.cx.workspace,
                request.user,
                name=name,
                code=data["code"],
                manager_id=data["manager"].id,
                member_ids=member_ids,
                description=data.get("description", ""),
            )
            profile = ProjectProfile(workspace=self.cx.workspace, project=project, **data)
            profile.save()
        audit.record(request, "create", profile, changes=audit.diff({}, audit.snapshot(profile)), project_id=project.id)
        self._progress = project_progress([project.id])
        return Response(self.get_serializer(profile).data, status=status.HTTP_201_CREATED)

    def perform_update(self, serializer):
        data = serializer.validated_data
        member_ids = data.pop("member_ids", None)
        project_data = data.pop("project", None)
        profile = serializer.instance
        with transaction.atomic():
            if project_data and project_data.get("name") and project_data["name"] != profile.project.name:
                before_name = profile.project.name
                profile.project.name = project_data["name"]
                profile.project.save(update_fields=["name", "updated_at"])
                audit.record(
                    self.request, "update", profile, changes={"name": {"old": before_name, "new": project_data["name"]}}
                )
            if (
                data.get("status") == ProjectProfile.Status.COMPLETED
                and not data.get("actual_end_date")
                and not profile.actual_end_date
            ):
                data["actual_end_date"] = timezone.localdate()
            super().perform_update(serializer)
            manager = serializer.instance.manager_id
            project_service.sync_members(profile.project, manager, member_ids or [])
        self._progress = project_progress([profile.project_id])

    def before_destroy(self, instance):
        # The Plane project is archived (not erased) so history, tasks and files stay recoverable.
        instance.project.archived_at = timezone.now()
        instance.project.save(update_fields=["archived_at", "updated_at"])

    @action(detail=True, methods=["get"])
    def members(self, request, slug, project_id=None):
        profile = self.get_object()
        return Response(self.get_serializer(profile).data["members"])

    @action(detail=True, methods=["post"], url_path="members/add")
    def add_member(self, request, slug, project_id=None):
        profile = self.get_object()
        user_ids = request.data.get("user_ids") or []
        if not isinstance(user_ids, list) or not user_ids:
            raise ValidationError({"user_ids": "Chọn ít nhất một nhân sự."})
        project_service.sync_members(profile.project, None, user_ids)
        audit.record(
            request, "add_members", profile, changes={"members": {"old": None, "new": [str(u) for u in user_ids]}}
        )
        return Response(
            ProjectSerializer(profile, context={**self.get_serializer_context(), "with_members": True}).data["members"]
        )

    @action(detail=True, methods=["post"], url_path="members/remove")
    def remove_member(self, request, slug, project_id=None):
        profile = self.get_object()
        user_id = request.data.get("user_id")
        if str(user_id) == str(profile.manager_id):
            raise ValidationError({"user_id": "Không thể gỡ người phụ trách dự án. Hãy đổi người phụ trách trước."})
        project_service.remove_member(profile.project, user_id)
        audit.record(request, "remove_member", profile, changes={"members": {"old": str(user_id), "new": None}})
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProjectScopedViewSet(CxViewSet):
    project_field = "project_id"

    def base_queryset(self):
        return super().base_queryset().filter(project__archived_at__isnull=True)


class ScheduleItemViewSet(ProjectScopedViewSet):
    model = ScheduleItem
    serializer_class = ScheduleItemSerializer
    permission_module = "schedule"
    select_related = ("assignee", "project", "parent")
    search_fields = ("code", "name", "note")
    filter_fields = {
        "project": "project_id",
        "parent": "parent_id",
        "level": "level",
        "assignee": "assignee_id",
        "status": "status__in",
        "priority": "priority__in",
        "date_from": "end_date__gte",
        "date_to": "start_date__lte",
    }
    ordering_fields = ("code", "start_date", "end_date", "progress", "sort_order")
    # Updates are checked in update(): schedule.update, or the assignee reporting own progress.
    permission_map = {"partial_update": "schedule.view", "update": "schedule.view"}
    export_title = "Kế hoạch tiến độ"
    export_columns = [
        ("Dự án", "project_name"),
        ("Mã", "code"),
        ("Tên công việc", "name"),
        ("Cấp", "level"),
        ("Người phụ trách", "assignee_detail"),
        ("Bắt đầu", "start_date"),
        ("Kết thúc", "end_date"),
        ("Số ngày", "duration_days"),
        ("% hoàn thành", "progress"),
        ("Ưu tiên", "priority"),
        ("Trạng thái", "status"),
        ("Quá hạn", lambda r: "Có" if r["is_overdue"] else ""),
        ("Ghi chú", "note"),
    ]

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        if self.request.query_params.get("overdue") == "true":
            queryset = queryset.filter(end_date__lt=timezone.localdate()).exclude(status=ScheduleItem.Status.COMPLETED)
        if self.request.query_params.get("mine") == "true":
            queryset = queryset.filter(assignee=self.request.user)
        if self.request.query_params.get("roots") == "true":
            queryset = queryset.filter(parent__isnull=True)
        return queryset.order_by(*(queryset.query.order_by or ("project_id", "sort_order", "code")))

    def extra_context(self):
        ids = set(
            ScheduleItem.objects.filter(workspace=self.cx.workspace, parent__isnull=False).values_list(
                "parent_id", flat=True
            )
        )
        return {"parent_ids": ids}

    def update(self, request, *args, **kwargs):
        # An assignee may always report progress on their own item (progress/status/note only).
        instance = self.get_object()
        if not self.cx.has("schedule.update"):
            allowed = {"progress", "status", "note"}
            if instance.assignee_id != request.user.id or not set(request.data) <= allowed:
                raise PermissionDenied("Bạn chỉ được cập nhật tiến độ công việc mình phụ trách.")
        return super().update(request, *args, **kwargs)

    def after_create(self, instance):
        recompute_parents(instance)
        self._notify_assignee(instance, None)

    def after_update(self, instance, before):
        recompute_parents(instance)
        old_parent = before.get("parent")
        if old_parent and str(old_parent) != str(instance.parent_id):
            old = ScheduleItem.objects.filter(pk=old_parent).first()
            if old:
                children = old.children.filter(deleted_at__isnull=True)
                if children.exists():
                    recompute_parents(children.first())
        self._notify_assignee(instance, before.get("assignee"))

    def before_destroy(self, instance):
        if instance.children.filter(deleted_at__isnull=True).exists():
            raise ValidationError({"detail": "Hãy xóa các công việc con trước khi xóa mục này."})

    def perform_destroy(self, instance):
        parent = instance.parent
        super().perform_destroy(instance)
        if parent:
            sibling = parent.children.filter(deleted_at__isnull=True).first()
            if sibling:
                recompute_parents(sibling)

    def _notify_assignee(self, item, old_assignee):
        if item.assignee_id and str(item.assignee_id) != str(old_assignee or ""):
            notifications.notify(
                self.cx.workspace,
                [item.assignee_id],
                Notification.Type.TASK_NEW,
                f"Bạn được giao: {item.code} {item.name}",
                message=f"Thời hạn {item.start_date:%d/%m/%Y} - {item.end_date:%d/%m/%Y}",
                project_id=item.project_id,
                entity_type="schedule_item",
                entity_id=item.id,
                link=f"/schedule?project={item.project_id}&item={item.id}",
                exclude=self.request.user,
            )


class DependencyViewSet(CxViewSet):
    model = TaskDependency
    serializer_class = TaskDependencySerializer
    permission_module = "schedule"
    filter_fields = {"project": "predecessor__project_id"}

    def base_queryset(self):
        qs = TaskDependency.objects.filter(predecessor__workspace=self.cx.workspace).select_related(
            "predecessor", "successor"
        )
        return self.cx.filter_projects(qs, "predecessor__project_id")

    def perform_create(self, serializer):
        instance = serializer.save()
        audit.record(self.request, "create", instance, project_id=instance.predecessor.project_id)


class MilestoneViewSet(ProjectScopedViewSet):
    model = Milestone
    serializer_class = MilestoneSerializer
    permission_module = "schedule"
    select_related = ("project",)
    filter_fields = {"project": "project_id", "status": "status"}


class DailyReportViewSet(ProjectScopedViewSet):
    model = DailyReport
    serializer_class = DailyReportSerializer
    permission_module = "daily_report"
    permission_map = {
        "submit": "daily_report.update",
        "approve": "daily_report.approve",
        "reject": "daily_report.approve",
    }
    select_related = ("project", "created_by", "reviewed_by")
    search_fields = ("work_performed", "issues", "hse_notes")
    filter_fields = {
        "project": "project_id",
        "status": "status__in",
        "date_from": "report_date__gte",
        "date_to": "report_date__lte",
    }
    ordering_fields = ("report_date", "created_at")
    export_title = "Nhật ký công trường"
    export_columns = [
        ("Ngày", "report_date"),
        ("Dự án", "project_name"),
        ("Thời tiết", "weather"),
        ("Nhân lực", "manpower_count"),
        ("Thiết bị", "equipment"),
        ("Công việc thực hiện", "work_performed"),
        ("Vướng mắc", "issues"),
        ("An toàn - Môi trường", "hse_notes"),
        ("Kế hoạch ngày tiếp", "next_plan"),
        ("Trạng thái", "status"),
        ("Người lập", "created_by_detail"),
    ]

    def _transition(self, request, report, new_status, comment=""):
        report.status = new_status
        if new_status in (DailyReport.Status.APPROVED, DailyReport.Status.REJECTED):
            report.reviewed_by = request.user
            report.reviewed_at = timezone.now()
            report.review_comment = comment
        report.save()
        audit.record(request, new_status, report, changes={"status": {"new": new_status}, "comment": comment})
        return Response(self.get_serializer(report).data)

    @action(detail=True, methods=["post"])
    def submit(self, request, slug, pk=None):
        report = self.get_object()
        if report.status not in (DailyReport.Status.DRAFT, DailyReport.Status.REJECTED):
            raise ValidationError({"status": "Nhật ký đã được gửi duyệt."})
        approvers = _users_with_permission(self.cx.workspace, report.project_id, "daily_report.approve")
        notifications.notify(
            self.cx.workspace,
            approvers,
            Notification.Type.ACCEPTANCE_REQUIRED,
            f"Nhật ký công trường {report.report_date:%d/%m/%Y} - {report.project.name} chờ duyệt",
            project_id=report.project_id,
            entity_type="daily_report",
            entity_id=report.id,
            link=f"/projects/{report.project_id}?tab=reports",
            exclude=request.user,
        )
        return self._transition(request, report, DailyReport.Status.SUBMITTED)

    @action(detail=True, methods=["post"])
    def approve(self, request, slug, pk=None):
        report = self.get_object()
        if report.status != DailyReport.Status.SUBMITTED:
            raise ValidationError({"status": "Chỉ duyệt được nhật ký đang chờ duyệt."})
        if report.created_by_id == request.user.id:
            raise PermissionDenied("Không thể tự duyệt nhật ký do mình lập.")
        return self._transition(request, report, DailyReport.Status.APPROVED, request.data.get("comment", ""))

    @action(detail=True, methods=["post"])
    def reject(self, request, slug, pk=None):
        report = self.get_object()
        if report.status != DailyReport.Status.SUBMITTED:
            raise ValidationError({"status": "Chỉ trả lại được nhật ký đang chờ duyệt."})
        comment = (request.data.get("comment") or "").strip()
        if not comment:
            raise ValidationError({"comment": "Vui lòng ghi lý do trả lại."})
        return self._transition(request, report, DailyReport.Status.REJECTED, comment)

    def check_locked(self, instance):
        if instance.status in (DailyReport.Status.APPROVED, DailyReport.Status.SUBMITTED):
            from .base import LockedError

            raise LockedError("Nhật ký đã gửi duyệt hoặc đã duyệt, không thể sửa / xóa.")


class WorkLogViewSet(ProjectScopedViewSet):
    model = WorkLog
    serializer_class = WorkLogSerializer
    permission_module = "schedule"
    # Logging own hours only needs to see the schedule; editing others' logs is refused below.
    permission_map = {"create": "schedule.view", "partial_update": "schedule.view", "destroy": "schedule.view"}
    select_related = ("user", "project")
    filter_fields = {
        "project": "project_id",
        "user": "user_id",
        "date_from": "work_date__gte",
        "date_to": "work_date__lte",
    }

    def create_extra(self, serializer):
        return {"user": self.request.user}

    def check_locked(self, instance):
        if instance.user_id != self.request.user.id:
            raise PermissionDenied("Chỉ được sửa / xóa giờ công của chính mình.")


def _users_with_permission(workspace, project_id, code):
    """Active users who hold ``code`` and can see ``project_id`` (used for routing notifications)."""
    from plane.db.models import WorkspaceMember

    from ..models import Employee

    admins = set(
        WorkspaceMember.objects.filter(workspace=workspace, role=20, is_active=True).values_list("member_id", flat=True)
    )
    project_members = set(
        ProjectMember.objects.filter(project_id=project_id, is_active=True).values_list("member_id", flat=True)
    )
    holders = Employee.objects.filter(
        workspace=workspace,
        status=Employee.Status.ACTIVE,
        user__isnull=False,
        role__role_permissions__permission__code=code,
    ).values_list("user_id", "role__see_all_projects")
    users = {uid for uid, see_all in holders if see_all or uid in project_members}
    return users | (admins & project_members)
