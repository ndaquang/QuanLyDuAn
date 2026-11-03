# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Configurable approval workflow engine.

Rules enforced here (not in the UI):

* a request is approved only when a human approves the last applicable step -
  nothing is ever auto-approved;
* steps apply by amount threshold (``min_amount``, "phê duyệt theo hạn mức");
* the requester can never approve their own request (separation of duties); a
  step whose only possible approver is the requester is recorded as skipped;
* for financial workflows a step with no approver at all blocks submission
  instead of being skipped, so money cannot bypass a missing approver;
* steps flagged ``requires_budget_check`` need a written budget comment;
* approved / pending / cancelled requests are locked against edits.
"""

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from plane.db.models import ProjectMember, WorkspaceMember

from ..models import ApprovalHistory, ApprovalRequest, ApprovalStep, Employee, Notification, RequestType
from . import notifications


def applicable_steps(request_obj):
    steps = ApprovalStep.objects.filter(workflow=request_obj.workflow).select_related("approver_role")
    return [s for s in steps.order_by("order") if s.min_amount is None or request_obj.amount >= s.min_amount]


def _active_member_ids(workspace_id):
    return set(
        WorkspaceMember.objects.filter(workspace_id=workspace_id, is_active=True).values_list("member_id", flat=True)
    )


def candidate_approvers(request_obj, step):
    """All users allowed to act on ``step`` for this request (requester included)."""
    ws_members = _active_member_ids(request_obj.workspace_id)
    candidates = set()
    if step.approver_kind == ApprovalStep.ApproverKind.DEPARTMENT_HEAD:
        employee = (
            Employee.objects.select_related("department")
            .filter(workspace_id=request_obj.workspace_id, user_id=request_obj.requester_id)
            .first()
        )
        if employee and employee.department and employee.department.head_id:
            candidates.add(employee.department.head_id)
    elif step.approver_kind == ApprovalStep.ApproverKind.PROJECT_MANAGER:
        profile = getattr(request_obj.project, "construction_profile", None) if request_obj.project_id else None
        if profile and profile.manager_id:
            candidates.add(profile.manager_id)
    elif step.approver_kind == ApprovalStep.ApproverKind.ROLE and step.approver_role_id:
        employees = Employee.objects.filter(
            workspace_id=request_obj.workspace_id,
            role_id=step.approver_role_id,
            status=Employee.Status.ACTIVE,
            user__isnull=False,
        ).values_list("user_id", flat=True)
        users = set(employees)
        if request_obj.project_id and not step.approver_role.see_all_projects:
            users &= set(
                ProjectMember.objects.filter(project_id=request_obj.project_id, is_active=True).values_list(
                    "member_id", flat=True
                )
            )
        candidates |= users
    return candidates & ws_members


def approvers_for(request_obj, step):
    return candidate_approvers(request_obj, step) - {request_obj.requester_id}


def _notify_step(request_obj, step):
    ntype = (
        Notification.Type.PURCHASE_REQUEST
        if request_obj.request_type == RequestType.PURCHASE
        else Notification.Type.APPROVAL_REQUEST
    )
    notifications.notify(
        request_obj.workspace,
        approvers_for(request_obj, step),
        ntype,
        f"[{request_obj.code}] Cần phê duyệt: {request_obj.title}",
        message=f"Bước: {step.name}. Loại: {request_obj.get_request_type_display()}.",
        project_id=request_obj.project_id,
        entity_type="approval_request",
        entity_id=request_obj.id,
        link=f"/approvals/{request_obj.id}",
    )


def _history(request_obj, actor, action, step=None, comment=""):
    return ApprovalHistory.objects.create(
        request=request_obj,
        step=step,
        step_name=step.name if step else "",
        actor=actor,
        action=action,
        comment=comment,
    )


@transaction.atomic
def submit(request_obj, user):
    request_obj = ApprovalRequest.objects.select_for_update().get(pk=request_obj.pk)
    if request_obj.requester_id != user.id:
        raise PermissionDenied("Chỉ người lập yêu cầu mới được gửi duyệt.")
    if request_obj.status not in (ApprovalRequest.Status.DRAFT, ApprovalRequest.Status.REJECTED):
        raise ValidationError({"status": "Yêu cầu đã được gửi duyệt hoặc đã kết thúc."})
    workflow = request_obj.workflow
    if not workflow.is_active or workflow.deleted_at:
        raise ValidationError({"workflow": "Luồng phê duyệt cho loại yêu cầu này đang bị tắt."})

    plan, skipped = [], []
    for step in applicable_steps(request_obj):
        candidates = candidate_approvers(request_obj, step)
        others = candidates - {request_obj.requester_id}
        if others:
            plan.append(step)
        elif candidates:
            skipped.append((step, "Người đề nghị chính là cấp duyệt của bước này."))
        elif workflow.is_financial:
            raise ValidationError(
                {
                    "workflow": f"Bước '{step.name}' chưa có người phê duyệt. "
                    "Yêu cầu tài chính không được bỏ qua bước duyệt."
                }
            )
        else:
            skipped.append((step, "Không xác định được người duyệt cho bước này."))
    if not plan:
        raise ValidationError(
            {"workflow": "Không có người phê duyệt hợp lệ (khác người đề nghị). Yêu cầu không thể tự động duyệt."}
        )

    request_obj.status = ApprovalRequest.Status.PENDING
    request_obj.step_plan = [str(s.id) for s in plan]
    request_obj.current_step = plan[0]
    request_obj.submitted_at = timezone.now()
    request_obj.decided_at = None
    request_obj.save()
    _history(request_obj, user, ApprovalHistory.Action.SUBMIT)
    for step, reason in skipped:
        _history(request_obj, None, ApprovalHistory.Action.SKIP, step=step, comment=reason)
    _notify_step(request_obj, plan[0])
    return request_obj


def can_act(request_obj, user):
    return (
        request_obj.status == ApprovalRequest.Status.PENDING
        and request_obj.current_step_id is not None
        and user.id in approvers_for(request_obj, request_obj.current_step)
    )


@transaction.atomic
def approve(request_obj, user, comment=""):
    request_obj = (
        ApprovalRequest.objects.select_for_update(of=("self",)).select_related("current_step").get(pk=request_obj.pk)
    )
    if not can_act(request_obj, user):
        raise PermissionDenied("Bạn không phải người phê duyệt của bước hiện tại.")
    step = request_obj.current_step
    if step.requires_budget_check and not (comment or "").strip():
        raise ValidationError({"comment": "Bước kiểm tra ngân sách bắt buộc ghi ý kiến kế toán."})
    _history(request_obj, user, ApprovalHistory.Action.APPROVE, step=step, comment=comment)

    plan = request_obj.step_plan or []
    idx = plan.index(str(step.id)) if str(step.id) in plan else len(plan) - 1
    if idx + 1 < len(plan):
        next_step = ApprovalStep.all_objects.get(pk=plan[idx + 1])
        request_obj.current_step = next_step
        request_obj.save()
        _notify_step(request_obj, next_step)
    else:
        request_obj.status = ApprovalRequest.Status.APPROVED
        request_obj.current_step = None
        request_obj.decided_at = timezone.now()
        request_obj.save()
        notifications.notify(
            request_obj.workspace,
            [request_obj.requester_id],
            Notification.Type.APPROVAL_RESULT,
            f"[{request_obj.code}] Đã được phê duyệt: {request_obj.title}",
            project_id=request_obj.project_id,
            entity_type="approval_request",
            entity_id=request_obj.id,
            link=f"/approvals/{request_obj.id}",
        )
    return request_obj


@transaction.atomic
def reject(request_obj, user, comment=""):
    request_obj = (
        ApprovalRequest.objects.select_for_update(of=("self",)).select_related("current_step").get(pk=request_obj.pk)
    )
    if not can_act(request_obj, user):
        raise PermissionDenied("Bạn không phải người phê duyệt của bước hiện tại.")
    if not (comment or "").strip():
        raise ValidationError({"comment": "Vui lòng ghi lý do từ chối."})
    _history(request_obj, user, ApprovalHistory.Action.REJECT, step=request_obj.current_step, comment=comment)
    request_obj.status = ApprovalRequest.Status.REJECTED
    request_obj.current_step = None
    request_obj.decided_at = timezone.now()
    request_obj.save()
    notifications.notify(
        request_obj.workspace,
        [request_obj.requester_id],
        Notification.Type.APPROVAL_RESULT,
        f"[{request_obj.code}] Bị từ chối: {request_obj.title}",
        message=comment,
        project_id=request_obj.project_id,
        entity_type="approval_request",
        entity_id=request_obj.id,
        link=f"/approvals/{request_obj.id}",
    )
    return request_obj


@transaction.atomic
def cancel(request_obj, user, comment=""):
    request_obj = ApprovalRequest.objects.select_for_update().get(pk=request_obj.pk)
    if request_obj.requester_id != user.id:
        raise PermissionDenied("Chỉ người lập yêu cầu mới được hủy.")
    if request_obj.status not in (
        ApprovalRequest.Status.DRAFT,
        ApprovalRequest.Status.PENDING,
        ApprovalRequest.Status.REJECTED,
    ):
        raise ValidationError({"status": "Yêu cầu đã được phê duyệt, không thể hủy."})
    _history(request_obj, user, ApprovalHistory.Action.CANCEL, step=request_obj.current_step, comment=comment)
    request_obj.status = ApprovalRequest.Status.CANCELLED
    request_obj.current_step = None
    request_obj.decided_at = timezone.now()
    request_obj.save()
    return request_obj
