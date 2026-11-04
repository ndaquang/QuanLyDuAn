# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Tender (đấu thầu) life cycle and task assignment.

    screening ──go──▶ preparing ──submit──▶ submitted ──▶ evaluating ──▶ won / lost
        │                 │                     │
        └──no-go──▶ declined   (withdraw)       └──────────▶ won / lost
    any open state ──▶ cancelled (bên mời thầu hủy)

The work of a tender is a list of assigned tasks ("công việc gói thầu"): each has an
assignee, a due date, a priority and a status. Rules enforced here:

* only a holder of ``tender.approve`` takes the go / no-go decision;
* a bid can be submitted only after a "go" decision and when every task is done,
  unless a ``tender.approve`` holder forces it;
* closed tenders (won / lost / declined / cancelled) are locked.
"""

from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from ..models import Notification, ProjectProfile, Tender, TenderItem
from . import notifications
from .setup import TENDER_CHECKLIST_TEMPLATE

S = Tender.Status

# target status -> statuses it may be reached from (through transition())
TRANSITIONS = {
    S.SUBMITTED: {S.PREPARING},
    S.EVALUATING: {S.SUBMITTED},
    S.WON: {S.SUBMITTED, S.EVALUATING},
    S.LOST: {S.SUBMITTED, S.EVALUATING},
    S.CANCELLED: {S.SCREENING, S.PREPARING, S.SUBMITTED, S.EVALUATING},
    S.DECLINED: {S.PREPARING},  # withdraw after a "go"
}

PACKAGE_TO_PROJECT_TYPE = {
    Tender.PackageType.CONSTRUCTION: ProjectProfile.ProjectType.CIVIL,
    Tender.PackageType.MEP: ProjectProfile.ProjectType.MEP,
    Tender.PackageType.INTERIOR: ProjectProfile.ProjectType.INTERIOR,
}


def checklist_summary(tender):
    items = list(TenderItem.objects.filter(tender=tender).values_list("status", "due_date", "name"))
    today = timezone.localdate()
    done = sum(1 for s, _, _ in items if s == TenderItem.Status.DONE)
    return {
        "total": len(items),
        "done": done,
        "percent": round(done * 100 / len(items)) if items else 0,
        "overdue": sum(1 for s, d, _ in items if s != TenderItem.Status.DONE and d and d < today),
        "missing": [n for s, _, n in items if s != TenderItem.Status.DONE],
    }


def _notify_owner(tender, actor, title, message=""):
    notifications.notify(
        tender.workspace,
        [tender.owner_id] if tender.owner_id else [],
        Notification.Type.TENDER_DEADLINE,
        title,
        message=message,
        entity_type="tender",
        entity_id=tender.id,
        link=f"/tenders/{tender.id}",
        exclude=actor,
    )


def notify_assigned(item, actor):
    """Tell the assignee they were given a tender task."""
    if not item.assignee_id:
        return 0
    due = f" - hạn {item.due_date:%d/%m/%Y}" if item.due_date else ""
    return notifications.notify(
        item.workspace,
        [item.assignee_id],
        Notification.Type.TASK_NEW,
        f"[{item.tender.code}] Bạn được giao: {item.name}",
        message=f"Gói thầu {item.tender.name}{due}",
        entity_type="tender_item",
        entity_id=item.id,
        link=f"/tenders/{item.tender_id}?tab=tasks&item={item.id}",
        exclude=actor,
    )


@transaction.atomic
def decide(tender, ctx, decision, note=""):
    ctx.require("tender.approve")
    tender = Tender.objects.select_for_update().get(pk=tender.pk)
    if tender.status != S.SCREENING:
        raise ValidationError({"decision": "Chỉ quyết định tham dự khi gói thầu đang ở bước đánh giá sơ bộ."})
    if decision not in (Tender.Decision.GO, Tender.Decision.NO_GO):
        raise ValidationError({"decision": "Quyết định không hợp lệ."})
    if decision == Tender.Decision.NO_GO and not (note or "").strip():
        raise ValidationError({"note": "Vui lòng ghi lý do không tham dự."})
    tender.decision = decision
    tender.decision_by = ctx.user
    tender.decision_at = timezone.now()
    tender.decision_note = note or ""
    tender.status = S.PREPARING if decision == Tender.Decision.GO else S.DECLINED
    tender.save()
    _notify_owner(
        tender,
        ctx.user,
        f"[{tender.code}] {'Quyết định THAM DỰ' if decision == Tender.Decision.GO else 'Quyết định KHÔNG tham dự'}: "
        f"{tender.name}",
        message=note,
    )
    return tender


@transaction.atomic
def transition(tender, ctx, target, data):
    ctx.require("tender.update")
    tender = Tender.objects.select_for_update().get(pk=tender.pk)
    if target not in TRANSITIONS:
        raise ValidationError({"status": "Trạng thái không hợp lệ."})
    if tender.status not in TRANSITIONS[target]:
        raise ValidationError(
            {"status": f"Không thể chuyển từ '{tender.get_status_display()}' sang '{S(target).label}'."}
        )
    note = (data.get("note") or "").strip()
    if target == S.SUBMITTED:
        if tender.decision != Tender.Decision.GO:
            raise ValidationError({"status": "Gói thầu chưa có quyết định tham dự."})
        checklist = checklist_summary(tender)
        if checklist["missing"]:
            if not data.get("force"):
                raise ValidationError(
                    {"checklist": f"Còn {len(checklist['missing'])} công việc chưa hoàn thành: "
                     + "; ".join(checklist["missing"][:5])}
                )  # fmt: skip
            if not ctx.has("tender.approve"):
                raise PermissionDenied("Chỉ người có quyền duyệt đấu thầu mới được nộp khi công việc chưa xong hết.")
        tender.submitted_at = timezone.now()
    elif target == S.WON:
        tender.winner_name = (data.get("winner_name") or tender.workspace.name)[:255]
        tender.result_date = data.get("result_date") or timezone.localdate()
        tender.lost_reason = ""
    elif target == S.LOST:
        reason = data.get("lost_reason") or ""
        if reason not in Tender.LostReason.values:
            raise ValidationError({"lost_reason": "Vui lòng chọn lý do không trúng thầu."})
        tender.lost_reason = reason
        tender.winner_name = (data.get("winner_name") or "")[:255]
        tender.result_date = data.get("result_date") or timezone.localdate()
    elif target in (S.CANCELLED, S.DECLINED):
        if not note:
            raise ValidationError({"note": "Vui lòng ghi lý do."})
        if target == S.DECLINED:
            ctx.require("tender.approve")
            tender.decision = Tender.Decision.NO_GO
            tender.decision_by = ctx.user
            tender.decision_at = timezone.now()
            tender.decision_note = note
    if note:
        tender.result_note = (f"{tender.result_note}\n" if tender.result_note else "") + note
    previous = tender.status
    tender.status = target
    tender.save()
    _notify_owner(tender, ctx.user, f"[{tender.code}] {S(previous).label} → {S(target).label}: {tender.name}", note)
    return tender


def apply_checklist_template(tender, ctx):
    """Create the standard dossier tasks, assigned to the tender owner and due before the deadline."""
    ctx.require("tender.update")
    if tender.is_locked:
        raise ValidationError({"detail": "Gói thầu đã đóng."})
    existing = {n.lower() for n in TenderItem.objects.filter(tender=tender).values_list("name", flat=True)}
    deadline = timezone.localtime(tender.submission_deadline).date()
    created = []
    for category, name, offset in TENDER_CHECKLIST_TEMPLATE:
        if name.lower() in existing:
            continue
        item = TenderItem(
            workspace=tender.workspace,
            tender=tender,
            name=name,
            category=category,
            due_date=deadline + timedelta(days=offset),
            assignee_id=tender.owner_id,
        )
        item.save()
        created.append(item)
    return created


def tender_deadlines(tender):
    """Key dates of an open tender, for calendars and reminders."""
    events = [
        ("site_visit", "Khảo sát hiện trường", tender.site_visit_date),
        ("pre_bid", "Hội nghị tiền đấu thầu", tender.pre_bid_meeting_date),
        ("clarification", "Hạn hỏi đáp làm rõ", tender.clarification_deadline),
        ("submission", "Hạn nộp thầu", tender.submission_deadline),
        ("opening", "Mở thầu", tender.opening_date),
    ]
    return [(k, label, v) for k, label, v in events if v]
