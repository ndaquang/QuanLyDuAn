# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from plane.db.models import Issue

from ..models import (
    ApprovalRequest,
    Attachment,
    DailyReport,
    Document,
    Employee,
    Material,
    Notification,
    ScheduleItem,
    Supplier,
    Tender,
    TenderItem,
)
from ..serializers import (
    AttachmentSerializer,
    DocumentSerializer,
    MaterialSerializer,
    SupplierSerializer,
    TenderItemSerializer,
    TenderSerializer,
)
from ..services import audit, files, notifications
from .base import CxViewSet, LockedError


class SupplierViewSet(CxViewSet):
    model = Supplier
    serializer_class = SupplierSerializer
    permission_module = "supplier"
    search_fields = ("code", "name", "tax_code", "contact_person", "phone", "category")
    filter_fields = {"status": "status", "category": "category__icontains"}
    ordering_fields = ("code", "name", "created_at")
    export_title = "Danh sách nhà cung cấp"
    export_columns = [
        ("Mã NCC", "code"),
        ("Tên nhà cung cấp", "name"),
        ("Mã số thuế", "tax_code"),
        ("Nhóm cung cấp", "category"),
        ("Người liên hệ", "contact_person"),
        ("Điện thoại", "phone"),
        ("Email", "email"),
        ("Địa chỉ", "address"),
        ("Trạng thái", "status"),
    ]

    def before_destroy(self, instance):
        if instance.materials.filter(deleted_at__isnull=True).exists():
            raise ValidationError(
                {"detail": "Nhà cung cấp đang gắn với vật tư, không thể xóa. Hãy chuyển sang 'Ngừng giao dịch'."}
            )


class MaterialViewSet(CxViewSet):
    model = Material
    serializer_class = MaterialSerializer
    permission_module = "material"
    select_related = ("supplier",)
    search_fields = ("code", "name", "category", "specification")
    filter_fields = {"supplier": "supplier_id", "category": "category__icontains", "is_active": "is_active"}
    ordering_fields = ("code", "name", "reference_price", "created_at")
    export_title = "Danh mục vật tư"
    export_columns = [
        ("Mã vật tư", "code"),
        ("Tên vật tư", "name"),
        ("Đơn vị", "unit"),
        ("Nhóm", "category"),
        ("Quy cách", "specification"),
        ("Nhà cung cấp", "supplier_name"),
        ("Đơn giá tham khảo", "reference_price"),
    ]


class TenderViewSet(CxViewSet):
    model = Tender
    serializer_class = TenderSerializer
    permission_module = "tender"
    select_related = ("owner", "project")
    search_fields = ("code", "name", "investor", "location")
    filter_fields = {
        "status": "status__in",
        "owner": "owner_id",
        "deadline_from": "submission_deadline__date__gte",
        "deadline_to": "submission_deadline__date__lte",
    }
    ordering_fields = ("submission_deadline", "code", "bid_value", "created_at")
    export_title = "Theo dõi đấu thầu"
    export_columns = [
        ("Mã gói thầu", "code"),
        ("Tên gói thầu", "name"),
        ("Chủ đầu tư", "investor"),
        ("Người phụ trách", "owner_detail"),
        ("Hạn nộp thầu", "submission_deadline"),
        ("Giá dự thầu", "bid_value"),
        ("Trạng thái", "status"),
        ("Hồ sơ hoàn thành (%)", "checklist.percent"),
    ]


class TenderItemViewSet(CxViewSet):
    model = TenderItem
    serializer_class = TenderItemSerializer
    permission_module = "tender"
    select_related = ("assignee",)
    filter_fields = {"tender": "tender_id", "status": "status"}

    def get_queryset(self):
        return super().get_queryset().filter(tender__deleted_at__isnull=True)


