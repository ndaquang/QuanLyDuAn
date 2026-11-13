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

    for request_type in DEFAULT_WORKFLOWS:
        ensure_default_workflow(workspace, request_type, roles, user)
    return roles


def ensure_default_workflow(workspace, request_type, roles=None, user=None):
    """Create the default workflow of ``request_type`` if the company has none (idempotent).

    Lets companies configured before a request type existed pick it up on first use.
    """
    existing = ApprovalWorkflow.objects.filter(workspace=workspace, request_type=request_type).first()
    if existing is not None:
        return existing
    if roles is None:
        roles = {r.code: r for r in Role.objects.filter(workspace=workspace)}
    name, steps = DEFAULT_WORKFLOWS[request_type]
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
    return workflow


# Standard structure of a Vietnamese bid dossier (HSDT xây lắp). Used by "Tạo danh mục hồ sơ mẫu".
TENDER_CHECKLIST_TEMPLATE = [
    ("legal", "Đơn dự thầu, thỏa thuận liên danh (nếu có)", -3),
    ("legal", "Giấy ủy quyền ký HSDT", -3),
    ("legal", "Giấy chứng nhận đăng ký doanh nghiệp, chứng chỉ năng lực hoạt động xây dựng", -5),
    ("legal", "Báo cáo tài chính 3 năm gần nhất, xác nhận nghĩa vụ thuế", -5),
    ("legal", "Hợp đồng tương tự đã thực hiện (kèm biên bản nghiệm thu, thanh lý)", -5),
    ("technical", "Biện pháp tổ chức thi công tổng thể và chi tiết", -4),
    ("technical", "Tiến độ thi công (Gantt), biểu đồ nhân lực - thiết bị", -4),
    ("technical", "Danh sách nhân sự chủ chốt (CV, bằng cấp, chứng chỉ hành nghề)", -4),
    ("technical", "Danh sách máy móc thiết bị thi công (sở hữu / thuê)", -4),
    ("technical", "Biện pháp đảm bảo chất lượng, an toàn lao động, vệ sinh môi trường, PCCC", -4),
    ("technical", "Danh mục vật liệu chính, catalogue, xuất xứ", -4),
    ("financial", "Bóc tách khối lượng, kiểm tra BOQ / bảng tiên lượng", -6),
    ("financial", "Rà soát yêu cầu HSMT, bảng khối lượng mời thầu", -6),
    ("other", "Kiểm tra chéo, ký đóng dấu, nộp HSDT", 0),
]
