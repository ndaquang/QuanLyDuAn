# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from datetime import timedelta

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone

from plane.construction.models import CapabilityDocument, Notification, ProjectProfile, Tender, TenderItem
from plane.construction.tasks import run_reminders


def _tender(company, who="procurement", days=10, **extra):
    payload = {
        "code": extra.pop("code", "GT-01"),
        "name": extra.pop("name", "Gói thầu xây lắp nhà xưởng"),
        "investor": "Công ty CP Minh Phát",
        "owner": str(company.users[who].id),
        "submission_deadline": (timezone.now() + timedelta(days=days)).isoformat(),
        "package_type": "construction",
        **extra,
    }
    res = company.client(who).post(company.url("tenders/"), payload, format="json")
    assert res.status_code == 201, res.data
    return res.data


def _post(company, who, tender_id, path, body=None):
    return company.client(who).post(company.url(f"tenders/{tender_id}/{path}/"), body or {}, format="json")


def _task(company, tender_id, who="procurement", assignee="civil_engineer", **extra):
    payload = {"tender": tender_id, "name": extra.pop("name", "Biện pháp thi công"), **extra}
    if assignee:
        payload["assignee"] = str(company.users[assignee].id)
    return company.client(who).post(company.url("tender-items/"), payload, format="json")


def _go(company, tender_id):
    res = _post(company, "director", tender_id, "decide", {"decision": "go"})
    assert res.status_code == 200, res.data


def _complete_tasks(tender_id):
    for item in TenderItem.objects.filter(tender_id=tender_id):
        item.status = TenderItem.Status.DONE
        item.save()


