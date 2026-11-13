# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Initial configuration of a company for the construction ERP (production safe).

    python manage.py construction_setup --workspace cong-ty-abc \
        --name "Công ty Xây dựng ABC" --admin-email giamdoc@abc.vn [--admin-password ...]

* creates the admin account if it does not exist (password asked interactively if omitted);
* creates the workspace (company) if it does not exist, with the admin as owner;
* loads master data: permissions, default roles, departments, approval workflows;
* links the admin to an employee record with the Director role.
No sample/fake business data is created.
"""

import getpass
import uuid

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from plane.db.models import Profile, User, Workspace, WorkspaceMember

from ...models import Employee
from ...services.setup import ensure_workspace_setup


class Command(BaseCommand):
    help = "Khởi tạo công ty (workspace) cho phân hệ quản lý xây dựng."

    def add_arguments(self, parser):
        parser.add_argument("--workspace", required=True, help="slug của công ty, ví dụ cong-ty-abc")
        parser.add_argument("--name", help="Tên công ty (khi tạo mới)")
        parser.add_argument("--admin-email", help="Email quản trị viên / giám đốc")
        parser.add_argument("--admin-password", help="Mật khẩu (bỏ trống để nhập an toàn)")
        parser.add_argument("--admin-name", default="", help="Họ tên quản trị viên")

    @transaction.atomic
    def handle(self, *args, **opts):
        slug = opts["workspace"].strip().lower()
        workspace = Workspace.objects.filter(slug=slug).first()
        admin = None
        if opts.get("admin_email"):
            email = opts["admin_email"].strip().lower()
            admin = User.objects.filter(email=email).first()
            if admin is None:
                password = opts.get("admin_password") or getpass.getpass("Mật khẩu cho tài khoản quản trị: ")
                try:
                    validate_password(password)
                except ValidationError as exc:
                    raise CommandError("; ".join(exc.messages))
                name = (opts.get("admin_name") or "").split()
                admin = User(
                    email=email,
                    username=uuid.uuid4().hex,
                    first_name=" ".join(name[:-1]) if len(name) > 1 else " ".join(name),
                    last_name=name[-1] if len(name) > 1 else "",
                    display_name=email.split("@")[0],
                    is_password_autoset=False,
                )
                admin.set_password(password)
                admin.save()
                Profile.objects.get_or_create(user=admin, defaults={"is_onboarded": True})
                self.stdout.write(self.style.SUCCESS(f"Đã tạo tài khoản {email}"))
        if workspace is None:
            if admin is None or not opts.get("name"):
                raise CommandError("Công ty chưa tồn tại: cần --name và --admin-email để tạo mới.")
            workspace = Workspace.objects.create(
                name=opts["name"][:80], slug=slug, owner=admin, timezone="Asia/Ho_Chi_Minh"
            )
            self.stdout.write(self.style.SUCCESS(f"Đã tạo công ty {workspace.name} ({slug})"))
        if admin is not None:
            member, _ = WorkspaceMember.objects.get_or_create(workspace=workspace, member=admin, defaults={"role": 20})
            if member.role != 20 or not member.is_active:
                member.role, member.is_active = 20, True
                member.save()
        roles = ensure_workspace_setup(workspace, admin)
        if admin is not None and not Employee.objects.filter(workspace=workspace, user=admin).exists():
            Employee(
                workspace=workspace,
                user=admin,
                code="NV001",
                full_name=opts.get("admin_name") or admin.display_name or admin.email,
                email=admin.email,
                position="Giám đốc",
                role=roles["director"],
            ).save(created_by_id=admin.id)
        self.stdout.write(self.style.SUCCESS("Đã nạp danh mục quyền, vai trò, phòng ban và luồng phê duyệt mặc định."))
