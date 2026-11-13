# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from datetime import timedelta

import pytest
from django.utils import timezone

from plane.construction.models import DailyReport, Notification, ScheduleItem
from plane.construction.tasks import run_reminders


def _item(
    company, project_id, level, code, parent=None, start=-10, end=10, assignee=None, client="project_manager", **extra
):
    today = timezone.localdate()
    payload = {
        "project": project_id,
        "level": level,
        "code": code,
        "name": f"Hạng mục {code}",
        "start_date": str(today + timedelta(days=start)),
        "end_date": str(today + timedelta(days=end)),
        **extra,
    }
    if parent:
        payload["parent"] = parent
    if assignee:
        payload["assignee"] = str(company.users[assignee].id)
    return company.client(client).post(company.url("schedule-items/"), payload, format="json")


@pytest.mark.contract
class TestSchedule:
    def test_wbs_hierarchy_and_rollup(self, company):
        p = company.create_project()["id"]
        cat = _item(company, p, "category", "HM1")
        assert cat.status_code == 201, cat.data
        # a task needs a category parent
        assert _item(company, p, "task", "CV0").status_code == 400
        assert _item(company, p, "activity", "CT0", parent=cat.data["id"]).status_code == 400
        t1 = _item(company, p, "task", "CV1", parent=cat.data["id"], weight="1", assignee="civil_engineer")
        t2 = _item(company, p, "task", "CV2", parent=cat.data["id"], weight="3")
        assert t1.status_code == 201 and t2.status_code == 201
        assert t1.data["duration_days"] == 21
        pm = company.client("project_manager")
        assert (
            pm.patch(company.url(f"schedule-items/{t1.data['id']}/"), {"progress": "100"}, format="json").status_code
            == 200
        )
        assert (
            pm.patch(company.url(f"schedule-items/{t2.data['id']}/"), {"progress": "20"}, format="json").status_code
            == 200
        )
        parent = ScheduleItem.objects.get(pk=cat.data["id"])
        assert float(parent.progress) == pytest.approx((100 * 1 + 20 * 3) / 4)
        done = ScheduleItem.objects.get(pk=t1.data["id"])
        assert done.status == ScheduleItem.Status.COMPLETED and done.completed_at is not None
        # duplicate code within project
        assert _item(company, p, "task", "cv1", parent=cat.data["id"]).status_code == 400
        # a parent with children cannot be deleted
        assert pm.delete(company.url(f"schedule-items/{cat.data['id']}/")).status_code == 400

    def test_assignee_must_be_project_member_and_gets_notified(self, company):
        p = company.create_project(members=("civil_engineer",))["id"]
        cat = _item(company, p, "category", "HM1").data
        assert _item(company, p, "task", "CV1", parent=cat["id"], assignee="mep_engineer").status_code == 400
        res = _item(company, p, "task", "CV2", parent=cat["id"], assignee="civil_engineer")
        assert res.status_code == 201
        assert Notification.objects.filter(recipient=company.users["civil_engineer"], type="task_new").exists()

    def test_assignee_without_update_right_can_only_report_progress(self, company):
        p = company.create_project(members=("hse",))["id"]
        cat = _item(company, p, "category", "HM1").data
        item = _item(company, p, "task", "CV1", parent=cat["id"], assignee="hse").data
        hse = company.client("hse")  # HSE role: schedule.view only
        url = company.url(f"schedule-items/{item['id']}/")
        assert hse.patch(url, {"progress": "40", "note": "Đã xong 40%"}, format="json").status_code == 200
        assert hse.patch(url, {"end_date": "2030-01-01"}, format="json").status_code == 403
        assert hse.post(company.url("schedule-items/"), {}, format="json").status_code == 403

    def test_dependency_cycle_rejected(self, company):
        p = company.create_project()["id"]
        cat = _item(company, p, "category", "HM1").data
        a = _item(company, p, "task", "A", parent=cat["id"]).data
        b = _item(company, p, "task", "B", parent=cat["id"]).data
        pm = company.client("project_manager")
        assert (
            pm.post(
                company.url("dependencies/"), {"predecessor": a["id"], "successor": b["id"]}, format="json"
            ).status_code
            == 201
        )
        res = pm.post(company.url("dependencies/"), {"predecessor": b["id"], "successor": a["id"]}, format="json")
        assert res.status_code == 400

    def test_dashboard_reports_and_reminders_use_live_data(self, company):
        p = company.create_project()["id"]
        cat = _item(company, p, "category", "HM1").data
        late = _item(company, p, "task", "CV1", parent=cat["id"], start=-20, end=-2, assignee="civil_engineer").data
        _item(company, p, "task", "CV2", parent=cat["id"], start=-5, end=1, assignee="civil_engineer")
        director = company.client("director")
        dash = director.get(company.url("dashboard/")).data
        assert dash["kpis"]["active_projects"] == 1
        assert dash["kpis"]["overdue_schedule_items"] == 1
        assert dash["kpis"]["delayed_projects"] == 1  # 0% done vs. a plan that is well under way
        assert dash["progress_chart"][0]["planned"] > dash["progress_chart"][0]["actual"]
        assert any(r["id"] == late["id"] for r in dash["overdue"])

        summary = director.get(company.url("reports/project-summary/")).data
        assert summary["rows"][0]["overdue_items"] == 1
        progress = director.get(company.url("reports/progress/")).data
        assert {r["code"] for r in progress["rows"]} == {"HM1", "CV1", "CV2"}
        hr = director.get(
            company.url("reports/hr-efficiency/"), {"date_from": "2000-01-01", "date_to": "2100-01-01"}
        ).data
        eng = next(r for r in hr["rows"] if r["code"] == "NV-civil_engineer")
        assert eng["assigned"] == 2 and eng["late_open"] == 1

        xlsx = director.get(company.url("reports/project-summary/"), {"export": "xlsx"})
        assert xlsx.status_code == 200
        assert xlsx["Content-Type"].startswith("application/vnd.openxmlformats")
        assert xlsx.content[:2] == b"PK"

        sent = run_reminders()
        assert sent >= 2
        assert Notification.objects.filter(type="task_overdue", entity_id=late["id"]).exists()
        assert Notification.objects.filter(type="task_due_soon").exists()
        assert Notification.objects.filter(type="schedule_delayed").exists()
        # idempotent for the same day
        assert run_reminders() == 0