@pytest.mark.contract
class TestTenderWorkflow:
    def test_no_price_fields_are_exposed(self, company):
        t = _tender(company)
        for key in t:
            assert "price" not in key and "value" not in key and "cost" not in key, key
        res = company.client("procurement").post(
            company.url("tenders/"),
            {
                "code": "GT-02",
                "name": "x",
                "investor": "y",
                "submission_deadline": t["submission_deadline"],
                "bid_value": 5,
            },
            format="json",
        )
        assert res.status_code == 201 and "bid_value" not in res.data  # unknown input is ignored, never stored

    def test_go_no_go_needs_approve_right(self, company):
        t = _tender(company)
        assert t["status"] == "screening" and t["decision"] == "pending"
        assert _post(company, "procurement", t["id"], "decide", {"decision": "go"}).status_code == 403
        assert _post(company, "director", t["id"], "decide", {"decision": "no_go"}).status_code == 400
        res = _post(company, "director", t["id"], "decide", {"decision": "go", "note": "Phù hợp năng lực"})
        assert res.status_code == 200 and res.data["status"] == "preparing"
        assert Notification.objects.filter(recipient=company.users["procurement"], type="tender_deadline").exists()
        assert _post(company, "director", t["id"], "decide", {"decision": "no_go", "note": "x"}).status_code == 400

    def test_no_go_closes_and_locks(self, company):
        t = _tender(company)
        res = _post(company, "director", t["id"], "decide", {"decision": "no_go", "note": "Ngoài năng lực"})
        assert res.data["status"] == "declined" and res.data["is_locked"]
        assert (
            company.client("procurement")
            .patch(company.url(f"tenders/{t['id']}/"), {"name": "x"}, format="json")
            .status_code
            == 409
        )
        assert _task(company, t["id"]).status_code == 400  # tasks of a closed tender are frozen

    def test_submit_requires_go_and_all_tasks_done(self, company):
        t = _tender(company)
        assert _post(company, "procurement", t["id"], "transition", {"status": "submitted"}).status_code == 400
        _go(company, t["id"])
        res = _post(company, "procurement", t["id"], "apply-template")
        assert res.status_code == 201 and len(res.data) >= 10
        assert all(str(i["assignee"]) == str(company.users["procurement"].id) for i in res.data)
        assert _post(company, "procurement", t["id"], "apply-template").data == []  # idempotent

        res = _post(company, "procurement", t["id"], "transition", {"status": "submitted"})
        assert res.status_code == 400 and "checklist" in res.data
        assert (
            _post(company, "procurement", t["id"], "transition", {"status": "submitted", "force": True}).status_code
            == 403
        )
        forced = _post(company, "director", t["id"], "transition", {"status": "submitted", "force": True})
        assert forced.status_code == 200 and forced.data["status"] == "submitted"

    def test_full_path_to_won_and_project(self, company):
        t = _tender(company)
        _go(company, t["id"])
        _task(company, t["id"])
        _complete_tasks(t["id"])
        assert _post(company, "procurement", t["id"], "transition", {"status": "submitted"}).status_code == 200
        res = _post(company, "procurement", t["id"], "transition", {"status": "won"})
        assert res.status_code == 200 and res.data["status"] == "won" and res.data["is_locked"]
        today = timezone.localdate()
        body = {
            "code": "DA-T01",
            "manager": str(company.users["project_manager"].id),
            "start_date": str(today),
            "planned_end_date": str(today + timedelta(days=200)),
        }
        assert _post(company, "procurement", t["id"], "create-project", body).status_code == 403
        res = _post(company, "director", t["id"], "create-project", body)
        assert res.status_code == 201, res.data
        profile = ProjectProfile.objects.get(code="DA-T01")
        assert profile.investor == "Công ty CP Minh Phát"
        assert Tender.objects.get(pk=t["id"]).project_id == profile.project_id
        assert _post(company, "director", t["id"], "create-project", {**body, "code": "DA-T02"}).status_code == 400
        stats = company.client("director").get(company.url("tenders/stats/")).data
        assert stats["won"] == 1 and stats["win_rate"] == 100.0

    def test_lost_needs_reason_and_invalid_transitions(self, company):
        t = _tender(company)
        assert _post(company, "procurement", t["id"], "transition", {"status": "won"}).status_code == 400
        _go(company, t["id"])
        _complete_tasks(t["id"])
        _post(company, "procurement", t["id"], "transition", {"status": "submitted"})
        assert _post(company, "procurement", t["id"], "transition", {"status": "lost"}).status_code == 400
        res = _post(
            company,
            "procurement",
            t["id"],
            "transition",
            {"status": "lost", "lost_reason": "technical", "winner_name": "Công ty Delta"},
        )
        assert res.status_code == 200 and res.data["winner_name"] == "Công ty Delta"
        report = company.client("director").get(company.url("reports/tenders/")).data
        keys = {c["key"] for c in report["columns"]}
        assert not {k for k in keys if "price" in k or "value" in k or "gap" in k}
        assert report["rows"][0]["lost_reason"] == "Không đạt kỹ thuật"

    def test_cancel_needs_reason(self, company):
        t = _tender(company)
        assert _post(company, "procurement", t["id"], "transition", {"status": "cancelled"}).status_code == 400
        res = _post(company, "procurement", t["id"], "transition", {"status": "cancelled", "note": "CĐT hủy gói"})
        assert res.data["status"] == "cancelled"


