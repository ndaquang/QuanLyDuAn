# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import uuid

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.db import transaction
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from plane.db.models import Profile, User, WorkspaceMember

from ..models import Attachment, Department, Employee, Permission, Role, RolePermission
from ..serializers import DepartmentSerializer, EmployeeSerializer, PermissionSerializer, RoleSerializer
from ..services import audit, files
from .base import CxAPIView, CxViewSet

MEMBER_ROLE = 15


class PermissionCatalogueView(CxAPIView):
    permission_module = "role"

    def get(self, request, slug):
        return Response(PermissionSerializer(Permission.objects.all(), many=True).data)


class RoleViewSet(CxViewSet):
    model = Role
    serializer_class = RoleSerializer
    permission_module = "role"
    # Creating custom roles is an "update" of the permission matrix; deleting is only for non-system roles.
    permission_map = {"create": "role.update", "destroy": "role.update", "list": None}
    search_fields = ("name", "code")

    def list(self, request, *args, **kwargs):
        # Everyone who can see employees needs role names for pickers.
        qs = self.filter_queryset(self.get_queryset())
        return Response(self.get_serializer(qs, many=True).data)

    def _save_permissions(self, role, codes):
        if codes is None:
            return
        before = sorted(role.permissions.values_list("code", flat=True))
        RolePermission.objects.filter(role=role).delete()
        perms = Permission.objects.filter(code__in=codes)
        RolePermission.objects.bulk_create([RolePermission(role=role, permission=p) for p in perms])
        if before != sorted(codes):
            audit.record(
                self.request, "update_permissions", role, changes={"permissions": {"old": before, "new": sorted(codes)}}
            )

    def perform_create(self, serializer):
        codes = serializer.validated_data.pop("permission_codes", [])
        super().perform_create(serializer)
        self._save_permissions(serializer.instance, codes)

    def perform_update(self, serializer):
        codes = serializer.validated_data.pop("permission_codes", None)
        if serializer.instance.is_system and "code" in serializer.validated_data:
            serializer.validated_data.pop("code")
        with transaction.atomic():
            super().perform_update(serializer)
            self._save_permissions(serializer.instance, codes)

    def before_destroy(self, instance):
        if instance.is_system:
            raise ValidationError({"detail": "Không thể xóa vai trò mặc định của hệ thống."})
        if instance.employees.filter(deleted_at__isnull=True).exists():
            raise ValidationError(
                {"detail": "Vai trò đang được gán cho nhân sự, hãy chuyển nhân sự sang vai trò khác trước."}
            )


class DepartmentViewSet(CxViewSet):
    model = Department
    serializer_class = DepartmentSerializer
    permission_module = "department"
    permission_map = {"list": None}  # names are needed by every picker; data is not sensitive
    select_related = ("head",)
    search_fields = ("name", "code")
    export_columns = [
        ("Mã", "code"),
        ("Tên phòng ban", "name"),
        ("Trưởng phòng", "head_detail"),
        ("Số nhân sự", "employee_count"),
    ]
    export_title = "Danh sách phòng ban"

    def before_destroy(self, instance):
        if instance.employees.filter(deleted_at__isnull=True).exists():
            raise ValidationError({"detail": "Phòng ban còn nhân sự, không thể xóa."})


