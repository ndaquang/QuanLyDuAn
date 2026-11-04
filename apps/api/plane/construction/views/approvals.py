# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db import transaction
from django.db.models import Q
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from ..models import ApprovalRequest, ApprovalWorkflow, RequestType
from ..serializers import ApprovalRequestSerializer, ApprovalWorkflowSerializer
from ..services import approvals, audit
from ..services.sequences import next_code
from .base import CxViewSet, LockedError


class ApprovalWorkflowViewSet(CxViewSet):
    model = ApprovalWorkflow
    serializer_class = ApprovalWorkflowSerializer
    permission_module = "approval_config"
    # Workflows are created by the initial setup (one per request type) and never deleted.
    http_method_names = ["get", "patch", "head", "options"]
    permission_map = {"list": None}  # requesters need to know which types exist

    def list(self, request, *args, **kwargs):
        return Response(self.get_serializer(self.get_queryset(), many=True).data)


def waiting_for_user(workspace, user):
    pending = ApprovalRequest.objects.filter(
        workspace=workspace, status=ApprovalRequest.Status.PENDING, current_step__isnull=False
    ).select_related("current_step", "current_step__approver_role", "project")
    return [r.id for r in pending if user.id in approvals.approvers_for(r, r.current_step)]


class ApprovalRequestViewSet(CxViewSet):
    model = ApprovalRequest
    serializer_class = ApprovalRequestSerializer
    permission_module = "approval"
    # Acting on a step is authorised by the workflow (who the current approver is), not by a module permission.
    permission_map = {
        "partial_update": "approval.create",
        "destroy": "approval.create",
        "submit": "approval.create",
        "approve": None,
        "reject": None,
        "cancel": None,
    }
    select_related = ("requester", "project", "current_step", "workflow")
    search_fields = ("code", "title", "description")
    filter_fields = {"status": "status__in", "request_type": "request_type__in", "project": "project_id"}
    ordering_fields = ("created_at", "amount", "submitted_at")
    export_title = "Yêu cầu phê duyệt"
    export_columns = [
        ("Số phiếu", "code"),
        ("Loại", "request_type_label"),
        ("Tiêu đề", "title"),
        ("Dự án", "project_name"),
        ("Số tiền (VNĐ)", "amount"),
        ("Người đề nghị", "requester_detail"),
        ("Trạng thái", "status_label"),
        ("Bước hiện tại", "current_step_name"),
        ("Ngày gửi", "submitted_at"),
        ("Ngày quyết định", "decided_at"),
    ]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if not self.cx.has("approval_config.view"):
            qs = qs.filter(
                Q(requester=user) | Q(history__actor=user) | Q(id__in=waiting_for_user(self.cx.workspace, user))
            ).distinct()
        return qs

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        scope = self.request.query_params.get("scope")
        if scope == "mine":
            queryset = queryset.filter(requester=self.request.user)
        elif scope == "to_approve":
            queryset = queryset.filter(id__in=waiting_for_user(self.cx.workspace, self.request.user))
        return queryset.order_by(*(queryset.query.order_by or ("-created_at",)))

    def extra_context(self):
        return {"with_history": self.action not in ("list",)}

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        request_type = serializer.validated_data["request_type"]
        if request_type == RequestType.BID_PRICE:
            raise ValidationError({"request_type": "Tờ trình giá dự thầu được lập từ màn hình gói thầu."})
        workflow = ApprovalWorkflow.objects.filter(
            workspace=self.cx.workspace, request_type=request_type, is_active=True
        ).first()
        if workflow is None:
            raise ValidationError({"request_type": "Chưa cấu hình luồng phê duyệt cho loại yêu cầu này."})
        # Create (and optionally submit) atomically: a refused submission leaves no orphan draft.
        with transaction.atomic():
            instance = serializer.save(
                workspace=self.cx.workspace,
                workflow=workflow,
                requester=request.user,
                code=next_code(self.cx.workspace, "PD"),
            )
            audit.record(request, "create", instance, changes=audit.diff({}, audit.snapshot(instance)))
            if request.data.get("submit") in (True, "true", "1"):
                instance = approvals.submit(instance, request.user)
                audit.record(request, "submit", instance)
        return Response(
            self.get_serializer(ApprovalRequest.objects.get(pk=instance.pk)).data, status=status.HTTP_201_CREATED
        )

    def check_locked(self, instance):
        if instance.requester_id != self.request.user.id:
            raise PermissionDenied("Chỉ người lập yêu cầu được sửa / xóa.")
        if instance.status not in (ApprovalRequest.Status.DRAFT, ApprovalRequest.Status.REJECTED):
            raise LockedError("Yêu cầu đang chờ duyệt hoặc đã kết thúc, không thể sửa / xóa.")

    def perform_update(self, serializer):
        if serializer.instance.request_type == RequestType.BID_PRICE:
            raise ValidationError({"request_type": "Giá dự thầu được sửa ở gói thầu, sau đó trình duyệt lại."})
        if (
            "request_type" in serializer.validated_data
            and serializer.validated_data["request_type"] != serializer.instance.request_type
        ):
            raise ValidationError({"request_type": "Không thể đổi loại yêu cầu. Hãy tạo yêu cầu mới."})
        super().perform_update(serializer)

    def before_destroy(self, instance):
        if instance.status != ApprovalRequest.Status.DRAFT:
            raise LockedError("Chỉ xóa được yêu cầu ở trạng thái nháp. Hãy dùng 'Hủy yêu cầu'.")

    def _result(self, instance):
        return Response(self.get_serializer(ApprovalRequest.objects.get(pk=instance.pk)).data)

    @action(detail=True, methods=["post"])
    def submit(self, request, slug, pk=None):
        if self.get_object().request_type == RequestType.BID_PRICE:
            raise ValidationError({"request_type": "Trình duyệt lại giá dự thầu từ màn hình gói thầu."})
        instance = approvals.submit(self.get_object(), request.user)
        audit.record(request, "submit", instance)
        return self._result(instance)

    @action(detail=True, methods=["post"])
    def approve(self, request, slug, pk=None):
        instance = approvals.approve(self.get_object(), request.user, request.data.get("comment", ""))
        audit.record(request, "approve", instance, changes={"status": {"new": instance.status}})
        return self._result(instance)

    @action(detail=True, methods=["post"])
    def reject(self, request, slug, pk=None):
        instance = approvals.reject(self.get_object(), request.user, request.data.get("comment", ""))
        audit.record(request, "reject", instance, changes={"comment": request.data.get("comment", "")})
        return self._result(instance)

    @action(detail=True, methods=["post"])
    def cancel(self, request, slug, pk=None):
        instance = approvals.cancel(self.get_object(), request.user, request.data.get("comment", ""))
        audit.record(request, "cancel", instance)
        return self._result(instance)
