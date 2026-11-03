# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""JSON login for the ERP front-end, reusing Plane's credential provider and session."""

from django.contrib.auth import logout
from rest_framework import status
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from plane.authentication.adapter.error import AuthenticationException
from plane.authentication.provider.credentials.email import EmailProvider
from plane.authentication.rate_limit import AuthenticationThrottle
from plane.authentication.session import BaseSessionAuthentication, is_allowed_origin
from plane.authentication.utils.login import user_login
from plane.authentication.utils.user_auth_workflow import post_user_auth_workflow
from plane.db.models import User, WorkspaceMember

from ..models import Employee, Role
from ..permissions import WORKSPACE_ADMIN_ROLE, build_access_context
from ..serializers import user_brief
from ..services import audit
from ..services.setup import ensure_workspace_setup
from .base import CxAPIView

ERROR_MESSAGES = {
    "INVALID_PASSWORD": "Email hoặc mật khẩu không đúng.",
    "USER_DOES_NOT_EXIST": "Email hoặc mật khẩu không đúng.",
    "USER_ACCOUNT_DEACTIVATED": "Tài khoản đã bị khóa. Liên hệ quản trị viên.",
    "EMAIL_PASSWORD_AUTHENTICATION_DISABLED": "Đăng nhập bằng mật khẩu đang bị tắt trên hệ thống.",
    "RATE_LIMIT_EXCEEDED": "Bạn đã thử quá nhiều lần. Vui lòng đợi một phút.",
}


class LoginView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [AuthenticationThrottle]

    def post(self, request):
        if not is_allowed_origin(request):
            raise PermissionDenied("Origin không được phép.")
        email = (request.data.get("email") or "").strip().lower()
        password = request.data.get("password") or ""
        if not email or not password:
            return Response({"error": "Vui lòng nhập email và mật khẩu."}, status=status.HTTP_400_BAD_REQUEST)
        user = User.objects.filter(email=email).first()
        if user is None:
            return Response({"error": ERROR_MESSAGES["USER_DOES_NOT_EXIST"]}, status=status.HTTP_400_BAD_REQUEST)
        # Plane stores the user agent on login; non-browser clients may omit it.
        request._request.META.setdefault("HTTP_USER_AGENT", "")
        try:
            provider = EmailProvider(
                request=request._request, key=email, code=password, is_signup=False, callback=post_user_auth_workflow
            )
            user = provider.authenticate()
        except AuthenticationException as exc:
            message = ERROR_MESSAGES.get(exc.error_message, "Đăng nhập không thành công.")
            return Response({"error": message, "code": exc.error_message}, status=status.HTTP_400_BAD_REQUEST)
        user_login(request=request._request, user=user, is_app=True)
        request.user = user
        audit.record(request, "login", entity_type="users", entity_id=str(user.id), label=user.email)
        return Response({"user": user_brief(user)})


class LogoutView(APIView):
    authentication_classes = [BaseSessionAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request):
        logout(request._request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    """Current user + the companies (workspaces) they belong to."""

    authentication_classes = [BaseSessionAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        memberships = WorkspaceMember.objects.filter(member=request.user, is_active=True).select_related("workspace")
        workspaces = []
        for m in memberships:
            workspaces.append(
                {
                    "id": str(m.workspace.id),
                    "slug": m.workspace.slug,
                    "name": m.workspace.name,
                    "is_admin": m.role == WORKSPACE_ADMIN_ROLE,
                    "is_configured": Role.objects.filter(workspace=m.workspace).exists(),
                }
            )
        return Response({"user": user_brief(request.user), "workspaces": workspaces})


class ContextView(CxAPIView):
    """Effective permissions of the user in a company - the UI uses this only to hide actions."""

    def get(self, request, slug):
        data = self.cx.to_dict()
        data["user"] = user_brief(request.user)
        data["is_configured"] = Role.objects.filter(workspace=self.cx.workspace).exists()
        if self.cx.employee:
            data["employee"] = {"id": str(self.cx.employee.id), "full_name": self.cx.employee.full_name}
        return Response(data)


class SetupView(CxAPIView):
    """Enable the construction module on a workspace (admin only, idempotent).

    The admin running the setup gets an employee record with the Director role if
    they do not have one yet, so somebody can operate the system right away.
    """

    def post(self, request, slug):
        if not self.cx.is_admin:
            raise PermissionDenied("Chỉ quản trị viên công ty mới được khởi tạo hệ thống.")
        roles = ensure_workspace_setup(self.cx.workspace, request.user)
        if not Employee.objects.filter(workspace=self.cx.workspace, user=request.user).exists():
            user = request.user
            Employee(
                workspace=self.cx.workspace,
                user=user,
                code="NV001"
                if not Employee.all_objects.filter(workspace=self.cx.workspace, code="NV001").exists()
                else f"NV-{str(user.id)[:6].upper()}",
                full_name=(f"{user.first_name} {user.last_name}".strip() or user.display_name or user.email),
                email=user.email,
                role=roles["director"],
                position="Giám đốc",
            ).save(created_by_id=user.id)
        audit.record(request, "setup", entity_type="workspaces", entity_id=str(self.cx.workspace.id), label=slug)
        ctx = build_access_context(request.user, slug)
        return Response(ctx.to_dict(), status=status.HTTP_200_OK)


class WorkspaceUsersView(CxAPIView):
    """Active accounts of the company, for pickers (manager, assignee...)."""

    def get(self, request, slug):
        members = WorkspaceMember.objects.filter(workspace=self.cx.workspace, is_active=True).select_related("member")
        employees = {
            e.user_id: e
            for e in Employee.objects.filter(workspace=self.cx.workspace, user__isnull=False).select_related(
                "role", "department"
            )
        }
        project_id = request.query_params.get("project")
        allowed = None
        if project_id:
            self.cx.require_project(project_id)
            from plane.db.models import ProjectMember

            allowed = set(
                ProjectMember.objects.filter(project_id=project_id, is_active=True).values_list("member_id", flat=True)
            )
        result = []
        for m in members:
            if m.member.is_bot or (allowed is not None and m.member_id not in allowed):
                continue
            e = employees.get(m.member_id)
            result.append(
                {
                    **user_brief(m.member),
                    "employee_id": str(e.id) if e else None,
                    "full_name": e.full_name if e else None,
                    "role": e.role.name if e and e.role else None,
                    "department": e.department.name if e and e.department else None,
                }
            )
        result.sort(key=lambda r: (r["full_name"] or r["display_name"]).lower())
        return Response(result)
