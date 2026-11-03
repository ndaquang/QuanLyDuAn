# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from rest_framework import serializers

from plane.db.models import ProjectMember, User, WorkspaceMember

from .models import (
    ApprovalHistory,
    ApprovalRequest,
    ApprovalStep,
    ApprovalWorkflow,
    Attachment,
    AuditLog,
    DailyReport,
    Department,
    Document,
    Employee,
    Material,
    Milestone,
    Notification,
    Permission,
    ProjectProfile,
    Role,
    ScheduleItem,
    Supplier,
    TaskDependency,
    Tender,
    TenderItem,
    WorkLog,
)


def user_brief(user):
    if user is None:
        return None
    name = " ".join(p for p in [user.first_name, user.last_name] if p).strip()
    return {"id": str(user.id), "display_name": name or user.display_name or user.email, "email": user.email}


class UserBriefField(serializers.Field):
    def __init__(self, source, **kwargs):
        super().__init__(source=source, read_only=True, **kwargs)

    def to_representation(self, value):
        return user_brief(value)


class WorkspaceSerializer(serializers.ModelSerializer):
    """Base: the view injects ``workspace``; FK targets must belong to the same workspace."""

    def _ctx(self):
        return self.context["request"].cx

    def _check_workspace(self, obj, field):
        if obj is not None and getattr(obj, "workspace_id", None) != self._ctx().workspace.id:
            raise serializers.ValidationError({field: "Dữ liệu không thuộc công ty hiện tại."})

    def _check_workspace_user(self, user, field):
        if user is None:
            return
        if not WorkspaceMember.objects.filter(workspace=self._ctx().workspace, member=user, is_active=True).exists():
            raise serializers.ValidationError({field: "Người dùng không thuộc công ty."})

    def _check_project_member(self, project, user, field):
        if user is None or project is None:
            return
        if not ProjectMember.objects.filter(project=project, member=user, is_active=True).exists():
            raise serializers.ValidationError({field: "Người phụ trách phải là thành viên của dự án."})

    def _check_project(self, project, field="project"):
        if project is None:
            return
        self._check_workspace(project, field)
        if not self._ctx().can_access_project(project.id):
            raise serializers.ValidationError({field: "Bạn không có quyền với dự án này."})


# ---------------------------------------------------------------------------
# Organisation
# ---------------------------------------------------------------------------


class PermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Permission
        fields = ["code", "module", "action", "name"]


