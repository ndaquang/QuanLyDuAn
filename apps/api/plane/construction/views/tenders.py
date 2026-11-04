# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Tender management: pipeline, assigned dossier tasks, clarifications and the shared
capability library. No price data is kept here by design."""

from collections import Counter
from datetime import date, timedelta

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from ..models import (
    CapabilityDocument,
    ProjectProfile,
    Tender,
    TenderClarification,
    TenderItem,
    TenderItemComment,
)
from ..serializers import (
    CapabilityDocumentSerializer,
    ProjectSerializer,
    TenderClarificationSerializer,
    TenderItemCommentSerializer,
    TenderItemSerializer,
    TenderSerializer,
    user_brief,
)
from ..services import audit
from ..services import projects as project_service
from ..services import tenders as tender_service
from ..services.progress import project_progress
from .base import CxViewSet, LockedError

S = Tender.Status
PACKAGE_TYPES = tender_service.PACKAGE_TO_PROJECT_TYPE


def _parse_date(value, field):
    if value in (None, ""):
        return None
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        raise ValidationError({field: "Ngày không hợp lệ (YYYY-MM-DD)."})


class TenderViewSet(CxViewSet):
    model = Tender
    serializer_class = TenderSerializer
    permission_module = "tender"
    # Workflow actions check their own permission in the service layer.
    permission_map = {
        "decide": "tender.view",
        "transition": "tender.view",
        "apply_template": "tender.view",
        "create_project": "project.create",
        "stats": "tender.view",
        "calendar": "tender.view",
    }
    select_related = ("owner", "project", "decision_by")
    search_fields = ("code", "name", "investor", "location", "source")
    filter_fields = {
        "status": "status__in",
        "owner": "owner_id",
        "package_type": "package_type",
        "selection_method": "selection_method",
        "deadline_from": "submission_deadline__date__gte",
        "deadline_to": "submission_deadline__date__lte",
    }
    ordering_fields = ("submission_deadline", "code", "created_at")
    export_title = "Theo dõi đấu thầu"
    export_columns = [
        ("Mã gói thầu", "code"),
        ("Tên gói thầu", "name"),
        ("Bên mời thầu", "investor"),
        ("Hình thức", "selection_method"),
        ("Loại gói thầu", "package_type"),
        ("Người phụ trách", "owner_detail"),
        ("Hạn nộp thầu", "submission_deadline"),
        ("Trạng thái", "status_label"),
        ("Công việc hoàn thành (%)", "checklist.percent"),
        ("Công việc quá hạn", "checklist.overdue"),
        ("Nhà thầu trúng", "winner_name"),
    ]

    def extra_context(self):
        return {"with_counts": self.action != "list"}

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        if self.request.query_params.get("open") == "true":
            queryset = queryset.filter(status__in=Tender.OPEN_STATUSES)
        if self.request.query_params.get("mine") == "true":
            u = self.request.user
            queryset = queryset.filter(Q(owner=u) | Q(items__assignee=u)).distinct()
        return queryset

    def check_locked(self, instance):
        if instance.is_locked:
            raise LockedError("Gói thầu đã đóng, không thể chỉnh sửa.")

    def before_destroy(self, instance):
        if instance.status not in (S.SCREENING, S.DECLINED, S.CANCELLED):
            raise ValidationError({"detail": "Chỉ xóa được gói thầu chưa lập hồ sơ, không tham dự hoặc đã hủy."})

    def _result(self, tender):
        tender = self.base_queryset().get(pk=tender.pk)
        return Response(self.get_serializer(tender).data)

    def perform_update(self, serializer):
        old_owner = serializer.instance.owner_id
        super().perform_update(serializer)
        tender = serializer.instance
        if tender.owner_id and tender.owner_id != old_owner and tender.owner_id != self.request.user.id:
            from ..models import Notification
            from ..services import notifications

            notifications.notify(
                self.cx.workspace,
                [tender.owner_id],
                Notification.Type.TASK_NEW,
                f"[{tender.code}] Bạn phụ trách gói thầu: {tender.name}",
                entity_type="tender",
                entity_id=tender.id,
                link=f"/tenders/{tender.id}",
            )

    @action(detail=True, methods=["post"])
    def decide(self, request, slug, pk=None):
        tender = tender_service.decide(
            self.get_object(), self.cx, request.data.get("decision"), request.data.get("note", "")
        )
        audit.record(
            request, "decide", tender, changes={"decision": {"new": tender.decision}, "note": tender.decision_note}
        )
        return self._result(tender)

    @action(detail=True, methods=["post"])
    def transition(self, request, slug, pk=None):
        data = {k: (v[0] if isinstance(v, list) and len(v) == 1 else v) for k, v in dict(request.data).items()}
        data["result_date"] = _parse_date(data.get("result_date"), "result_date")
        before = self.get_object().status
        tender = tender_service.transition(self.get_object(), self.cx, request.data.get("status"), data)
        audit.record(request, "transition", tender, changes={"status": {"old": before, "new": tender.status}})
        return self._result(tender)

    @action(detail=True, methods=["post"], url_path="apply-template")
    def apply_template(self, request, slug, pk=None):
        tender = self.get_object()
        created = tender_service.apply_checklist_template(tender, self.cx)
        for item in created:
            tender_service.notify_assigned(item, request.user)
        audit.record(request, "apply_template", tender, changes={"tasks": {"new": len(created)}})
        return Response(
            TenderItemSerializer(created, many=True, context=self.get_serializer_context()).data, status=201
        )

    @action(detail=True, methods=["post"], url_path="create-project")
    def create_project(self, request, slug, pk=None):
        """Turn a won tender into a construction project (Plane project + profile)."""
        tender = self.get_object()
        if tender.status != S.WON:
            raise ValidationError({"detail": "Chỉ tạo dự án từ gói thầu đã trúng."})
        if tender.project_id:
            raise ValidationError({"detail": "Gói thầu đã được gắn với một dự án."})
        d = request.data
        payload = {
            "code": d.get("code"),
            "name": d.get("name") or tender.name,
            "investor": tender.investor,
            "location": tender.location,
            "project_type": PACKAGE_TYPES.get(tender.package_type, ProjectProfile.ProjectType.OTHER),
            "start_date": d.get("start_date"),
            "planned_end_date": d.get("planned_end_date"),
            "manager": d.get("manager"),
            "department": d.get("department") or None,
            "description": f"Tạo từ gói thầu {tender.code}. {tender.result_note}".strip(),
            "member_ids": d.get("member_ids") or [],
        }
        serializer = ProjectSerializer(data=payload, context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        member_ids = data.pop("member_ids", [])
        name = data.pop("project")["name"]
        with transaction.atomic():
            project = project_service.create_plane_project(
                self.cx.workspace, request.user, name=name, code=data["code"], manager_id=data["manager"].id,
                member_ids=member_ids, description=data.get("description", ""),
            )  # fmt: skip
            profile = ProjectProfile(workspace=self.cx.workspace, project=project, **data)
            profile.save()
            tender.project = project
            tender.save(update_fields=["project", "updated_at"])
        audit.record(request, "create_project", tender, changes={"project": {"new": str(project.id)}})
        audit.record(request, "create", profile, project_id=project.id)
        ctx = {**self.get_serializer_context(), "progress": project_progress([project.id])}
        return Response(ProjectSerializer(profile, context=ctx).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"])
    def stats(self, request, slug):
        """Pipeline, task load and win-rate figures, computed from live data."""
        qs = self.base_queryset()
        year = request.query_params.get("year")
        if year:
            try:
                qs = qs.filter(submission_deadline__year=int(year))
            except ValueError:
                raise ValidationError({"year": "Năm không hợp lệ."})
        by_status = Counter(qs.values_list("status", flat=True))
        won, lost = by_status.get(S.WON, 0), by_status.get(S.LOST, 0)
        now = timezone.now()
        today = timezone.localdate()
        open_qs = qs.filter(status__in=Tender.OPEN_STATUSES)
        tasks = TenderItem.objects.filter(
            workspace=self.cx.workspace,
            tender__in=qs.filter(status__in=(S.SCREENING, S.PREPARING)),
        )
        mine = tasks.filter(assignee=request.user).exclude(status=TenderItem.Status.DONE)
        return Response(
            {
                "total": qs.count(),
                "by_status": [{"status": s.value, "label": s.label, "count": by_status.get(s.value, 0)} for s in S],
                "open": open_qs.count(),
                "due_7_days": open_qs.filter(
                    status__in=(S.SCREENING, S.PREPARING),
                    submission_deadline__gte=now,
                    submission_deadline__lte=now + timedelta(days=7),
                ).count(),
                "won": won,
                "lost": lost,
                "win_rate": round(won * 100 / (won + lost), 1) if won + lost else None,
                "lost_reasons": [
                    {"reason": k, "label": Tender.LostReason(k).label, "count": v}
                    for k, v in Counter(
                        qs.filter(status=S.LOST).exclude(lost_reason="").values_list("lost_reason", flat=True)
                    ).items()
                ],
                "tasks": {
                    "open": tasks.exclude(status=TenderItem.Status.DONE).count(),
                    "overdue": tasks.exclude(status=TenderItem.Status.DONE).filter(due_date__lt=today).count(),
                    "done": tasks.filter(status=TenderItem.Status.DONE).count(),
                    "mine_open": mine.count(),
                    "mine_overdue": mine.filter(due_date__lt=today).count(),
                },
            }
        )

    @action(detail=False, methods=["get"])
    def calendar(self, request, slug):
        """Key dates of open tenders and open task due dates between ``from`` and ``to``."""
        today = timezone.localdate()
        start = _parse_date(request.query_params.get("from"), "from") or today.replace(day=1) - timedelta(days=7)
        end = _parse_date(request.query_params.get("to"), "to") or start + timedelta(days=45)
        events = []
        for t in self.base_queryset().filter(status__in=Tender.OPEN_STATUSES):
            for kind, label, value in tender_service.tender_deadlines(t):
                day = timezone.localtime(value).date() if hasattr(value, "hour") else value
                if start <= day <= end:
                    events.append({
                        "tender_id": str(t.id), "code": t.code, "name": t.name, "kind": kind, "label": label,
                        "date": day, "at": value if hasattr(value, "hour") else None, "owner": user_brief(t.owner),
                    })  # fmt: skip
        open_items = TenderItem.objects.filter(
            tender__in=self.base_queryset().filter(status__in=(S.SCREENING, S.PREPARING)),
            due_date__gte=start,
            due_date__lte=end,
        ).exclude(status=TenderItem.Status.DONE)
        if request.query_params.get("mine") == "true":
            open_items = open_items.filter(assignee=request.user)
        for item in open_items.select_related("tender", "assignee"):
            events.append({
                "tender_id": str(item.tender_id), "code": item.tender.code, "name": item.name, "kind": "item",
                "label": "Hạn công việc", "date": item.due_date, "at": None, "owner": user_brief(item.assignee),
            })  # fmt: skip
        events.sort(key=lambda e: (e["date"], e["code"]))
        return Response({"from": start, "to": end, "events": events})


class _TenderChildViewSet(CxViewSet):
    permission_module = "tender"
    filter_fields = {"tender": "tender_id"}

    def get_queryset(self):
        return super().get_queryset().filter(tender__deleted_at__isnull=True)

    def check_locked(self, instance):
        if instance.tender.is_locked:
            raise LockedError("Gói thầu đã đóng, không thể thay đổi.")


class TenderItemViewSet(_TenderChildViewSet):
    """Tasks of a tender. ``?tender=<id>`` lists one tender; without it, ``?assignee=me`` etc. list across tenders."""

    model = TenderItem
    serializer_class = TenderItemSerializer
    select_related = ("assignee", "tender", "created_by")
    search_fields = ("name", "description", "tender__code", "tender__name")
    filter_fields = {
        "tender": "tender_id",
        "status": "status__in",
        "priority": "priority__in",
        "category": "category",
    }
    ordering_fields = ("due_date", "priority", "created_at")
    # The assignee may report on their own task (status / note) without tender.update;
    # the same holds for commenting and attaching files.
    permission_map = {"partial_update": "tender.view", "comments": "tender.view"}
    export_title = "Công việc đấu thầu"
    export_columns = [
        ("Gói thầu", "tender_code"),
        ("Công việc", "name"),
        ("Nhóm", "category"),
        ("Người thực hiện", "assignee_detail"),
        ("Người giao", "created_by_detail"),
        ("Hạn", "due_date"),
        ("Ưu tiên", "priority"),
        ("Trạng thái", "status"),
        ("Quá hạn", lambda r: "Có" if r["is_overdue"] else ""),
    ]

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        assignee = self.request.query_params.get("assignee")
        if assignee == "me":
            queryset = queryset.filter(assignee=self.request.user)
        elif assignee:
            try:
                queryset = queryset.filter(assignee_id=assignee)
            except (ValueError, DjangoValidationError):
                raise ValidationError({"assignee": "Giá trị lọc không hợp lệ."})
        if self.request.query_params.get("overdue") == "true":
            queryset = queryset.filter(due_date__lt=timezone.localdate()).exclude(status=TenderItem.Status.DONE)
        if self.request.query_params.get("created_by") == "me":
            queryset = queryset.filter(created_by=self.request.user)
        if self.request.query_params.get("open_tenders") == "true":
            queryset = queryset.filter(tender__status__in=(S.SCREENING, S.PREPARING))
        return queryset.order_by(*(queryset.query.order_by or ("due_date", "created_at")))

    def list(self, request, *args, **kwargs):
        if not request.query_params.get("tender") and not self.cx.has("tender.view"):
            raise PermissionDenied()
        return super().list(request, *args, **kwargs)

    def after_create(self, instance):
        tender_service.notify_assigned(instance, self.request.user)

    def perform_update(self, serializer):
        item = serializer.instance
        is_assignee = item.assignee_id == self.request.user.id
        if not self.cx.has("tender.update") and (not is_assignee or not set(self.request.data) <= {"status", "note"}):
            raise PermissionDenied("Bạn chỉ được cập nhật trạng thái / ghi chú công việc được giao cho mình.")
        super().perform_update(serializer)

    def after_update(self, instance, before):
        if str(before.get("assignee") or "") != str(instance.assignee_id or ""):
            tender_service.notify_assigned(instance, self.request.user)
        if before.get("status") != instance.status and instance.status == TenderItem.Status.DONE:
            from ..models import Notification
            from ..services import notifications

            notifications.notify(
                self.cx.workspace,
                [instance.tender.owner_id] if instance.tender.owner_id else [],
                Notification.Type.TASK_NEW,
                f"[{instance.tender.code}] Đã hoàn thành: {instance.name}",
                message=f"Cập nhật bởi {self.request.user.display_name or self.request.user.email}",
                entity_type="tender_item",
                entity_id=instance.id,
                link=f"/tenders/{instance.tender_id}?tab=tasks&item={instance.id}",
                exclude=self.request.user,
            )

    @action(detail=True, methods=["get", "post"])
    def comments(self, request, slug, pk=None):
        item = self.get_object()
        if request.method == "POST":
            if item.tender.is_locked:
                raise LockedError("Gói thầu đã đóng, không thể thay đổi.")
            allowed = self.cx.has("tender.update") or item.assignee_id == request.user.id
            if not allowed:
                raise PermissionDenied("Bạn không có quyền bình luận công việc này.")
            serializer = TenderItemCommentSerializer(
                data={"item": str(item.id), "text": request.data.get("text", "")},
                context=self.get_serializer_context(),
            )
            serializer.is_valid(raise_exception=True)
            comment = serializer.save(workspace=self.cx.workspace)
            from ..models import Notification
            from ..services import notifications

            notifications.notify(
                self.cx.workspace,
                {item.assignee_id, item.created_by_id, item.tender.owner_id} - {None},
                Notification.Type.TASK_NEW,
                f"[{item.tender.code}] Bình luận mới: {item.name}",
                message=comment.text[:300],
                entity_type="tender_item",
                entity_id=item.id,
                link=f"/tenders/{item.tender_id}?tab=tasks&item={item.id}",
                exclude=request.user,
            )
        rows = TenderItemComment.objects.filter(item=item).select_related("created_by")
        return Response(TenderItemCommentSerializer(rows, many=True, context=self.get_serializer_context()).data)


class TenderClarificationViewSet(_TenderChildViewSet):
    model = TenderClarification
    serializer_class = TenderClarificationSerializer
    select_related = ("created_by", "tender")

    def list(self, request, *args, **kwargs):
        if not request.query_params.get("tender"):
            raise ValidationError({"tender": "Thiếu tham số gói thầu."})
        return super().list(request, *args, **kwargs)


class CapabilityDocumentViewSet(CxViewSet):
    model = CapabilityDocument
    serializer_class = CapabilityDocumentSerializer
    permission_module = "capability"
    search_fields = ("title", "number", "issuer", "notes")
    filter_fields = {"category": "category__in", "is_active": "is_active"}
    ordering_fields = ("title", "expiry_date", "issue_date", "updated_at")
    export_title = "Thư viện hồ sơ năng lực"
    export_columns = [
        ("Nhóm", "category"),
        ("Tên hồ sơ", "title"),
        ("Số hiệu", "number"),
        ("Cơ quan cấp / CĐT", "issuer"),
        ("Ngày cấp", "issue_date"),
        ("Hết hạn", "expiry_date"),
        ("Số tệp", "attachment_count"),
        ("Dùng trong số gói thầu", "tender_count"),
    ]

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        expiring = self.request.query_params.get("expiring")
        if expiring:
            try:
                days = int(expiring)
            except ValueError:
                raise ValidationError({"expiring": "Số ngày không hợp lệ."})
            queryset = queryset.filter(expiry_date__lte=timezone.localdate() + timedelta(days=days))
        return queryset