class DocumentViewSet(CxViewSet):
    model = Document
    serializer_class = DocumentSerializer
    permission_module = "document"
    permission_map = {"submit": "document.update", "approve": "document.approve", "reject": "document.approve"}
    project_field = "project_id"
    select_related = ("project", "tender", "created_by", "reviewed_by")
    search_fields = ("title", "code", "description")
    filter_fields = {"project": "project_id", "tender": "tender_id", "category": "category__in", "status": "status__in"}
    ordering_fields = ("title", "created_at", "code")
    export_title = "Danh mục hồ sơ"
    export_columns = [
        ("Mã hồ sơ", "code"),
        ("Tên hồ sơ", "title"),
        ("Loại", "category"),
        ("Phiên bản", "version"),
        ("Dự án", "project_name"),
        ("Gói thầu", "tender_name"),
        ("Trạng thái", "status"),
        ("Người lập", "created_by_detail"),
        ("Ngày lập", "created_at"),
    ]

    def check_locked(self, instance):
        if instance.status in (Document.Status.APPROVED, Document.Status.SUBMITTED):
            raise LockedError("Hồ sơ đã gửi duyệt hoặc đã duyệt, không thể sửa / xóa. Hãy tạo phiên bản mới.")

    @action(detail=True, methods=["post"])
    def submit(self, request, slug, pk=None):
        doc = self.get_object()
        if doc.status not in (Document.Status.DRAFT, Document.Status.REJECTED):
            raise ValidationError({"status": "Hồ sơ đã được gửi duyệt."})
        if not Attachment.objects.filter(entity_type="document", entity_id=doc.id).exists():
            raise ValidationError({"detail": "Hãy đính kèm tệp hồ sơ trước khi gửi duyệt."})
        doc.status = Document.Status.SUBMITTED
        doc.save()
        audit.record(request, "submit", doc)
        from .projects import _users_with_permission

        approvers = (
            _users_with_permission(self.cx.workspace, doc.project_id, "document.approve") if doc.project_id else set()
        )
        notifications.notify(
            self.cx.workspace,
            approvers,
            Notification.Type.ACCEPTANCE_REQUIRED,
            f"Hồ sơ cần nghiệm thu / duyệt: {doc.title}",
            project_id=doc.project_id,
            entity_type="document",
            entity_id=doc.id,
            link=f"/documents?id={doc.id}",
            exclude=request.user,
        )
        return Response(self.get_serializer(doc).data)

    def _review(self, request, new_status):
        doc = self.get_object()
        if doc.status != Document.Status.SUBMITTED:
            raise ValidationError({"status": "Hồ sơ không ở trạng thái chờ duyệt."})
        if doc.created_by_id == request.user.id:
            raise PermissionDenied("Không thể tự duyệt hồ sơ do mình lập.")
        comment = (request.data.get("comment") or "").strip()
        if new_status == Document.Status.REJECTED and not comment:
            raise ValidationError({"comment": "Vui lòng ghi lý do trả lại."})
        doc.status = new_status
        doc.reviewed_by = request.user
        doc.reviewed_at = timezone.now()
        doc.review_comment = comment
        doc.save()
        audit.record(request, new_status, doc, changes={"status": {"new": new_status}, "comment": comment})
        if doc.created_by_id:
            notifications.notify(
                self.cx.workspace,
                [doc.created_by_id],
                Notification.Type.APPROVAL_RESULT,
                f"Hồ sơ '{doc.title}' {'đã được duyệt' if new_status == Document.Status.APPROVED else 'bị trả lại'}",
                message=comment,
                project_id=doc.project_id,
                entity_type="document",
                entity_id=doc.id,
                link=f"/documents?id={doc.id}",
            )
        return Response(self.get_serializer(doc).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, slug, pk=None):
        return self._review(request, Document.Status.APPROVED)

    @action(detail=True, methods=["post"])
    def reject(self, request, slug, pk=None):
        return self._review(request, Document.Status.REJECTED)


def _resolve_parent(cx, entity_type, entity_id):
    """Return (parent_object, project_id, module) after checking the caller may see the parent."""
    ws = cx.workspace
    lookup = {
        "employee": (Employee.objects.filter(workspace=ws), "employee", None),
        "daily_report": (DailyReport.objects.filter(workspace=ws), "daily_report", "project_id"),
        "document": (Document.objects.filter(workspace=ws), "document", "project_id"),
        "schedule_item": (ScheduleItem.objects.filter(workspace=ws), "schedule", "project_id"),
        "tender": (Tender.objects.filter(workspace=ws), "tender", None),
        "approval_request": (ApprovalRequest.objects.filter(workspace=ws), "approval", "project_id"),
        "task": (
            Issue.issue_objects.filter(workspace=ws, project__construction_profile__isnull=False),
            "task",
            "project_id",
        ),
    }
    if entity_type not in lookup:
        raise ValidationError({"entity_type": "Loại đối tượng không hợp lệ."})
    qs, module, project_attr = lookup[entity_type]
    try:
        parent = qs.filter(pk=entity_id).first()
    except (ValueError, DjangoValidationError):
        parent = None
    if parent is None:
        raise NotFound("Không tìm thấy đối tượng.")
    project_id = getattr(parent, project_attr) if project_attr else None
    cx.require_project(project_id)
    if entity_type == "approval_request" and parent.requester_id != cx.user.id and not cx.has("approval_config.view"):
        from ..services.approvals import candidate_approvers

        involved = parent.history.filter(actor=cx.user).exists() or (
            parent.current_step_id and cx.user.id in candidate_approvers(parent, parent.current_step)
        )
        if not involved:
            raise NotFound("Không tìm thấy đối tượng.")
    return parent, project_id, module