@pytest.mark.contract
class TestTenderTasks:
    def test_assign_notifies_and_validates(self, company):
        t = _tender(company, days=10)
        res = _task(company, t["id"], due_date=str((timezone.now() + timedelta(days=4)).date()), priority="high")
        assert res.status_code == 201, res.data
        assert res.data["priority"] == "high" and res.data["tender_code"] == "GT-01"
        assert Notification.objects.filter(
            recipient=company.users["civil_engineer"], type="task_new", title__contains="Bạn được giao"
        ).exists()
        # due date after the submission deadline is refused
        late = _task(company, t["id"], name="Muộn", due_date=str((timezone.now() + timedelta(days=30)).date()))
        assert late.status_code == 400 and "due_date" in late.data
        # assignee must be a company member
        assert (
            company.client("procurement")
            .post(
                company.url("tender-items/"),
                {"tender": t["id"], "name": "x", "assignee": "00000000-0000-0000-0000-000000000000"},
                format="json",
            )
            .status_code
            == 400
        )
        # engineers cannot create tasks
        assert _task(company, t["id"], who="civil_engineer").status_code == 403

    def test_reassign_notifies_new_assignee(self, company):
        t = _tender(company)
        item = _task(company, t["id"]).data
        res = company.client("procurement").patch(
            company.url(f"tender-items/{item['id']}/"), {"assignee": str(company.users["qs"].id)}, format="json"
        )
        assert res.status_code == 200
        assert Notification.objects.filter(recipient=company.users["qs"], title__contains="Bạn được giao").exists()

    def test_assignee_updates_own_task_only(self, company):
        t = _tender(company)
        item = _task(company, t["id"]).data
        other = _task(company, t["id"], name="Việc khác", assignee="qs").data
        eng = company.client("civil_engineer")
        res = eng.patch(company.url(f"tender-items/{item['id']}/"), {"status": "done"}, format="json")
        assert res.status_code == 200 and res.data["completed_at"]
        assert Notification.objects.filter(
            recipient=company.users["procurement"], title__contains="Đã hoàn thành"
        ).exists()
        assert eng.patch(company.url(f"tender-items/{item['id']}/"), {"name": "đổi"}, format="json").status_code == 403
        assert (
            eng.patch(company.url(f"tender-items/{other['id']}/"), {"status": "done"}, format="json").status_code == 403
        )
        # reopening clears completion
        res = eng.patch(company.url(f"tender-items/{item['id']}/"), {"status": "in_progress"}, format="json")
        assert res.data["completed_at"] is None

    def test_my_tasks_across_tenders_and_filters(self, company):
        t1, t2 = _tender(company), _tender(company, code="GT-02", name="Gói 2")
        _task(company, t1["id"])
        _task(company, t2["id"], name="Việc gói 2")
        _task(company, t2["id"], name="Của QS", assignee="qs")
        eng = company.client("civil_engineer")
        mine = eng.get(company.url("tender-items/?assignee=me")).data
        assert mine["count"] == 2 and {r["tender_code"] for r in mine["results"]} == {"GT-01", "GT-02"}
        assert eng.get(company.url("tender-items/?assignee=not-a-uuid")).status_code == 400
        assert eng.get(company.url(f"tender-items/?tender={t2['id']}&status=done")).data["count"] == 0
        done = TenderItem.objects.get(name="Của QS")
        done.due_date = timezone.localdate() - timedelta(days=2)
        done.save()
        res = company.client("procurement").get(company.url("tender-items/?overdue=true")).data
        assert res["count"] == 1 and res["results"][0]["is_overdue"] is True
        stats = eng.get(company.url("tenders/stats/")).data
        assert stats["tasks"]["mine_open"] == 2 and stats["tasks"]["overdue"] == 1

    def test_comments_and_attachments(self, company, tmp_path, monkeypatch):
        monkeypatch.setenv("CONSTRUCTION_FILE_STORAGE", "local")
        monkeypatch.setenv("CONSTRUCTION_MEDIA_ROOT", str(tmp_path))
        t = _tender(company)
        item = _task(company, t["id"]).data
        eng = company.client("civil_engineer")
        res = eng.post(company.url(f"tender-items/{item['id']}/comments/"), {"text": "Đã gửi bản nháp"}, format="json")
        assert res.status_code == 200 and res.data[-1]["text"] == "Đã gửi bản nháp"
        assert (
            eng.post(company.url(f"tender-items/{item['id']}/comments/"), {"text": "  "}, format="json").status_code
            == 400
        )
        assert Notification.objects.filter(
            recipient=company.users["procurement"], title__contains="Bình luận mới"
        ).exists()
        # someone not involved cannot comment, but can read
        assert (
            company.client("mep_engineer")
            .post(company.url(f"tender-items/{item['id']}/comments/"), {"text": "x"}, format="json")
            .status_code
            == 403
        )
        assert (
            company.client("mep_engineer").get(company.url(f"tender-items/{item['id']}/comments/")).status_code == 200
        )

        f = SimpleUploadedFile("bien-phap.pdf", b"%PDF-1.4 test", content_type="application/pdf")
        res = eng.post(
            company.url("attachments/"),
            {"entity_type": "tender_item", "entity_id": item["id"], "file": f},
            format="multipart",
        )
        assert res.status_code == 201, res.data
        f2 = SimpleUploadedFile("x.pdf", b"%PDF", content_type="application/pdf")
        assert (
            company.client("mep_engineer")
            .post(
                company.url("attachments/"),
                {"entity_type": "tender_item", "entity_id": item["id"], "file": f2},
                format="multipart",
            )
            .status_code
            == 403
        )
        assert (
            company.client("mep_engineer")
            .get(company.url(f"attachments/?entity_type=tender_item&entity_id={item['id']}"))
            .status_code
            == 200
        )


