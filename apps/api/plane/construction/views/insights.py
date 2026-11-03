# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Dashboard, management reports, notifications, audit log and global search.

Every number here is computed from live data (schedule items, Plane issues, work logs...).
"""

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from django.db.models import Count, Q, Sum
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from plane.db.models import Issue, ProjectMember
from plane.db.models.state import StateGroup

from ..exports import xlsx_response
from ..models import (
    AuditLog,
    DailyReport,
    Document,
    Employee,
    Notification,
    ProjectProfile,
    ScheduleItem,
    Tender,
    WorkLog,
)
from ..serializers import AuditLogSerializer, NotificationSerializer, user_brief
from ..services.progress import is_behind, leaves, project_progress
from .approvals import waiting_for_user
from .base import CxAPIView, CxViewSet, paginate

OPEN_GROUPS = [StateGroup.BACKLOG.value, StateGroup.UNSTARTED.value, StateGroup.STARTED.value]


def _date_param(request, name, default=None):
    value = request.query_params.get(name)
    if not value:
        return default
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise ValidationError({name: "Ngày không hợp lệ (YYYY-MM-DD)."})


def _profiles(view, request):
    """Accessible, non-archived construction projects narrowed by the common filters."""
    qs = ProjectProfile.objects.filter(workspace=view.cx.workspace, project__archived_at__isnull=True).select_related(
        "project", "manager", "department"
    )
    qs = view.cx.filter_projects(qs, "project_id")
    p = request.query_params
    if p.get("project"):
        qs = qs.filter(project_id__in=[x for x in p["project"].split(",") if x])
    if p.get("department"):
        qs = qs.filter(department_id=p["department"])
    date_from, date_to = _date_param(request, "date_from"), _date_param(request, "date_to")
    if date_from:
        qs = qs.filter(
            Q(planned_end_date__gte=date_from)
            | Q(actual_end_date__gte=date_from)
            | Q(actual_end_date__isnull=True, status__in=["in_progress", "delayed", "paused", "awaiting_acceptance"])
        )
    if date_to:
        qs = qs.filter(start_date__lte=date_to)
    return qs, date_from, date_to


ACTIVE_STATUSES = {
    ProjectProfile.Status.IN_PROGRESS,
    ProjectProfile.Status.DELAYED,
    ProjectProfile.Status.AWAITING_ACCEPTANCE,
}


class DashboardView(CxAPIView):
    permission_module = "dashboard"

    def get(self, request, slug):
        profiles, date_from, date_to = _profiles(self, request)
        profiles = list(profiles)
        ids = [p.project_id for p in profiles]
        progress = project_progress(ids)
        today = timezone.localdate()

        behind = [p for p in profiles if is_behind(p, progress[p.project_id])]
        overdue_items = (
            leaves(ScheduleItem.objects.filter(project_id__in=ids, end_date__lt=today))
            .exclude(status=ScheduleItem.Status.COMPLETED)
            .select_related("assignee", "project")
            .order_by("end_date")
        )
        overdue_tasks = (
            Issue.issue_objects.filter(project_id__in=ids, target_date__lt=today, state__group__in=OPEN_GROUPS)
            .select_related("project")
            .prefetch_related("assignees")
            .order_by("target_date")
        )
        upcoming_items = (
            leaves(
                ScheduleItem.objects.filter(
                    project_id__in=ids, end_date__gte=today, end_date__lte=today + timedelta(days=7)
                )
            )
            .exclude(status=ScheduleItem.Status.COMPLETED)
            .select_related("assignee", "project")
            .order_by("end_date")[:10]
        )

        def late_row(kind, obj, name, due, people):
            return {
                "kind": kind,
                "id": str(obj.id),
                "name": name,
                "project_id": str(obj.project_id),
                "project_name": obj.project.name,
                "due_date": due,
                "days_late": (today - due).days,
                "assignees": people,
            }

        overdue_list = [
            late_row("schedule", i, f"{i.code} {i.name}", i.end_date, [user_brief(i.assignee)] if i.assignee else [])
            for i in overdue_items[:10]
        ]
        overdue_list += [
            late_row("task", t, t.name, t.target_date, [user_brief(u) for u in t.assignees.all()])
            for t in overdue_tasks[:10]
        ]
        overdue_list.sort(key=lambda r: r["due_date"])

        status_counts = defaultdict(int)
        for p in profiles:
            status_counts[p.status] += 1

        tenders = []
        if self.cx.has("tender.view"):
            tenders = [
                {
                    "id": str(t.id),
                    "code": t.code,
                    "name": t.name,
                    "submission_deadline": t.submission_deadline,
                    "status": t.status,
                }
                for t in Tender.objects.filter(
                    workspace=self.cx.workspace,
                    status=Tender.Status.PREPARING,
                    submission_deadline__date__gte=today,
                    submission_deadline__date__lte=today + timedelta(days=14),
                ).order_by("submission_deadline")[:5]
            ]

        return Response(
            {
                "as_of": today,
                "filters": {"date_from": date_from, "date_to": date_to},
                "kpis": {
                    "active_projects": sum(1 for p in profiles if p.status in ACTIVE_STATUSES),
                    "completed_projects": sum(1 for p in profiles if p.status == ProjectProfile.Status.COMPLETED),
                    "paused_projects": sum(1 for p in profiles if p.status == ProjectProfile.Status.PAUSED),
                    "delayed_projects": len(behind),
                    "total_projects": len(profiles),
                    "total_contract_value": sum((p.contract_value for p in profiles), Decimal("0")),
                    "overdue_schedule_items": overdue_items.count(),
                    "overdue_tasks": overdue_tasks.count(),
                    "pending_my_approval": len(waiting_for_user(self.cx.workspace, request.user)),
                },
                "progress_chart": [
                    {
                        "project_id": str(p.project_id),
                        "code": p.code,
                        "name": p.project.name,
                        "planned": float(progress[p.project_id]["planned"]),
                        "actual": float(progress[p.project_id]["actual"]),
                        "is_behind": p in behind,
                    }
                    for p in sorted(profiles, key=lambda x: x.code)
                ],
                "status_breakdown": [
                    {"status": s.value, "label": s.label, "count": status_counts.get(s.value, 0)}
                    for s in ProjectProfile.Status
                ],
                "delayed_projects": [
                    {
                        "project_id": str(p.project_id),
                        "code": p.code,
                        "name": p.project.name,
                        "manager": user_brief(p.manager),
                        "planned": float(progress[p.project_id]["planned"]),
                        "actual": float(progress[p.project_id]["actual"]),
                        "planned_end_date": p.planned_end_date,
                    }
                    for p in behind
                ],
                "overdue": overdue_list[:15],
                "upcoming": [
                    {
                        "id": str(i.id),
                        "name": f"{i.code} {i.name}",
                        "project_id": str(i.project_id),
                        "project_name": i.project.name,
                        "due_date": i.end_date,
                        "assignee": user_brief(i.assignee),
                        "progress": float(i.progress),
                    }
                    for i in upcoming_items
                ],
                "tenders": tenders,
            }
        )


class ReportView(CxAPIView):
    permission_module = "report"

    def get(self, request, slug, report):
        builder = {
            "project-summary": self.project_summary,
            "progress": self.progress,
            "hr-efficiency": self.hr_efficiency,
        }.get(report)
        if builder is None:
            return Response({"error": "Báo cáo không tồn tại."}, status=status.HTTP_404_NOT_FOUND)
        title, columns, rows, meta = builder(request)
        if request.query_params.get("export") == "xlsx":
            subtitle = " | ".join(f"{k}: {v}" for k, v in meta.items() if v) or ""
            return xlsx_response(report, title, columns, rows, subtitle=subtitle)
        return Response(
            {"title": title, "columns": [{"label": c[0], "key": c[1]} for c in columns], "rows": rows, "meta": meta}
        )

    # 1. Báo cáo tổng hợp dự án
    def project_summary(self, request):
        profiles, date_from, date_to = _profiles(self, request)
        profiles = list(profiles)
        ids = [p.project_id for p in profiles]
        progress = project_progress(ids)
        today = timezone.localdate()
        tasks = dict(
            Issue.issue_objects.filter(project_id__in=ids, state__group__in=OPEN_GROUPS)
            .values("project_id")
            .annotate(n=Count("id"))
            .values_list("project_id", "n")
        )
        late_tasks = dict(
            Issue.issue_objects.filter(project_id__in=ids, state__group__in=OPEN_GROUPS, target_date__lt=today)
            .values("project_id")
            .annotate(n=Count("id"))
            .values_list("project_id", "n")
        )
        members = dict(
            ProjectMember.objects.filter(project_id__in=ids, is_active=True)
            .values("project_id")
            .annotate(n=Count("id"))
            .values_list("project_id", "n")
        )
        reports_qs = DailyReport.objects.filter(project_id__in=ids)
        if date_from:
            reports_qs = reports_qs.filter(report_date__gte=date_from)
        if date_to:
            reports_qs = reports_qs.filter(report_date__lte=date_to)
        daily = dict(reports_qs.values("project_id").annotate(n=Count("id")).values_list("project_id", "n"))
        docs = dict(
            Document.objects.filter(project_id__in=ids, status=Document.Status.APPROVED)
            .values("project_id")
            .annotate(n=Count("id"))
            .values_list("project_id", "n")
        )
        rows = []
        for p in sorted(profiles, key=lambda x: x.code):
            pr = progress[p.project_id]
            rows.append(
                {
                    "code": p.code,
                    "name": p.project.name,
                    "investor": p.investor,
                    "type": p.get_project_type_display(),
                    "status": p.get_status_display(),
                    "manager": user_brief(p.manager)["display_name"] if p.manager else "",
                    "start_date": p.start_date,
                    "planned_end_date": p.planned_end_date,
                    "actual_end_date": p.actual_end_date,
                    "contract_value": p.contract_value,
                    "planned": float(pr["planned"]),
                    "actual": float(pr["actual"]),
                    "variance": float(pr["actual"] - pr["planned"]),
                    "behind": "Chậm" if is_behind(p, pr) else "Đúng tiến độ",
                    "items": pr["items"],
                    "overdue_items": pr["overdue"],
                    "open_tasks": tasks.get(p.project_id, 0),
                    "overdue_tasks": late_tasks.get(p.project_id, 0),
                    "members": members.get(p.project_id, 0),
                    "daily_reports": daily.get(p.project_id, 0),
                    "approved_documents": docs.get(p.project_id, 0),
                }
            )
        columns = [
            ("Mã dự án", "code"), ("Tên công trình", "name"), ("Chủ đầu tư", "investor"), ("Loại", "type"),
            ("Trạng thái", "status"), ("Phụ trách", "manager"), ("Bắt đầu", "start_date"),
            ("Kết thúc dự kiến", "planned_end_date"), ("Hoàn thành thực tế", "actual_end_date"),
            ("Giá trị HĐ (VNĐ)", "contract_value"), ("% kế hoạch", "planned"), ("% thực tế", "actual"),
            ("Chênh lệch (%)", "variance"), ("Đánh giá", "behind"), ("Số hạng mục", "items"),
            ("Hạng mục quá hạn", "overdue_items"), ("Công việc mở", "open_tasks"),
            ("Công việc quá hạn", "overdue_tasks"), ("Nhân sự", "members"),
            ("Nhật ký trong kỳ", "daily_reports"), ("Hồ sơ đã duyệt", "approved_documents"),
        ]  # fmt: skip
        return "Báo cáo tổng hợp dự án", columns, rows, {"Từ ngày": date_from, "Đến ngày": date_to}

    # 2. Báo cáo tiến độ
    def progress(self, request):
        profiles, _, _ = _profiles(self, request)
        as_of = _date_param(request, "as_of", timezone.localdate())
        ids = list(profiles.values_list("project_id", flat=True))
        items = ScheduleItem.objects.filter(project_id__in=ids).select_related("project", "assignee", "parent")
        level = request.query_params.get("level")
        if level:
            items = items.filter(level=level)
        from ..services.progress import planned_progress_of

        rows = []
        for i in items.order_by("project__name", "sort_order", "code"):
            planned = planned_progress_of(i.start_date, i.end_date, as_of)
            late_days = (
                (as_of - i.end_date).days if i.status != ScheduleItem.Status.COMPLETED and i.end_date < as_of else 0
            )
            rows.append(
                {
                    "project": i.project.name,
                    "code": i.code,
                    "name": i.name,
                    "level": i.get_level_display(),
                    "assignee": user_brief(i.assignee)["display_name"] if i.assignee else "",
                    "start_date": i.start_date,
                    "end_date": i.end_date,
                    "duration_days": i.duration_days,
                    "planned": round(float(planned), 2),
                    "actual": float(i.progress),
                    "variance": round(float(i.progress - planned), 2),
                    "status": i.get_status_display(),
                    "late_days": late_days,
                }
            )
        columns = [
            ("Dự án", "project"), ("Mã", "code"), ("Công việc", "name"), ("Cấp", "level"),
            ("Phụ trách", "assignee"), ("Bắt đầu", "start_date"), ("Kết thúc", "end_date"),
            ("Số ngày", "duration_days"), ("% kế hoạch", "planned"), ("% thực tế", "actual"),
            ("Chênh lệch", "variance"), ("Trạng thái", "status"), ("Số ngày trễ", "late_days"),
        ]  # fmt: skip
        return "Báo cáo tiến độ thi công", columns, rows, {"Tính đến ngày": as_of}

    # 3. Báo cáo hiệu quả nhân sự
    def hr_efficiency(self, request):
        self.cx.require("employee.view")
        today = timezone.localdate()
        date_from = _date_param(request, "date_from", today.replace(day=1))
        date_to = _date_param(request, "date_to", today)
        if date_to < date_from:
            raise ValidationError({"date_to": "Khoảng thời gian không hợp lệ."})
        profiles, _, _ = _profiles(self, request)
        project_ids = list(profiles.values_list("project_id", flat=True))
        employees = Employee.objects.filter(
            workspace=self.cx.workspace, status=Employee.Status.ACTIVE, user__isnull=False
        ).select_related("department", "role")
        if request.query_params.get("department"):
            employees = employees.filter(department_id=request.query_params["department"])

        items = leaves(
            ScheduleItem.objects.filter(
                project_id__in=project_ids, assignee__isnull=False, end_date__gte=date_from, end_date__lte=date_to
            )
        ).values("assignee_id", "status", "end_date", "completed_at")
        item_stats = defaultdict(lambda: {"assigned": 0, "done": 0, "on_time": 0, "late_open": 0})
        for it in items:
            s = item_stats[it["assignee_id"]]
            s["assigned"] += 1
            if it["status"] == ScheduleItem.Status.COMPLETED:
                s["done"] += 1
                if it["completed_at"] and timezone.localtime(it["completed_at"]).date() <= it["end_date"]:
                    s["on_time"] += 1
            elif it["end_date"] < today:
                s["late_open"] += 1

        tasks = Issue.issue_objects.filter(
            project_id__in=project_ids, target_date__gte=date_from, target_date__lte=date_to
        ).values("assignees__id", "state__group", "target_date", "completed_at")
        task_stats = defaultdict(lambda: {"assigned": 0, "done": 0, "on_time": 0, "late_open": 0})
        for t in tasks:
            if not t["assignees__id"]:
                continue
            s = task_stats[t["assignees__id"]]
            s["assigned"] += 1
            if t["state__group"] == StateGroup.COMPLETED.value:
                s["done"] += 1
                if t["completed_at"] and timezone.localtime(t["completed_at"]).date() <= t["target_date"]:
                    s["on_time"] += 1
            elif t["state__group"] in OPEN_GROUPS and t["target_date"] < today:
                s["late_open"] += 1

        hours = dict(
            WorkLog.objects.filter(project_id__in=project_ids, work_date__gte=date_from, work_date__lte=date_to)
            .values("user_id")
            .annotate(h=Sum("hours"))
            .values_list("user_id", "h")
        )
        reports = dict(
            DailyReport.objects.filter(project_id__in=project_ids, report_date__gte=date_from, report_date__lte=date_to)
            .values("created_by_id")
            .annotate(n=Count("id"))
            .values_list("created_by_id", "n")
        )
        memberships = dict(
            ProjectMember.objects.filter(project_id__in=project_ids, is_active=True)
            .values("member_id")
            .annotate(n=Count("project_id", distinct=True))
            .values_list("member_id", "n")
        )
        rows = []
        for e in employees:
            si, ts = item_stats[e.user_id], task_stats[e.user_id]
            assigned = si["assigned"] + ts["assigned"]
            done = si["done"] + ts["done"]
            on_time = si["on_time"] + ts["on_time"]
            rows.append(
                {
                    "code": e.code,
                    "full_name": e.full_name,
                    "position": e.position,
                    "department": e.department.name if e.department else "",
                    "projects": memberships.get(e.user_id, 0),
                    "assigned": assigned,
                    "done": done,
                    "on_time": on_time,
                    "late_open": si["late_open"] + ts["late_open"],
                    "completion_rate": round(done * 100 / assigned, 1) if assigned else None,
                    "on_time_rate": round(on_time * 100 / done, 1) if done else None,
                    "hours": float(hours.get(e.user_id) or 0),
                    "daily_reports": reports.get(e.user_id, 0),
                }
            )
        rows.sort(key=lambda r: (-(r["completion_rate"] or 0), r["full_name"]))
        columns = [
            ("Mã NV", "code"), ("Họ tên", "full_name"), ("Chức vụ", "position"), ("Phòng ban", "department"),
            ("Số dự án", "projects"), ("Việc được giao", "assigned"), ("Đã hoàn thành", "done"),
            ("Hoàn thành đúng hạn", "on_time"), ("Đang quá hạn", "late_open"),
            ("Tỷ lệ hoàn thành (%)", "completion_rate"), ("Tỷ lệ đúng hạn (%)", "on_time_rate"),
            ("Giờ công", "hours"), ("Nhật ký đã lập", "daily_reports"),
        ]  # fmt: skip
        return "Báo cáo hiệu quả nhân sự", columns, rows, {"Từ ngày": date_from, "Đến ngày": date_to}


class NotificationViewSet(CxViewSet):
    model = Notification
    serializer_class = NotificationSerializer
    http_method_names = ["get", "post", "head", "options"]
    permission_map = {"list": None, "read": None, "read_all": None, "unread_count": None, "retrieve": None}

    def get_queryset(self):
        return Notification.objects.filter(workspace=self.cx.workspace, recipient=self.request.user)

    def filter_queryset(self, qs):
        if self.request.query_params.get("unread") == "true":
            qs = qs.filter(read_at__isnull=True)
        if self.request.query_params.get("type"):
            qs = qs.filter(type__in=self.request.query_params["type"].split(","))
        return qs

    def create(self, request, *args, **kwargs):
        return Response(status=status.HTTP_405_METHOD_NOT_ALLOWED)

    @action(detail=True, methods=["post"])
    def read(self, request, slug, pk=None):
        n = self.get_object()
        if n.read_at is None:
            n.read_at = timezone.now()
            n.save(update_fields=["read_at"])
        return Response(self.get_serializer(n).data)

    @action(detail=False, methods=["post"], url_path="read-all")
    def read_all(self, request, slug):
        updated = self.get_queryset().filter(read_at__isnull=True).update(read_at=timezone.now())
        return Response({"updated": updated})

    @action(detail=False, methods=["get"], url_path="unread-count")
    def unread_count(self, request, slug):
        return Response({"count": self.get_queryset().filter(read_at__isnull=True).count()})


# Entity tables -> module whose "view" permission allows reading that record's history.
ENTITY_MODULES = {
    "cx_project_profiles": "project",
    "cx_schedule_items": "schedule",
    "cx_daily_reports": "daily_report",
    "cx_documents": "document",
    "cx_employees": "employee",
    "cx_tenders": "tender",
    "cx_materials": "material",
    "cx_suppliers": "supplier",
    "cx_approval_requests": "approval",
    "issues": "task",
}


class AuditLogViewSet(CxViewSet):
    model = AuditLog
    serializer_class = AuditLogSerializer
    http_method_names = ["get", "head", "options"]  # append-only: no write API
    permission_map = {"list": None, "retrieve": "audit.view"}
    filter_fields = {
        "entity_type": "entity_type",
        "entity_id": "entity_id",
        "actor": "actor_id",
        "action": "action",
        "project": "project_id",
        "date_from": "created_at__date__gte",
        "date_to": "created_at__date__lte",
    }
    search_fields = ("entity_label", "entity_type", "action")
    export_title = "Nhật ký hoạt động"
    export_columns = [
        ("Thời gian", "created_at"),
        ("Người thực hiện", "actor_detail"),
        ("Thao tác", "action"),
        ("Đối tượng", "entity_type"),
        ("Tên", "entity_label"),
        ("Địa chỉ IP", "ip_address"),
        (
            "Thay đổi",
            lambda r: "; ".join(
                f"{k}: {v.get('old') if isinstance(v, dict) else ''} → {v.get('new') if isinstance(v, dict) else v}"
                for k, v in (r["changes"] or {}).items()
            ),
        ),
    ]

    def get_queryset(self):
        qs = AuditLog.objects.filter(workspace=self.cx.workspace).select_related("actor")
        if self.cx.has("audit.view"):
            return qs
        # Without audit.view a user may still read the history of one record they are allowed to see.
        p = self.request.query_params
        module = ENTITY_MODULES.get(p.get("entity_type", ""))
        if not module or not p.get("entity_id"):
            from rest_framework.exceptions import PermissionDenied

            raise PermissionDenied("Bạn không có quyền xem nhật ký hoạt động.")
        self.cx.require(f"{module}.view")
        return self.cx.filter_projects(qs.filter(entity_type=p["entity_type"], entity_id=p["entity_id"]), "project_id")


class SearchView(CxAPIView):
    """Top bar search across the modules the user may read."""

    def get(self, request, slug):
        q = (request.query_params.get("q") or "").strip()
        if len(q) < 2:
            return Response({"results": []})
        cx = self.cx
        results = []
        if cx.has("project.view"):
            qs = cx.filter_projects(
                ProjectProfile.objects.filter(workspace=cx.workspace, project__archived_at__isnull=True), "project_id"
            ).filter(Q(code__icontains=q) | Q(project__name__icontains=q) | Q(investor__icontains=q))
            results += [
                {
                    "type": "project",
                    "id": str(p.project_id),
                    "title": f"{p.code} - {p.project.name}",
                    "subtitle": p.investor,
                    "link": f"/projects/{p.project_id}",
                }
                for p in qs.select_related("project")[:5]
            ]
        if cx.has("schedule.view"):
            qs = cx.filter_projects(ScheduleItem.objects.filter(workspace=cx.workspace), "project_id").filter(
                Q(code__icontains=q) | Q(name__icontains=q)
            )
            results += [
                {
                    "type": "schedule",
                    "id": str(i.id),
                    "title": f"{i.code} {i.name}",
                    "subtitle": i.project.name,
                    "link": f"/schedule?project={i.project_id}&item={i.id}",
                }
                for i in qs.select_related("project")[:5]
            ]
        if cx.has("task.view"):
            qs = cx.filter_projects(
                Issue.issue_objects.filter(workspace=cx.workspace, project__construction_profile__isnull=False),
                "project_id",
            ).filter(name__icontains=q)
            results += [
                {"type": "task", "id": str(t.id), "title": t.name, "subtitle": t.project.name, "link": f"/tasks/{t.id}"}
                for t in qs.select_related("project")[:5]
            ]
        if cx.has("employee.view"):
            qs = Employee.objects.filter(workspace=cx.workspace).filter(
                Q(full_name__icontains=q) | Q(code__icontains=q) | Q(phone__icontains=q) | Q(email__icontains=q)
            )
            results += [
                {
                    "type": "employee",
                    "id": str(e.id),
                    "title": e.full_name,
                    "subtitle": e.position or e.code,
                    "link": f"/employees/{e.id}",
                }
                for e in qs[:5]
            ]
        if cx.has("document.view"):
            qs = cx.filter_projects(Document.objects.filter(workspace=cx.workspace), "project_id").filter(
                Q(title__icontains=q) | Q(code__icontains=q)
            )
            results += [
                {
                    "type": "document",
                    "id": str(d.id),
                    "title": d.title,
                    "subtitle": d.get_category_display(),
                    "link": f"/documents?id={d.id}",
                }
                for d in qs[:5]
            ]
        if cx.has("tender.view"):
            qs = Tender.objects.filter(workspace=cx.workspace).filter(Q(name__icontains=q) | Q(code__icontains=q))
            results += [
                {
                    "type": "tender",
                    "id": str(t.id),
                    "title": f"{t.code} - {t.name}",
                    "subtitle": t.investor,
                    "link": f"/tenders/{t.id}",
                }
                for t in qs[:5]
            ]
        return Response({"results": results})


__all__ = ["DashboardView", "ReportView", "NotificationViewSet", "AuditLogViewSet", "SearchView", "paginate"]