@pytest.mark.contract
class TestDailyReport:
    def _payload(self, project_id, days_ago=0):
        return {
            "project": project_id,
            "report_date": str(timezone.localdate() - timedelta(days=days_ago)),
            "weather": "sunny",
            "manpower_count": 30,
            "work_performed": "Đổ bê tông sàn tầng 2",
        }

    def test_workflow_lock_and_duplicates(self, company):
        p = company.create_project()["id"]
        eng = company.client("civil_engineer")
        res = eng.post(company.url("daily-reports/"), self._payload(p), format="json")
        assert res.status_code == 201, res.data
        rid = res.data["id"]
        assert eng.post(company.url("daily-reports/"), self._payload(p), format="json").status_code == 400
        future = {**self._payload(p), "report_date": str(timezone.localdate() + timedelta(days=1))}
        assert eng.post(company.url("daily-reports/"), future, format="json").status_code == 400

        assert eng.post(company.url(f"daily-reports/{rid}/submit/")).status_code == 200
        assert Notification.objects.filter(
            recipient=company.users["project_manager"], type="acceptance_required"
        ).exists()
        # cannot edit while waiting, cannot approve (no permission)
        assert eng.patch(company.url(f"daily-reports/{rid}/"), {"manpower_count": 5}, format="json").status_code == 409
        assert eng.post(company.url(f"daily-reports/{rid}/approve/")).status_code == 403
        pm = company.client("project_manager")
        assert pm.post(company.url(f"daily-reports/{rid}/reject/"), {}, format="json").status_code == 400
        assert (
            pm.post(company.url(f"daily-reports/{rid}/approve/"), {"comment": "OK"}, format="json").status_code == 200
        )
        assert DailyReport.objects.get(pk=rid).status == "approved"
        # locked after approval
        assert eng.patch(company.url(f"daily-reports/{rid}/"), {"manpower_count": 5}, format="json").status_code == 409
        assert pm.delete(company.url(f"daily-reports/{rid}/")).status_code == 409

    def test_author_cannot_approve_own_report(self, company):
        p = company.create_project()["id"]
        pm = company.client("project_manager")
        rid = pm.post(company.url("daily-reports/"), self._payload(p), format="json").data["id"]
        pm.post(company.url(f"daily-reports/{rid}/submit/"))
        assert pm.post(company.url(f"daily-reports/{rid}/approve/")).status_code == 403
