# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Sample data for testing / training - kept completely apart from production data.

    CONSTRUCTION_ALLOW_DEMO=1 python manage.py construction_seed_demo --password "Demo@12345"

Safety rules:
* writes only into a workspace whose slug starts with ``demo-`` (default ``demo-xay-dung``);
* refuses to run unless DEBUG=1 or CONSTRUCTION_ALLOW_DEMO=1;
* demo accounts use the ``@demo.local`` domain so they are easy to spot and remove.
"""

import os
import uuid
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from plane.db.models import Issue, IssueAssignee, Profile, State, User, Workspace, WorkspaceMember

from ...models import (
    ApprovalRequest,
    ApprovalWorkflow,
    DailyReport,
    Department,
    Employee,
    Material,
    ProjectProfile,
    ScheduleItem,
    Supplier,
    Tender,
    TenderItem,
)
from ...services import approvals
from ...services.progress import recompute_parents
from ...services.projects import create_plane_project
from ...services.sequences import next_code
from ...services.setup import ensure_workspace_setup

PEOPLE = [
    # code, name, email, role, dept, position
    ("NV001", "Nguyễn Văn An", "giamdoc", "director", "BGD", "Giám đốc"),
    ("NV002", "Trần Thị Bình", "truongphongda", "project_manager", "PDA", "Trưởng phòng dự án"),
    ("NV003", "Lê Văn Cường", "kysuxd", "civil_engineer", "PDA", "Kỹ sư xây dựng"),
    ("NV004", "Phạm Minh Đức", "kysumep", "mep_engineer", "PKT", "Kỹ sư MEP"),
    ("NV005", "Hoàng Thu Hà", "qs", "qs", "PKT", "Nhân viên QS"),
    ("NV006", "Vũ Quốc Hùng", "hse", "hse", "HSE", "Nhân viên HSE"),
    ("NV007", "Đặng Thị Lan", "thumua", "procurement", "PTM", "Nhân viên thu mua"),
    ("NV008", "Bùi Thanh Mai", "nhansu", "hr_admin", "HCNS", "Chuyên viên nhân sự - hành chính"),
    ("NV009", "Ngô Văn Nam", "ketoan", "accountant", "PKTOAN", "Kế toán trưởng"),
]


class Command(BaseCommand):
    help = "Tạo dữ liệu mẫu trong workspace demo-* (tách biệt dữ liệu thật)."

    def add_arguments(self, parser):
        parser.add_argument("--workspace", default="demo-xay-dung")
        parser.add_argument("--password", required=True, help="Mật khẩu chung cho các tài khoản demo")

    def handle(self, *args, **opts):
        slug = opts["workspace"]
        if not slug.startswith("demo-"):
            raise CommandError("Dữ liệu mẫu chỉ được tạo trong workspace có slug bắt đầu bằng 'demo-'.")
        if not (settings.DEBUG or os.environ.get("CONSTRUCTION_ALLOW_DEMO") == "1"):
            raise CommandError("Từ chối chạy: đặt CONSTRUCTION_ALLOW_DEMO=1 (chỉ trên môi trường thử nghiệm).")
        if len(opts["password"]) < 8:
            raise CommandError("Mật khẩu tối thiểu 8 ký tự.")
        with transaction.atomic():
            self._seed(slug, opts["password"])

    def _user(self, local, name, password):
        email = f"{local}@demo.local"
        user = User.objects.filter(email=email).first()
        if user is None:
            parts = name.split()
            user = User(
                email=email,
                username=uuid.uuid4().hex,
                first_name=" ".join(parts[:-1]),
                last_name=parts[-1],
                display_name=local,
                is_password_autoset=False,
            )
            user.set_password(password)
            user.save()
            Profile.objects.get_or_create(user=user, defaults={"is_onboarded": True})
        return user

    def _seed(self, slug, password):
        users = {p[3]: self._user(p[2], p[1], password) for p in PEOPLE}
        director = users["director"]
        workspace = Workspace.objects.filter(slug=slug).first()
        if workspace is None:
            workspace = Workspace.objects.create(
                name="DEMO - Công ty Xây dựng", slug=slug, owner=director, timezone="Asia/Ho_Chi_Minh"
            )
        if ProjectProfile.objects.filter(workspace=workspace).exists():
            self.stdout.write(self.style.WARNING("Workspace demo đã có dữ liệu - bỏ qua."))
            return
        for role_code, user in users.items():
            WorkspaceMember.objects.get_or_create(
                workspace=workspace, member=user, defaults={"role": 20 if role_code == "director" else 15}
            )
        roles = ensure_workspace_setup(workspace, director)
        depts = {d.code: d for d in Department.objects.filter(workspace=workspace)}
        for code, name, local, role_code, dept, position in PEOPLE:
            Employee(
                workspace=workspace,
                user=users[role_code],
                code=code,
                full_name=name,
                email=f"{local}@demo.local",
                phone=f"09{code[-3:]}12345"[:10],
                role=roles[role_code],
                department=depts[dept],
                position=position,
                join_date=timezone.localdate() - timedelta(days=400),
            ).save(created_by_id=director.id)
        for code, head in (
            ("BGD", "director"),
            ("PDA", "project_manager"),
            ("PKT", "qs"),
            ("HCNS", "hr_admin"),
            ("PKTOAN", "accountant"),
            ("PTM", "procurement"),
            ("HSE", "hse"),
        ):
            depts[code].head = users[head]
            depts[code].save()

        today = timezone.localdate()
        pm = users["project_manager"]
        team = [users[r].id for r in ("civil_engineer", "mep_engineer", "qs", "hse", "procurement")]
        projects = [
            (
                "DA-2601",
                "Nhà xưởng KCN Tân Uyên",
                "Công ty TNHH Sản xuất Minh Phát",
                "Bình Dương",
                "industrial",
                -120,
                180,
                Decimal("38500000000"),
            ),
            (
                "DA-2602",
                "Trường tiểu học Phú Mỹ",
                "Ban QLDA huyện Phú Mỹ",
                "Bà Rịa - Vũng Tàu",
                "civil",
                -200,
                60,
                Decimal("21000000000"),
            ),
            (
                "DA-2603",
                "Cải tạo hệ thống MEP tòa nhà văn phòng",
                "Công ty CP Bất động sản Sao Việt",
                "TP. Hồ Chí Minh",
                "mep",
                -40,
                120,
                Decimal("6800000000"),
            ),
        ]
        created = []
        for code, name, investor, location, ptype, start_off, end_off, value in projects:
            project = create_plane_project(workspace, director, name, code, pm.id, team)
            profile = ProjectProfile(
                workspace=workspace,
                project=project,
                code=code,
                investor=investor,
                location=location,
                project_type=ptype,
                start_date=today + timedelta(days=start_off),
                planned_end_date=today + timedelta(days=end_off),
                manager=pm,
                department=depts["PDA"],
                contract_value=value,
            )
            profile.save(created_by_id=director.id)
            created.append(profile)
            self._schedule(workspace, profile, users)
            self._tasks(workspace, profile, users)
            for back in range(1, 4):
                DailyReport(
                    workspace=workspace,
                    project=project,
                    report_date=today - timedelta(days=back),
                    weather="sunny" if back % 2 else "rain",
                    manpower_count=35 + back * 3,
                    equipment="01 cần trục tháp, 02 máy đào, 01 máy trộn bê tông",
                    work_performed="Thi công cốp pha, cốt thép cột tầng 2; đổ bê tông sàn trục A-C.",
                    issues="Vật tư thép D16 về chậm 1 ngày." if back == 2 else "",
                    hse_notes="Kiểm tra dây an toàn, lan can biên trước ca làm việc.",
                    next_plan="Tiếp tục lắp dựng cốp pha dầm sàn tầng 2.",
                    status="approved" if back > 1 else "draft",
                ).save(created_by_id=users["civil_engineer"].id)

        suppliers = []
        for i, (name, cat) in enumerate(
            [
                ("Công ty TNHH Thép Hòa Phát Miền Nam", "Thép xây dựng"),
                ("Công ty CP Bê tông Lê Phan", "Bê tông thương phẩm"),
                ("Công ty TNHH Cơ điện Đại Dương", "Vật tư MEP"),
            ],
            start=1,
        ):
            s = Supplier(
                workspace=workspace,
                code=f"NCC{i:03d}",
                name=name,
                category=cat,
                tax_code=f"03{i:08d}",
                contact_person="Phòng kinh doanh",
                phone=f"028{i:07d}",
            )
            s.save(created_by_id=director.id)
            suppliers.append(s)
        for i, (name, unit, price, sup) in enumerate(
            [
                ("Thép D16 CB400", "kg", 16500, 0),
                ("Thép D10 CB300", "kg", 16200, 0),
                ("Bê tông B25 (M350)", "m3", 1350000, 1),
                ("Cáp điện Cu/XLPE 4x25", "m", 285000, 2),
                ("Ống PPR D32", "m", 42000, 2),
            ],
            start=1,
        ):
            Material(
                workspace=workspace,
                code=f"VT{i:03d}",
                name=name,
                unit=unit,
                reference_price=Decimal(price),
                supplier=suppliers[sup],
            ).save(created_by_id=director.id)

        tender = Tender(
            workspace=workspace,
            code="GT-2611",
            name="Gói thầu xây lắp nhà kho lạnh Long An",
            investor="Công ty CP Thực phẩm Đông Nam",
            owner=users["procurement"],
            decision="go",
            status="preparing",
            decision_by=director,
            decision_at=timezone.now(),
            release_date=today - timedelta(days=5),
            clarification_deadline=today + timedelta(days=2),
            site_visit_date=timezone.now() + timedelta(days=1),
            submission_deadline=timezone.now() + timedelta(days=9),
        )
        tender.save(created_by_id=director.id)
        for name, cat, who, days, st, prio in [
            ("Hồ sơ năng lực, pháp lý", "legal", "hr_admin", 3, "done", "medium"),
            ("Biện pháp tổ chức thi công", "technical", "civil_engineer", 6, "in_progress", "high"),
            ("Tiến độ thi công và biểu đồ nhân lực", "technical", "civil_engineer", 6, "todo", "high"),
            ("Biện pháp an toàn - môi trường", "technical", "hse", 5, "todo", "medium"),
            ("Hệ thống cơ điện (MEP) và vật liệu chính", "technical", "mep_engineer", 6, "in_progress", "medium"),
            ("Bóc tách khối lượng, kiểm tra BOQ", "financial", "qs", 7, "in_progress", "urgent"),
            ("Kiểm tra chéo, ký đóng dấu, nộp HSDT", "other", "procurement", 8, "todo", "urgent"),
        ]:
            TenderItem(
                workspace=workspace,
                tender=tender,
                name=name,
                category=cat,
                priority=prio,
                assignee=users[who],
                due_date=today + timedelta(days=days),
                status=st,
            ).save(created_by_id=director.id)

        req = ApprovalRequest(
            workspace=workspace,
            code=next_code(workspace, "PD"),
            request_type="purchase",
            workflow=ApprovalWorkflow.objects.get(workspace=workspace, request_type="purchase"),
            project=created[0].project,
            title="Mua thép D16 cho cột tầng 3",
            requester=users["procurement"],
            details={"lines": [{"name": "Thép D16 CB400", "unit": "kg", "quantity": 4500, "unit_price": 16500}]},
            amount=Decimal(4500 * 16500),
        )
        req.save(created_by_id=users["procurement"].id)
        approvals.submit(req, users["procurement"])
        self.stdout.write(
            self.style.SUCCESS(f"Đã tạo dữ liệu mẫu trong workspace '{slug}'. Tài khoản: <vai trò>@demo.local")
        )

    def _schedule(self, workspace, profile, users):
        start = profile.start_date
        span = (profile.planned_end_date - start).days
        plan = [
            (
                "HM01",
                "Phần móng",
                [
                    ("CV01", "Đào đất hố móng", 0.00, 0.10, "civil_engineer"),
                    ("CV02", "Bê tông móng, giằng móng", 0.08, 0.22, "civil_engineer"),
                ],
            ),
            (
                "HM02",
                "Phần thân",
                [
                    ("CV03", "Kết cấu cột, dầm, sàn", 0.20, 0.60, "civil_engineer"),
                    ("CV04", "Xây tường bao che", 0.50, 0.75, "civil_engineer"),
                ],
            ),
            (
                "HM03",
                "Cơ điện (MEP)",
                [
                    ("CV05", "Lắp đặt hệ thống điện", 0.55, 0.90, "mep_engineer"),
                    ("CV06", "Cấp thoát nước, PCCC", 0.60, 0.95, "mep_engineer"),
                ],
            ),
            (
                "HM04",
                "Hoàn thiện & nghiệm thu",
                [
                    ("CV07", "Sơn bả, hoàn thiện", 0.80, 0.98, "civil_engineer"),
                    ("CV08", "Nghiệm thu, bàn giao", 0.97, 1.00, "project_manager"),
                ],
            ),
        ]
        elapsed = (timezone.localdate() - start).days / span if span else 0
        order = 0
        for cat_code, cat_name, tasks in plan:
            order += 1
            cat = ScheduleItem(
                workspace=workspace,
                project=profile.project,
                level="category",
                code=cat_code,
                name=cat_name,
                start_date=start + timedelta(days=int(span * tasks[0][2])),
                end_date=start + timedelta(days=int(span * tasks[-1][3])),
                sort_order=order,
            )
            cat.save()
            for code, name, a, b, who in tasks:
                order += 1
                s, e = start + timedelta(days=int(span * a)), start + timedelta(days=int(span * b))
                planned = max(0.0, min(1.0, (elapsed - a) / (b - a))) if b > a else 0
                # Slightly behind plan on purpose, so delay alerts can be tested.
                progress = Decimal(str(round(max(0.0, planned * 100 - 8), 0)))
                item = ScheduleItem(
                    workspace=workspace,
                    project=profile.project,
                    parent=cat,
                    level="task",
                    code=code,
                    name=name,
                    assignee=users[who],
                    start_date=s,
                    end_date=max(s, e),
                    progress=min(progress, Decimal("100")),
                    sort_order=order,
                )
                item.save()
                recompute_parents(item)

    def _tasks(self, workspace, profile, users):
        today = timezone.localdate()
        states = {s.group: s for s in State.objects.filter(project=profile.project)}
        for title, who, due, group, prio in [
            ("Trình duyệt mẫu vật liệu ốp lát", "qs", -2, "unstarted", "high"),
            ("Lập biện pháp an toàn thi công trên cao", "hse", 3, "started", "urgent"),
            ("Chuẩn bị hồ sơ nghiệm thu móng", "civil_engineer", 5, "unstarted", "medium"),
            ("Đối chiếu khối lượng phát sinh đợt 2", "qs", 10, "started", "medium"),
        ]:
            issue = Issue(
                workspace=workspace,
                project=profile.project,
                name=title,
                priority=prio,
                target_date=today + timedelta(days=due),
                state=states.get(group),
            )
            issue.save()
            IssueAssignee.objects.create(issue=issue, assignee=users[who], project=profile.project, workspace=workspace)
