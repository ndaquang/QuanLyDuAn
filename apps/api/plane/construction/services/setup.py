# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Idempotent initial configuration of a company (workspace).

Creates master data only - permission catalogue, default business roles with their
permission matrix, default departments and approval workflows. It never creates
projects, employees or transactions, so it is safe on a production database.
"""

from decimal import Decimal

from django.db import transaction

from ..models import (
    ApprovalStep,
    ApprovalWorkflow,
    Department,
    FINANCIAL_REQUEST_TYPES,
    Permission,
    RequestType,
    Role,
    RolePermission,
)
from ..permissions import DEFAULT_ROLES, permission_catalogue

DEFAULT_DEPARTMENTS = [
    ("BGD", "Ban Giám đốc"),
    ("PDA", "Phòng Dự án"),
    ("PKT", "Phòng Kỹ thuật - QS"),
    ("PTM", "Phòng Thu mua - Đấu thầu"),
    ("HSE", "Phòng An toàn - Môi trường"),
    ("HCNS", "Phòng Nhân sự - Hành chính"),
    ("PKTOAN", "Phòng Kế toán"),
]

# Approval limit above which the director must sign (VND). Editable per workflow step.
DIRECTOR_LIMIT = Decimal("50000000")


def _financial_steps(director_min):
    return [
        ("Trưởng bộ phận kiểm tra", ApprovalStep.ApproverKind.DEPARTMENT_HEAD, None, None, False),
        ("Trưởng dự án xác nhận", ApprovalStep.ApproverKind.PROJECT_MANAGER, None, None, False),
        ("Kế toán kiểm tra ngân sách", ApprovalStep.ApproverKind.ROLE, "accountant", None, True),
        ("Giám đốc phê duyệt", ApprovalStep.ApproverKind.ROLE, "director", director_min, False),
    ]


DEFAULT_WORKFLOWS = {
    RequestType.PURCHASE: ("Đề xuất mua vật tư", _financial_steps(DIRECTOR_LIMIT)),
    RequestType.PAYMENT: ("Đề nghị thanh toán", _financial_steps(DIRECTOR_LIMIT)),
    RequestType.ADVANCE: ("Đề nghị tạm ứng", _financial_steps(DIRECTOR_LIMIT)),
    RequestType.VARIATION: ("Chi phí phát sinh", _financial_steps(DIRECTOR_LIMIT)),
    # Budget changes and contracts always go to the director, whatever the amount.
    RequestType.BUDGET_ADJUSTMENT: ("Điều chỉnh ngân sách", _financial_steps(None)),
    RequestType.CONTRACT: ("Phê duyệt hợp đồng", _financial_steps(None)),
    RequestType.LEAVE: (
        "Đơn nghỉ phép",
        [
            ("Trưởng bộ phận duyệt", ApprovalStep.ApproverKind.DEPARTMENT_HEAD, None, None, False),
            ("Nhân sự ghi nhận", ApprovalStep.ApproverKind.ROLE, "hr_admin", None, False),
        ],
    ),
}


def sync_permissions():
    """Make the cx_permissions table match the code catalogue."""
    codes = set()
    for code, module, action, name, order in permission_catalogue():
        codes.add(code)
        Permission.objects.update_or_create(
            code=code, defaults={"module": module, "action": action, "name": name, "sort_order": order}
        )
    Permission.objects.exclude(code__in=codes).delete()


@transaction.atomic
def ensure_workspace_setup(workspace, user=None):
    sync_permissions()
    perms = {p.code: p for p in Permission.objects.all()}
    roles = {}
    for order, spec in enumerate(DEFAULT_ROLES):
        role = Role.objects.filter(workspace=workspace, code=spec["code"]).first()
        if role is None:
            role = Role(
                workspace=workspace,
                code=spec["code"],
                name=spec["name"],
                description=spec["description"],
                see_all_projects=spec["see_all_projects"],
                is_system=True,
                sort_order=order,
            )
            role.save(created_by_id=getattr(user, "id", None))
            RolePermission.objects.bulk_create(
                [RolePermission(role=role, permission=perms[c]) for c in sorted(set(spec["permissions"]))]
            )
        roles[spec["code"]] = role

    for code, name in DEFAULT_DEPARTMENTS:
        if not Department.objects.filter(workspace=workspace, code=code).exists():
            Department(workspace=workspace, code=code, name=name).save(created_by_id=getattr(user, "id", None))

    for request_type, (name, steps) in DEFAULT_WORKFLOWS.items():
        if ApprovalWorkflow.objects.filter(workspace=workspace, request_type=request_type).exists():
            continue
        workflow = ApprovalWorkflow(
            workspace=workspace,
            request_type=request_type,
            name=name,
            is_financial=request_type in FINANCIAL_REQUEST_TYPES,
        )
        workflow.save(created_by_id=getattr(user, "id", None))
        for order, (step_name, kind, role_code, min_amount, budget_check) in enumerate(steps, start=1):
            ApprovalStep(
                workflow=workflow,
                order=order,
                name=step_name,
                approver_kind=kind,
                approver_role=roles.get(role_code) if role_code else None,
                min_amount=min_amount,
                requires_budget_check=budget_check,
            ).save(created_by_id=getattr(user, "id", None))
    return roles