class AttachmentViewSet(CxViewSet):
    """Files attached to employees, daily reports, documents, tasks... (photos from phone cameras included)."""

    model = Attachment
    serializer_class = AttachmentSerializer
    http_method_names = ["get", "post", "delete", "head", "options"]
    # Access is derived from the parent object - checked inline.
    permission_map = {"list": None, "create": None, "retrieve": None, "destroy": None, "download": None}

    def get_parsers(self):
        return [MultiPartParser(), FormParser(), JSONParser()]

    def _parent_access(self, entity_type, entity_id, write):
        parent, project_id, module = _resolve_parent(self.cx, entity_type, entity_id)
        if module == "approval":
            if write and parent.requester_id != self.request.user.id:
                raise PermissionDenied("Chỉ người lập yêu cầu được đính kèm tệp.")
            if write and parent.is_locked:
                raise LockedError()
        elif module == "task":
            self.cx.require("task.view")
            if write and not self.cx.has("task.update"):
                if not parent.assignees.filter(id=self.request.user.id).exists():
                    raise PermissionDenied("Bạn không có quyền đính kèm tệp cho công việc này.")
        else:
            self.cx.require(f"{module}.{'update' if write else 'view'}")
            if write and getattr(parent, "is_locked", False):
                raise LockedError()
            if write and module in ("daily_report", "document") and parent.status == "submitted":
                raise LockedError("Đang chờ duyệt, không thể thay đổi tệp đính kèm.")
        return parent, project_id

    def get_queryset(self):
        return Attachment.objects.filter(workspace=self.cx.workspace).select_related("created_by")

    def list(self, request, *args, **kwargs):
        entity_type = request.query_params.get("entity_type")
        entity_id = request.query_params.get("entity_id")
        if not entity_type or not entity_id:
            raise ValidationError({"entity_type": "Thiếu entity_type / entity_id."})
        self._parent_access(entity_type, entity_id, write=False)
        qs = self.get_queryset().filter(entity_type=entity_type, entity_id=entity_id)
        return Response(self.get_serializer(qs, many=True).data)

    def create(self, request, *args, **kwargs):
        entity_type = request.data.get("entity_type")
        entity_id = request.data.get("entity_id")
        parent, project_id = self._parent_access(entity_type, entity_id, write=True)
        uploads = request.FILES.getlist("file")
        if not uploads:
            raise ValidationError({"file": "Vui lòng chọn tệp cần tải lên."})
        if len(uploads) > 20:
            raise ValidationError({"file": "Tối đa 20 tệp mỗi lần tải."})
        created = []
        for uploaded in uploads:
            key, backend, content_type = files.store(self.cx.workspace, uploaded)
            att = Attachment(
                workspace=self.cx.workspace,
                project_id=project_id,
                entity_type=entity_type,
                entity_id=parent.pk,
                file_name=uploaded.name[:255],
                content_type=content_type,
                size=uploaded.size,
                storage_key=key,
                storage_backend=backend,
            )
            att.save()
            audit.record(request, "upload", att, label=att.file_name, project_id=project_id)
            created.append(att)
        return Response(self.get_serializer(created, many=True).data, status=status.HTTP_201_CREATED)

    def retrieve(self, request, *args, **kwargs):
        att = self.get_object()
        self._parent_access(att.entity_type, att.entity_id, write=False)
        return Response(self.get_serializer(att).data)

    @action(detail=True, methods=["get"])
    def download(self, request, slug, pk=None):
        att = self.get_object()
        self._parent_access(att.entity_type, att.entity_id, write=False)
        return files.serve(request, att, inline=request.query_params.get("download") != "1")

    def destroy(self, request, *args, **kwargs):
        att = self.get_object()
        self._parent_access(att.entity_type, att.entity_id, write=True)
        if att.entity_type == "employee":
            Employee.objects.filter(photo=att).update(photo=None)
        att.deleted_at = timezone.now()
        att.save()
        audit.record(request, "delete", att, label=att.file_name, project_id=att.project_id)
        return Response(status=status.HTTP_204_NO_CONTENT)