class RoleSerializer(WorkspaceSerializer):
    permission_codes = serializers.ListField(child=serializers.CharField(), write_only=True, required=False)
    permissions = serializers.SerializerMethodField()
    employee_count = serializers.SerializerMethodField()

    class Meta:
        model = Role
        fields = [
            "id", "code", "name", "description", "is_system", "see_all_projects", "sort_order",
            "permissions", "permission_codes", "employee_count",
        ]  # fmt: skip
        read_only_fields = ["is_system"]

    def get_permissions(self, obj):
        return sorted(obj.permissions.values_list("code", flat=True))

    def get_employee_count(self, obj):
        return obj.employees.filter(deleted_at__isnull=True).count()

    def validate_permission_codes(self, value):
        known = set(Permission.objects.filter(code__in=value).values_list("code", flat=True))
        unknown = set(value) - known
        if unknown:
            raise serializers.ValidationError(f"Quyền không hợp lệ: {', '.join(sorted(unknown))}")
        return sorted(set(value))

    def validate_code(self, value):
        qs = Role.objects.filter(workspace=self._ctx().workspace, code=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("Mã vai trò đã tồn tại.")
        return value


class DepartmentSerializer(WorkspaceSerializer):
    head_detail = UserBriefField(source="head")
    employee_count = serializers.SerializerMethodField()

    class Meta:
        model = Department
        fields = ["id", "code", "name", "head", "head_detail", "description", "employee_count", "created_at"]

    def get_employee_count(self, obj):
        return obj.employees.filter(deleted_at__isnull=True).count()

    def validate(self, attrs):
        self._check_workspace_user(attrs.get("head"), "head")
        code = attrs.get("code")
        if code:
            qs = Department.objects.filter(workspace=self._ctx().workspace, code__iexact=code)
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError({"code": "Mã phòng ban đã tồn tại."})
        return attrs


class EmployeeSerializer(WorkspaceSerializer):
    department_name = serializers.CharField(source="department.name", read_only=True, default=None)
    role_name = serializers.CharField(source="role.name", read_only=True, default=None)
    user_detail = UserBriefField(source="user")
    photo_url = serializers.SerializerMethodField()
    projects = serializers.SerializerMethodField()

    class Meta:
        model = Employee
        fields = [
            "id", "user", "user_detail", "code", "full_name", "email", "phone", "position",
            "department", "department_name", "role", "role_name", "status", "date_of_birth",
            "join_date", "id_number", "address", "notes", "photo", "photo_url", "projects",
            "created_at", "updated_at",
        ]  # fmt: skip
        read_only_fields = ["photo"]

    def get_photo_url(self, obj):
        if not obj.photo_id:
            return None
        slug = self._ctx().workspace.slug
        return f"/api/construction/workspaces/{slug}/attachments/{obj.photo_id}/download/"

    def get_projects(self, obj):
        if not obj.user_id:
            return []
        rows = (
            ProjectMember.objects.filter(member_id=obj.user_id, is_active=True, workspace_id=obj.workspace_id)
            .filter(project__construction_profile__deleted_at__isnull=True, project__construction_profile__isnull=False)
            .values("project_id", "project__name", "project__construction_profile__code")
        )
        return [
            {"id": str(r["project_id"]), "name": r["project__name"], "code": r["project__construction_profile__code"]}
            for r in rows
        ]

    def validate(self, attrs):
        ws = self._ctx().workspace
        self._check_workspace(attrs.get("department"), "department")
        self._check_workspace(attrs.get("role"), "role")
        user = attrs.get("user")
        if user is not None:
            self._check_workspace_user(user, "user")
            qs = Employee.objects.filter(workspace=ws, user=user)
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError({"user": "Tài khoản này đã gắn với một nhân sự khác."})
        code = attrs.get("code")
        if code:
            qs = Employee.objects.filter(workspace=ws, code__iexact=code)
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError({"code": "Mã nhân viên đã tồn tại."})
        return attrs


# ---------------------------------------------------------------------------
# Projects & schedule
# ---------------------------------------------------------------------------


class ProjectSerializer(WorkspaceSerializer):
    id = serializers.UUIDField(source="project_id", read_only=True)
    profile_id = serializers.UUIDField(source="pk", read_only=True)
    name = serializers.CharField(source="project.name", max_length=255)
    manager_detail = UserBriefField(source="manager")
    department_name = serializers.CharField(source="department.name", read_only=True, default=None)
    member_ids = serializers.ListField(child=serializers.UUIDField(), write_only=True, required=False)
    members = serializers.SerializerMethodField()
    progress = serializers.SerializerMethodField()
    identifier = serializers.CharField(source="project.identifier", read_only=True)

    class Meta:
        model = ProjectProfile
        fields = [
            "id", "profile_id", "identifier", "code", "name", "investor", "location", "project_type",
            "start_date", "planned_end_date", "actual_end_date", "manager", "manager_detail",
            "department", "department_name", "status", "contract_value", "description",
            "member_ids", "members", "progress", "created_at", "updated_at",
        ]  # fmt: skip

    def get_members(self, obj):
        if not self.context.get("with_members"):
            return None
        rows = ProjectMember.objects.filter(project_id=obj.project_id, is_active=True).select_related("member")
        employees = {
            e.user_id: e
            for e in Employee.objects.filter(workspace_id=obj.workspace_id, user__isnull=False).select_related("role")
        }
        result = []
        for m in rows:
            e = employees.get(m.member_id)
            result.append(
                {
                    **user_brief(m.member),
                    "project_role": m.role,
                    "employee_id": str(e.id) if e else None,
                    "position": e.position if e else "",
                    "business_role": e.role.name if e and e.role else None,
                }
            )
        return result

    def get_progress(self, obj):
        progress = self.context.get("progress", {}).get(obj.project_id)
        if progress is None:
            return None
        from .services.progress import is_behind

        return {
            "actual": float(progress["actual"]),
            "planned": float(progress["planned"]),
            "items": progress["items"],
            "overdue": progress["overdue"],
            "is_behind": is_behind(obj, progress),
        }

    def validate(self, attrs):
        start = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end = attrs.get("planned_end_date", getattr(self.instance, "planned_end_date", None))
        if start and end and end < start:
            raise serializers.ValidationError({"planned_end_date": "Ngày kết thúc phải sau ngày bắt đầu."})
        actual_end = attrs.get("actual_end_date")
        if actual_end and start and actual_end < start:
            raise serializers.ValidationError({"actual_end_date": "Ngày hoàn thành thực tế không hợp lệ."})
        self._check_workspace(attrs.get("department"), "department")
        self._check_workspace_user(attrs.get("manager"), "manager")
        if not self.instance and not attrs.get("manager"):
            raise serializers.ValidationError({"manager": "Vui lòng chọn người phụ trách dự án."})
        name = (attrs.get("project") or {}).get("name")
        if name is not None:
            name = name.strip()
            if not name:
                raise serializers.ValidationError({"name": "Vui lòng nhập tên công trình."})
            attrs["project"]["name"] = name
            from plane.db.models import Project

            qs = Project.objects.filter(workspace=self._ctx().workspace, name=name)
            if self.instance:
                qs = qs.exclude(pk=self.instance.project_id)
            if qs.exists():
                raise serializers.ValidationError({"name": "Tên công trình đã tồn tại (kể cả dự án đã lưu trữ)."})
        code = attrs.get("code")
        if code:
            qs = ProjectProfile.objects.filter(workspace=self._ctx().workspace, code__iexact=code)
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError({"code": "Mã dự án đã tồn tại."})
        return attrs


class ScheduleItemSerializer(WorkspaceSerializer):
    assignee_detail = UserBriefField(source="assignee")
    project_name = serializers.CharField(source="project.name", read_only=True)
    is_overdue = serializers.BooleanField(read_only=True)
    has_children = serializers.SerializerMethodField()

    class Meta:
        model = ScheduleItem
        fields = [
            "id", "project", "project_name", "parent", "level", "code", "name", "assignee",
            "assignee_detail", "start_date", "end_date", "duration_days", "progress", "weight",
            "priority", "status", "note", "sort_order", "is_overdue", "has_children",
            "completed_at", "created_at", "updated_at",
        ]  # fmt: skip
        read_only_fields = ["duration_days", "completed_at"]

    def get_has_children(self, obj):
        ids = self.context.get("parent_ids")
        if ids is not None:
            return obj.id in ids
        return obj.children.exists()

    def validate(self, attrs):
        project = attrs.get("project", getattr(self.instance, "project", None))
        if self.instance and "project" in attrs and attrs["project"] != self.instance.project:
            raise serializers.ValidationError({"project": "Không thể chuyển hạng mục sang dự án khác."})
        self._check_project(project)
        parent = attrs.get("parent", getattr(self.instance, "parent", None))
        level = attrs.get("level", getattr(self.instance, "level", None))
        expected_parent_level = {
            ScheduleItem.Level.CATEGORY: None,
            ScheduleItem.Level.TASK: ScheduleItem.Level.CATEGORY,
            ScheduleItem.Level.ACTIVITY: ScheduleItem.Level.TASK,
        }[level]
        if expected_parent_level is None and parent is not None:
            raise serializers.ValidationError({"parent": "Hạng mục là cấp cao nhất, không có cấp cha."})
        if expected_parent_level is not None:
            if parent is None or parent.level != expected_parent_level:
                label = ScheduleItem.Level(expected_parent_level).label
                raise serializers.ValidationError({"parent": f"Cấp cha phải là một {label.lower()}."})
            if parent.project_id != project.id:
                raise serializers.ValidationError({"parent": "Cấp cha phải thuộc cùng dự án."})
        start = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end = attrs.get("end_date", getattr(self.instance, "end_date", None))
        if start and end and end < start:
            raise serializers.ValidationError({"end_date": "Ngày kết thúc phải sau hoặc bằng ngày bắt đầu."})
        if "assignee" in attrs:
            self._check_project_member(project, attrs["assignee"], "assignee")
        code = attrs.get("code")
        if code:
            qs = ScheduleItem.objects.filter(project=project, code__iexact=code)
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError({"code": "Mã công việc đã tồn tại trong dự án."})
        return attrs


class TaskDependencySerializer(WorkspaceSerializer):
    predecessor_detail = serializers.SerializerMethodField()
    successor_detail = serializers.SerializerMethodField()

    class Meta:
        model = TaskDependency
        fields = [
            "id",
            "predecessor",
            "successor",
            "dependency_type",
            "lag_days",
            "predecessor_detail",
            "successor_detail",
        ]

    def get_predecessor_detail(self, obj):
        return {"id": str(obj.predecessor_id), "code": obj.predecessor.code, "name": obj.predecessor.name}

    def get_successor_detail(self, obj):
        return {"id": str(obj.successor_id), "code": obj.successor.code, "name": obj.successor.name}

    def validate(self, attrs):
        pred = attrs.get("predecessor", getattr(self.instance, "predecessor", None))
        succ = attrs.get("successor", getattr(self.instance, "successor", None))
        self._check_workspace(pred, "predecessor")
        self._check_workspace(succ, "successor")
        if pred.id == succ.id:
            raise serializers.ValidationError({"successor": "Một công việc không thể phụ thuộc chính nó."})
        if pred.project_id != succ.project_id:
            raise serializers.ValidationError({"successor": "Hai công việc phải cùng dự án."})
        self._check_project(pred.project, "predecessor")
        # Reject cycles: walk successors of `succ` and make sure we never reach `pred`.
        frontier, seen = [succ.id], set()
        while frontier:
            current = frontier.pop()
            if current == pred.id:
                raise serializers.ValidationError({"successor": "Liên kết này tạo vòng lặp phụ thuộc."})
            if current in seen:
                continue
            seen.add(current)
            frontier.extend(
                TaskDependency.objects.filter(predecessor_id=current).values_list("successor_id", flat=True)
            )
        return attrs


class MilestoneSerializer(WorkspaceSerializer):
    project_name = serializers.CharField(source="project.name", read_only=True)

    class Meta:
        model = Milestone
        fields = ["id", "project", "project_name", "name", "due_date", "achieved_date", "status", "description"]

    def validate(self, attrs):
        self._check_project(attrs.get("project"))
        return attrs


class DailyReportSerializer(WorkspaceSerializer):
    project_name = serializers.CharField(source="project.name", read_only=True)
    created_by_detail = UserBriefField(source="created_by")
    reviewed_by_detail = UserBriefField(source="reviewed_by")
    attachment_count = serializers.SerializerMethodField()

    class Meta:
        model = DailyReport
        fields = [
            "id", "project", "project_name", "report_date", "weather", "manpower_count", "equipment",
            "work_performed", "issues", "hse_notes", "next_plan", "status", "reviewed_by",
            "reviewed_by_detail", "reviewed_at", "review_comment", "attachment_count",
            "created_by_detail", "created_at", "updated_at",
        ]  # fmt: skip
        read_only_fields = ["status", "reviewed_by", "reviewed_at", "review_comment"]

    def get_attachment_count(self, obj):
        return Attachment.objects.filter(entity_type="daily_report", entity_id=obj.id).count()

    def validate(self, attrs):
        project = attrs.get("project", getattr(self.instance, "project", None))
        if self.instance and "project" in attrs and attrs["project"] != self.instance.project:
            raise serializers.ValidationError({"project": "Không thể chuyển nhật ký sang dự án khác."})
        self._check_project(project)
        report_date = attrs.get("report_date", getattr(self.instance, "report_date", None))
        qs = DailyReport.objects.filter(project=project, report_date=report_date)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError({"report_date": "Dự án đã có nhật ký cho ngày này."})
        from django.utils import timezone

        if report_date and report_date > timezone.localdate():
            raise serializers.ValidationError({"report_date": "Không thể lập nhật ký cho ngày trong tương lai."})
        return attrs


class WorkLogSerializer(WorkspaceSerializer):
    user_detail = UserBriefField(source="user")
    project_name = serializers.CharField(source="project.name", read_only=True)

    class Meta:
        model = WorkLog
        fields = [
            "id",
            "project",
            "project_name",
            "user",
            "user_detail",
            "schedule_item",
            "work_date",
            "hours",
            "description",
        ]
        read_only_fields = ["user"]

    def validate(self, attrs):
        project = attrs.get("project", getattr(self.instance, "project", None))
        self._check_project(project)
        item = attrs.get("schedule_item")
        if item is not None and item.project_id != project.id:
            raise serializers.ValidationError({"schedule_item": "Công việc không thuộc dự án đã chọn."})
        return attrs


# ---------------------------------------------------------------------------
# Materials, suppliers, tenders & documents
# ---------------------------------------------------------------------------


class _UniqueCodeMixin:
    unique_code_message = "Mã đã tồn tại."

    def validate_code(self, value):
        qs = self.Meta.model.objects.filter(workspace=self._ctx().workspace, code__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError(self.unique_code_message)
        return value


class SupplierSerializer(_UniqueCodeMixin, WorkspaceSerializer):
    unique_code_message = "Mã nhà cung cấp đã tồn tại."
    material_count = serializers.SerializerMethodField()

    class Meta:
        model = Supplier
        fields = [
            "id", "code", "name", "tax_code", "category", "contact_person", "phone", "email",
            "address", "status", "notes", "material_count", "created_at",
        ]  # fmt: skip

    def get_material_count(self, obj):
        return obj.materials.filter(deleted_at__isnull=True).count()

    def validate_tax_code(self, value):
        value = (value or "").strip()
        if value:
            qs = Supplier.objects.filter(workspace=self._ctx().workspace, tax_code=value)
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError("Mã số thuế đã tồn tại.")
        return value


class MaterialSerializer(_UniqueCodeMixin, WorkspaceSerializer):
    unique_code_message = "Mã vật tư đã tồn tại."
    supplier_name = serializers.CharField(source="supplier.name", read_only=True, default=None)

    class Meta:
        model = Material
        fields = [
            "id", "code", "name", "unit", "category", "specification", "supplier", "supplier_name",
            "reference_price", "is_active", "created_at",
        ]  # fmt: skip

    def validate(self, attrs):
        self._check_workspace(attrs.get("supplier"), "supplier")
        return attrs


class TenderItemSerializer(WorkspaceSerializer):
    assignee_detail = UserBriefField(source="assignee")

    class Meta:
        model = TenderItem
        fields = ["id", "tender", "name", "category", "assignee", "assignee_detail", "due_date", "status", "note"]

    def validate(self, attrs):
        self._check_workspace(attrs.get("tender"), "tender")
        self._check_workspace_user(attrs.get("assignee"), "assignee")
        return attrs


class TenderSerializer(_UniqueCodeMixin, WorkspaceSerializer):
    unique_code_message = "Mã gói thầu đã tồn tại."
    owner_detail = UserBriefField(source="owner")
    project_name = serializers.CharField(source="project.name", read_only=True, default=None)
    checklist = serializers.SerializerMethodField()

    class Meta:
        model = Tender
        fields = [
            "id", "code", "name", "investor", "location", "owner", "owner_detail", "project",
            "project_name", "release_date", "clarification_deadline", "submission_deadline",
            "bid_value", "status", "result_note", "checklist", "created_at",
        ]  # fmt: skip

    def get_checklist(self, obj):
        items = list(obj.items.filter(deleted_at__isnull=True).values_list("status", flat=True))
        done = sum(1 for s in items if s == TenderItem.Status.DONE)
        return {"total": len(items), "done": done, "percent": round(done * 100 / len(items)) if items else 0}

    def validate(self, attrs):
        self._check_project(attrs.get("project"))
        self._check_workspace_user(attrs.get("owner"), "owner")
        return attrs


class DocumentSerializer(WorkspaceSerializer):
    project_name = serializers.CharField(source="project.name", read_only=True, default=None)
    tender_name = serializers.CharField(source="tender.name", read_only=True, default=None)
    created_by_detail = UserBriefField(source="created_by")
    reviewed_by_detail = UserBriefField(source="reviewed_by")
    attachment_count = serializers.SerializerMethodField()

    class Meta:
        model = Document
        fields = [
            "id", "project", "project_name", "tender", "tender_name", "category", "code", "title",
            "version", "description", "status", "reviewed_by", "reviewed_by_detail", "reviewed_at",
            "review_comment", "attachment_count", "created_by_detail", "created_at", "updated_at",
        ]  # fmt: skip
        read_only_fields = ["status", "reviewed_by", "reviewed_at", "review_comment"]

    def get_attachment_count(self, obj):
        return Attachment.objects.filter(entity_type="document", entity_id=obj.id).count()

    def validate(self, attrs):
        self._check_project(attrs.get("project"))
        self._check_workspace(attrs.get("tender"), "tender")
        return attrs


class AttachmentSerializer(serializers.ModelSerializer):
    uploaded_by = UserBriefField(source="created_by")
    url = serializers.SerializerMethodField()

    class Meta:
        model = Attachment
        fields = [
            "id",
            "entity_type",
            "entity_id",
            "project",
            "file_name",
            "content_type",
            "size",
            "uploaded_by",
            "url",
            "created_at",
        ]

    def get_url(self, obj):
        return (
            f"/api/construction/workspaces/{self.context['request'].cx.workspace.slug}/attachments/{obj.id}/download/"
        )


# ---------------------------------------------------------------------------
# Approvals
# ---------------------------------------------------------------------------


class ApprovalStepSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(required=False)
    approver_role_name = serializers.CharField(source="approver_role.name", read_only=True, default=None)

    class Meta:
        model = ApprovalStep
        fields = [
            "id",
            "order",
            "name",
            "approver_kind",
            "approver_role",
            "approver_role_name",
            "min_amount",
            "requires_budget_check",
        ]

    def validate(self, attrs):
        if attrs.get("approver_kind") == ApprovalStep.ApproverKind.ROLE and not attrs.get("approver_role"):
            raise serializers.ValidationError({"approver_role": "Bước duyệt theo vai trò cần chọn vai trò."})
        return attrs


class ApprovalWorkflowSerializer(WorkspaceSerializer):
    steps = ApprovalStepSerializer(many=True)

    class Meta:
        model = ApprovalWorkflow
        fields = ["id", "request_type", "name", "is_financial", "is_active", "steps"]
        read_only_fields = ["request_type", "is_financial"]

    def validate_steps(self, steps):
        if not steps:
            raise serializers.ValidationError("Luồng duyệt phải có ít nhất một bước.")
        for step in steps:
            self._check_workspace(step.get("approver_role"), "steps")
        return steps

    def update(self, instance, validated_data):
        from django.db import transaction
        from django.utils import timezone

        steps = validated_data.pop("steps", None)
        with transaction.atomic():
            for key, value in validated_data.items():
                setattr(instance, key, value)
            instance.save()
            if steps is not None:
                # Replace steps. Pending requests keep their frozen plan; their step rows are soft-deleted only.
                ApprovalStep.objects.filter(workflow=instance).update(deleted_at=timezone.now())
                for order, step in enumerate(sorted(steps, key=lambda s: s["order"]), start=1):
                    step.pop("id", None)
                    step["order"] = order
                    ApprovalStep.objects.create(workflow=instance, **step)
        return instance

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["steps"] = ApprovalStepSerializer(
            ApprovalStep.objects.filter(workflow=instance).order_by("order"), many=True
        ).data
        return data


class ApprovalHistorySerializer(serializers.ModelSerializer):
    actor_detail = UserBriefField(source="actor")
    action_label = serializers.CharField(source="get_action_display", read_only=True)

    class Meta:
        model = ApprovalHistory
        fields = ["id", "step", "step_name", "actor_detail", "action", "action_label", "comment", "created_at"]


class ApprovalRequestSerializer(WorkspaceSerializer):
    requester_detail = UserBriefField(source="requester")
    project_name = serializers.CharField(source="project.name", read_only=True, default=None)
    request_type_label = serializers.CharField(source="get_request_type_display", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    current_step_name = serializers.CharField(source="current_step.name", read_only=True, default=None)
    history = serializers.SerializerMethodField()
    can_act = serializers.SerializerMethodField()
    current_approvers = serializers.SerializerMethodField()

    class Meta:
        model = ApprovalRequest
        fields = [
            "id", "code", "request_type", "request_type_label", "project", "project_name", "title",
            "description", "amount", "details", "requester", "requester_detail", "status",
            "status_label", "current_step", "current_step_name", "submitted_at", "decided_at",
            "history", "can_act", "current_approvers", "created_at", "updated_at",
        ]  # fmt: skip
        read_only_fields = ["code", "requester", "status", "current_step", "submitted_at", "decided_at"]

    def get_history(self, obj):
        if not self.context.get("with_history"):
            return None
        return ApprovalHistorySerializer(obj.history.all(), many=True).data

    def get_can_act(self, obj):
        from .services.approvals import can_act

        return can_act(obj, self.context["request"].user)

    def get_current_approvers(self, obj):
        if not self.context.get("with_history") or not obj.current_step_id:
            return []
        from .services.approvals import approvers_for

        return [user_brief(u) for u in User.objects.filter(id__in=approvers_for(obj, obj.current_step))]

    def validate_details(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("Dữ liệu chi tiết không hợp lệ.")
        lines = value.get("lines")
        if lines is not None:
            if not isinstance(lines, list):
                raise serializers.ValidationError("Danh sách dòng không hợp lệ.")
            for line in lines:
                try:
                    qty = float(line.get("quantity", 0))
                    price = float(line.get("unit_price", 0))
                except (TypeError, ValueError, AttributeError):
                    raise serializers.ValidationError("Số lượng / đơn giá phải là số.")
                if qty < 0 or price < 0:
                    raise serializers.ValidationError("Số lượng / đơn giá không được âm.")
        return value

    def validate(self, attrs):
        self._check_project(attrs.get("project"))
        details = attrs.get("details") or {}
        lines = details.get("lines")
        if lines:
            from decimal import Decimal

            total = sum(
                Decimal(str(line.get("quantity", 0))) * Decimal(str(line.get("unit_price", 0))) for line in lines
            )
            attrs["amount"] = total.quantize(Decimal("1"))
        request_type = attrs.get("request_type", getattr(self.instance, "request_type", None))
        from .models import FINANCIAL_REQUEST_TYPES

        amount = attrs.get("amount", getattr(self.instance, "amount", 0))
        if request_type in FINANCIAL_REQUEST_TYPES and (amount is None or amount <= 0):
            raise serializers.ValidationError({"amount": "Yêu cầu tài chính phải có số tiền lớn hơn 0."})
        return attrs


class NotificationSerializer(serializers.ModelSerializer):
    type_label = serializers.CharField(source="get_type_display", read_only=True)

    class Meta:
        model = Notification
        fields = [
            "id",
            "type",
            "type_label",
            "title",
            "message",
            "project",
            "entity_type",
            "entity_id",
            "link",
            "read_at",
            "created_at",
        ]


class AuditLogSerializer(serializers.ModelSerializer):
    actor_detail = UserBriefField(source="actor")

    class Meta:
        model = AuditLog
        fields = [
            "id", "actor_detail", "action", "entity_type", "entity_id", "entity_label", "project",
            "changes", "ip_address", "user_agent", "created_at",
        ]  # fmt: skip
