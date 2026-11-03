# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Role/permission catalogue and server-side access checks.

Access to any construction resource requires, in order:

1. an authenticated, active member of the workspace (Plane ``WorkspaceMember``);
2. the ``<module>.<action>`` permission granted to the member's business role
   (``Employee.role``) - workspace admins (Plane role 20) are system
   administrators and hold every permission;
3. for project data, access to that project: roles with ``see_all_projects``
   and workspace admins see every project, everyone else only the projects
   where they are an active Plane ``ProjectMember``.

These checks run in the API; the UI only mirrors them.
"""

from dataclasses import dataclass, field
from functools import cached_property

from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.permissions import BasePermission

from plane.db.models import ProjectMember, Workspace, WorkspaceMember

WORKSPACE_ADMIN_ROLE = 20

ACTIONS = {
    "view": "Xem",
    "create": "Thêm",
    "update": "Sửa",
    "delete": "Xóa",
    "approve": "Duyệt",
}

# module -> (Vietnamese label, supported actions)
MODULES = {
    "dashboard": ("Dashboard điều hành", ["view"]),
    "project": ("Dự án", ["view", "create", "update", "delete"]),
    "schedule": ("Tiến độ thi công", ["view", "create", "update", "delete"]),
    "task": ("Công việc", ["view", "create", "update", "delete"]),
    "daily_report": ("Nhật ký công trường", ["view", "create", "update", "delete", "approve"]),
    "employee": ("Nhân sự", ["view", "create", "update", "delete"]),
    "department": ("Phòng ban", ["view", "create", "update", "delete"]),
    "document": ("Hồ sơ kỹ thuật", ["view", "create", "update", "delete", "approve"]),
    "tender": ("Đấu thầu", ["view", "create", "update", "delete"]),
    "material": ("Vật tư", ["view", "create", "update", "delete"]),
    "supplier": ("Nhà cung cấp", ["view", "create", "update", "delete"]),
    "approval": ("Yêu cầu phê duyệt", ["view", "create"]),
    "approval_config": ("Cấu hình luồng duyệt", ["view", "update"]),
    "report": ("Báo cáo quản trị", ["view"]),
    "audit": ("Nhật ký hoạt động", ["view"]),
    "role": ("Phân quyền", ["view", "update"]),
    "account": ("Tài khoản người dùng", ["create", "update"]),
}


def permission_catalogue():
    """[(code, module, action, name, sort_order), ...]"""
    rows = []
    order = 0
    for module, (label, actions) in MODULES.items():
        for action in actions:
            order += 1
            rows.append((f"{module}.{action}", module, action, f"{ACTIONS[action]} - {label}", order))
    return rows


ALL = [code for code, *_ in permission_catalogue()]


def _codes(*specs):
    """_codes("project:view,update", "task:*") -> ["project.view", "project.update", "task.view", ...]"""
    result = []
    for spec in specs:
        module, actions = spec.split(":")
        available = MODULES[module][1]
        wanted = available if actions == "*" else actions.split(",")
        for action in wanted:
            if action not in available:
                raise ValueError(f"{module}.{action} is not a known permission")
            result.append(f"{module}.{action}")
    return result


_BASE = ["dashboard:view", "project:view", "schedule:view", "task:view", "report:view", "approval:*"]

# Default business roles. Each company can edit the matrix afterwards (module "role").
DEFAULT_ROLES = [
    {
        "code": "director",
        "name": "Giám đốc",
        "description": "Điều hành toàn công ty, phê duyệt theo hạn mức.",
        "see_all_projects": True,
        "permissions": ALL,
    },
    {
        "code": "project_manager",
        "name": "Trưởng phòng dự án",
        "description": "Quản lý dự án, phân công công việc, kiểm soát tiến độ.",
        "see_all_projects": True,
        "permissions": _codes(
            *_BASE,
            "project:*",
            "schedule:*",
            "task:*",
            "daily_report:*",
            "document:*",
            "tender:view",
            "material:view",
            "supplier:view",
            "employee:view",
            "department:view",
            "audit:view",
        ),
    },
    {
        "code": "civil_engineer",
        "name": "Kỹ sư xây dựng",
        "description": "Theo dõi khối lượng, tiến độ thi công phần xây dựng.",
        "see_all_projects": False,
        "permissions": _codes(
            *_BASE,
            "schedule:view,create,update",
            "task:view,create,update",
            "daily_report:view,create,update",
            "document:view,create,update",
            "material:view",
            "employee:view",
        ),
    },
    {
        "code": "mep_engineer",
        "name": "Kỹ sư MEP",
        "description": "Quản lý hệ thống điện, nước, điều hòa và cơ điện.",
        "see_all_projects": False,
        "permissions": _codes(
            *_BASE,
            "schedule:view,create,update",
            "task:view,create,update",
            "daily_report:view,create,update",
            "document:view,create,update",
            "material:view",
            "employee:view",
        ),
    },
    {
        "code": "qs",
        "name": "Nhân viên QS",
        "description": "Bóc tách khối lượng, dự toán, phát sinh, thanh quyết toán.",
        "see_all_projects": False,
        "permissions": _codes(
            *_BASE,
            "task:view,create,update",
            "daily_report:view",
            "document:view,create,update",
            "tender:view,create,update",
            "material:view,create,update",
            "supplier:view",
        ),
    },
    {
        "code": "hse",
        "name": "Nhân viên HSE",
        "description": "An toàn lao động và môi trường công trường.",
        "see_all_projects": False,
        "permissions": _codes(
            *_BASE,
            "task:view,create,update",
            "daily_report:view,create,update",
            "document:view,create,update",
            "employee:view",
        ),
    },
    {
        "code": "procurement",
        "name": "Nhân viên thu mua, gọi thầu",
        "description": "Mua vật tư, quản lý nhà cung cấp, gọi thầu thầu phụ.",
        "see_all_projects": False,
        "permissions": _codes(
            *_BASE,
            "task:view,create,update",
            "document:view,create",
            "tender:*",
            "material:*",
            "supplier:*",
        ),
    },
    {
        "code": "hr_admin",
        "name": "Nhân sự - Hành chính",
        "description": "Hồ sơ nhân sự, hồ sơ dự án, tài khoản người dùng.",
        "see_all_projects": True,
        "permissions": _codes(
            *_BASE,
            "task:view,create,update",
            "employee:*",
            "department:*",
            "document:*",
            "tender:view",
            "account:*",
            "audit:view",
        ),
    },
    {
        "code": "accountant",
        "name": "Kế toán",
        "description": "Kiểm tra ngân sách trong các yêu cầu tài chính.",
        "see_all_projects": True,
        "permissions": _codes(*_BASE, "document:view", "material:view", "supplier:view", "tender:view"),
    },
]


# ---------------------------------------------------------------------------
# Runtime access context
# ---------------------------------------------------------------------------


@dataclass
class AccessContext:
    user: object
    workspace: Workspace
    workspace_role: int
    employee: object = None
    role: object = None
    permissions: frozenset = field(default_factory=frozenset)

    @property
    def is_admin(self):
        return self.workspace_role == WORKSPACE_ADMIN_ROLE

    @property
    def sees_all_projects(self):
        return self.is_admin or bool(self.role and self.role.see_all_projects)

    def has(self, code):
        return self.is_admin or code in self.permissions

    def require(self, code):
        if not self.has(code):
            raise PermissionDenied(f"Bạn không có quyền thực hiện thao tác này ({code}).")

    @cached_property
    def member_project_ids(self):
        return set(
            ProjectMember.objects.filter(
                member=self.user, workspace=self.workspace, is_active=True, project__archived_at__isnull=True
            ).values_list("project_id", flat=True)
        )

    def can_access_project(self, project_id):
        if project_id is None:
            return True
        if self.sees_all_projects:
            from plane.db.models import Project

            return Project.objects.filter(pk=project_id, workspace=self.workspace).exists()
        return _as_uuid(project_id) in self.member_project_ids

    def require_project(self, project_id):
        if not self.can_access_project(project_id):
            # 404 rather than 403 so project ids are not leaked.
            raise NotFound("Không tìm thấy dự án hoặc bạn không phải thành viên dự án.")

    def filter_projects(self, queryset, field_name="project_id"):
        """Restrict a queryset to rows of projects visible to the user (rows without project stay)."""
        if self.sees_all_projects:
            return queryset
        from django.db.models import Q

        return queryset.filter(
            Q(**{f"{field_name}__in": self.member_project_ids}) | Q(**{f"{field_name}__isnull": True})
        )

    def to_dict(self):
        return {
            "workspace": {"id": str(self.workspace.id), "slug": self.workspace.slug, "name": self.workspace.name},
            "is_admin": self.is_admin,
            "sees_all_projects": self.sees_all_projects,
            "employee_id": str(self.employee.id) if self.employee else None,
            "role": {"id": str(self.role.id), "code": self.role.code, "name": self.role.name} if self.role else None,
            "permissions": sorted(ALL if self.is_admin else self.permissions),
        }


def _as_uuid(value):
    import uuid

    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        return None


def build_access_context(user, slug):
    from .models import Employee

    membership = (
        WorkspaceMember.objects.select_related("workspace")
        .filter(member=user, workspace__slug=slug, is_active=True)
        .first()
    )
    if membership is None:
        raise NotFound("Không tìm thấy công ty hoặc bạn không phải thành viên.")
    employee = (
        Employee.objects.select_related("role")
        .filter(workspace=membership.workspace, user=user, status=Employee.Status.ACTIVE)
        .first()
    )
    role = employee.role if employee and employee.role and employee.role.deleted_at is None else None
    permissions = frozenset(role.permissions.values_list("code", flat=True)) if role else frozenset()
    return AccessContext(
        user=user,
        workspace=membership.workspace,
        workspace_role=membership.role,
        employee=employee,
        role=role,
        permissions=permissions,
    )


METHOD_ACTIONS = {
    "GET": "view",
    "HEAD": "view",
    "OPTIONS": "view",
    "POST": "create",
    "PUT": "update",
    "PATCH": "update",
    "DELETE": "delete",
}


class ConstructionPermission(BasePermission):
    """Resolves the access context and enforces ``<view.permission_module>.<action>``.

    A view may override the required code per DRF action with ``permission_map``
    (``{"approve": "daily_report.approve"}``) or opt out of the module check for
    an action by mapping it to ``None`` (the view then checks inline).
    """

    def has_permission(self, request, view):
        if not request.user or request.user.is_anonymous:
            return False
        ctx = build_access_context(request.user, view.kwargs["slug"])
        request.cx = ctx
        action = getattr(view, "action", None)
        permission_map = getattr(view, "permission_map", {}) or {}
        if action in permission_map:
            code = permission_map[action]
        else:
            module = getattr(view, "permission_module", None)
            if module is None:
                return True
            code = f"{module}.{METHOD_ACTIONS.get(request.method, 'view')}"
        if code is not None:
            ctx.require(code)
        return True