class EmployeeViewSet(CxViewSet):
    model = Employee
    serializer_class = EmployeeSerializer
    permission_module = "employee"
    permission_map = {
        "create_account": "account.create",
        "reset_password": "account.update",
        "photo": "employee.update",
    }
    select_related = ("department", "role", "user")
    search_fields = ("full_name", "code", "email", "phone", "position")
    filter_fields = {"department": "department_id", "role": "role_id", "status": "status"}
    ordering_fields = ("full_name", "code", "join_date", "created_at")
    export_columns = [
        ("Mã NV", "code"),
        ("Họ tên", "full_name"),
        ("Chức vụ", "position"),
        ("Phòng ban", "department_name"),
        ("Vai trò hệ thống", "role_name"),
        ("Điện thoại", "phone"),
        ("Email", "email"),
        ("Trạng thái", "status"),
        ("Ngày vào làm", "join_date"),
        ("Dự án đang tham gia", lambda r: ", ".join(p["code"] for p in r["projects"])),
    ]
    export_title = "Danh sách nhân sự"

    def get_parsers(self):
        return [JSONParser(), MultiPartParser(), FormParser()]

    def perform_update(self, serializer):
        # Changing someone's role is a permission change and needs role.update.
        if "role" in serializer.validated_data and serializer.validated_data["role"] != serializer.instance.role:
            self.cx.require("role.update")
        super().perform_update(serializer)

    def perform_create(self, serializer):
        if serializer.validated_data.get("role") is not None:
            self.cx.require("role.update")
        super().perform_create(serializer)

    def before_destroy(self, instance):
        if instance.user_id == self.request.user.id:
            raise ValidationError({"detail": "Không thể xóa hồ sơ của chính bạn."})

    @action(detail=True, methods=["post"], url_path="create-account")
    def create_account(self, request, slug, pk=None):
        """Create a login for an employee (no email server needed) and add it to the company."""
        employee = self.get_object()
        if employee.user_id:
            raise ValidationError({"detail": "Nhân sự này đã có tài khoản."})
        email = (request.data.get("email") or employee.email or "").strip().lower()
        password = request.data.get("password") or ""
        try:
            validate_email(email)
        except DjangoValidationError:
            raise ValidationError({"email": "Email không hợp lệ."})
        if User.objects.filter(email=email).exists():
            user = User.objects.get(email=email)
            if Employee.objects.filter(workspace=self.cx.workspace, user=user).exists():
                raise ValidationError({"email": "Email này đã gắn với nhân sự khác."})
        else:
            try:
                validate_password(password)
            except DjangoValidationError as exc:
                raise ValidationError({"password": list(exc.messages)})
            if len(password) < 8:
                raise ValidationError({"password": "Mật khẩu phải có ít nhất 8 ký tự."})
            parts = employee.full_name.split()
            user = User(
                email=email,
                username=uuid.uuid4().hex,
                first_name=" ".join(parts[:-1]) if len(parts) > 1 else employee.full_name,
                last_name=parts[-1] if len(parts) > 1 else "",
                display_name=email.split("@")[0],
                is_password_autoset=False,
            )
            user.set_password(password)
            user.save()
            Profile.objects.get_or_create(user=user, defaults={"is_onboarded": True})
        with transaction.atomic():
            wm = WorkspaceMember.objects.filter(workspace=self.cx.workspace, member=user).first()
            if wm is None:
                WorkspaceMember.objects.create(workspace=self.cx.workspace, member=user, role=MEMBER_ROLE)
            elif not wm.is_active:
                wm.is_active = True
                wm.save()
            employee.user = user
            if not employee.email:
                employee.email = email
            employee.save()
        audit.record(request, "create_account", employee, changes={"user": {"old": None, "new": email}})
        return Response(self.get_serializer(employee).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="reset-password")
    def reset_password(self, request, slug, pk=None):
        employee = self.get_object()
        if not employee.user_id:
            raise ValidationError({"detail": "Nhân sự chưa có tài khoản."})
        if (
            WorkspaceMember.objects.filter(member_id=employee.user_id, role=20, is_active=True).exists()
            and not self.cx.is_admin
        ):
            raise ValidationError({"detail": "Chỉ quản trị viên mới đổi được mật khẩu của quản trị viên."})
        password = request.data.get("password") or ""
        try:
            validate_password(password, employee.user)
        except DjangoValidationError as exc:
            raise ValidationError({"password": list(exc.messages)})
        if len(password) < 8:
            raise ValidationError({"password": "Mật khẩu phải có ít nhất 8 ký tự."})
        employee.user.set_password(password)
        employee.user.is_password_autoset = False
        employee.user.save()
        audit.record(request, "reset_password", employee)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"], url_path="photo")
    def photo(self, request, slug, pk=None):
        """Upload / take a portrait photo (camera capture on phones is supported by the UI)."""
        employee = self.get_object()
        uploaded = request.FILES.get("file")
        _, ext = files.validate_upload(uploaded)
        if ext not in {"jpg", "jpeg", "png", "webp", "heic", "heif", "gif"}:
            raise ValidationError({"file": "Ảnh đại diện phải là tệp ảnh."})
        key, backend, content_type = files.store(self.cx.workspace, uploaded)
        attachment = Attachment(
            workspace=self.cx.workspace,
            entity_type=Attachment.EntityType.EMPLOYEE,
            entity_id=employee.id,
            file_name=uploaded.name[:255],
            content_type=content_type,
            size=uploaded.size,
            storage_key=key,
            storage_backend=backend,
        )
        attachment.save()
        employee.photo = attachment
        employee.save()
        audit.record(request, "upload_photo", employee)
        return Response(self.get_serializer(employee).data)