@pytest.mark.contract
class TestTenderRecordsAndReminders:
    def test_clarifications(self, company):
        t = _tender(company)
        client = company.client("procurement")
        c = client.post(
            company.url("tender-clarifications/"),
            {"tender": t["id"], "question": "Làm rõ chủng loại thép?"},
            format="json",
        )
        assert c.status_code == 201 and c.data["is_answered"] is False
        c = client.patch(
            company.url(f"tender-clarifications/{c.data['id']}/"), {"answer": "Theo TCVN 1651"}, format="json"
        )
        assert c.data["is_answered"] and c.data["answered_date"]
        assert client.get(company.url("tender-clarifications/")).status_code == 400
        assert (
            company.client("civil_engineer")
            .post(company.url("tender-clarifications/"), {"tender": t["id"], "question": "x"}, format="json")
            .status_code
            == 403
        )
        detail = client.get(company.url(f"tenders/{t['id']}/")).data
        assert detail["counts"]["clarifications_open"] == 0 and detail["counts"]["documents"] == 0

    def test_capability_library_and_linking(self, company):
        hr = company.client("hr_admin")
        doc = hr.post(
            company.url("capability-documents/"),
            {
                "category": "certificate",
                "title": "Chứng chỉ năng lực hạng II",
                "expiry_date": str(timezone.localdate() + timedelta(days=10)),
            },
            format="json",
        )
        assert doc.status_code == 201, doc.data
        assert "value" not in doc.data
        assert (
            company.client("civil_engineer")
            .post(company.url("capability-documents/"), {"category": "legal", "title": "x"}, format="json")
            .status_code
            == 403
        )
        t = _tender(company)
        res = company.client("procurement").patch(
            company.url(f"tenders/{t['id']}/"), {"capability_document_ids": [doc.data["id"]]}, format="json"
        )
        assert res.status_code == 200 and [str(x) for x in res.data["capability_document_ids"]] == [doc.data["id"]]
        lib = hr.get(company.url("capability-documents/?expiring=30")).data["results"]
        assert lib[0]["tender_count"] == 1 and lib[0]["days_to_expiry"] == 10

    def test_reminders(self, company):
        t = _tender(company, days=3)
        Tender.objects.filter(pk=t["id"]).update(
            clarification_deadline=timezone.localdate() + timedelta(days=1), status="preparing", decision="go"
        )
        item = TenderItem.objects.create(
            workspace=company.workspace,
            tender_id=t["id"],
            name="Hồ sơ năng lực",
            assignee=company.users["qs"],
            due_date=timezone.localdate() - timedelta(days=1),
        )
        CapabilityDocument.objects.create(
            workspace=company.workspace,
            category="legal",
            title="Giấy phép",
            expiry_date=timezone.localdate() + timedelta(days=5),
        )
        run_reminders()
        titles = list(
            Notification.objects.filter(recipient=company.users["procurement"]).values_list("title", flat=True)
        )
        assert any("Hạn nộp thầu còn 3 ngày" in x for x in titles)
        assert any("Hạn hỏi đáp" in x for x in titles)
        assert any("Quá hạn công việc thầu" in x for x in titles)  # the owner is told about overdue tasks
        assert Notification.objects.filter(
            recipient=company.users["qs"], entity_id=item.id, type="task_overdue"
        ).exists()
        assert Notification.objects.filter(recipient=company.users["hr_admin"], type="document_expiry").exists()
        before = Notification.objects.count()
        run_reminders()
        assert Notification.objects.count() == before

    def test_calendar_and_my_calendar(self, company):
        t = _tender(company, days=5)
        item = _task(company, t["id"], due_date=str((timezone.now() + timedelta(days=2)).date())).data
        res = company.client("procurement").get(company.url("tenders/calendar/")).data
        kinds = {e["kind"] for e in res["events"] if e["tender_id"] == t["id"]}
        assert {"submission", "item"} <= kinds
        mine = company.client("qs").get(company.url("tenders/calendar/?mine=true")).data
        assert not any(e["kind"] == "item" for e in mine["events"])
        eng = company.client("civil_engineer").get(company.url("tenders/calendar/?mine=true")).data
        assert any(e["kind"] == "item" and e["name"] == item["name"] for e in eng["events"])
