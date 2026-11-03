# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from datetime import timedelta

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework.test import APIClient

from plane.construction.models import Attachment, Notification
from plane.db.models import Issue

from .conftest import PASSWORD


@pytest.mark.contract
class TestTasks:
    def test_create_assign_and_status_rules(self, company):
        p = company.create_project(members=("civil_engineer", "accountant"))["id"]
        pm = company.client("project_manager")
        due = str(timezone.localdate() + timedelta(days=3))
        bad = pm.post(
            company.url("tasks/"),
            {"project": p, "title": "x", "assignee_ids": [str(company.users["hse"].id)]},
            format="json",
        )
        assert bad.status_code == 400
        res = pm.post(
            company.url("tasks/"),
            {
                "project": p,
                "title": "Nghiệm thu cốt thép",
                "due_date": due,
                "priority": "high",
                "assignee_ids": [str(company.users["accountant"].id)],
                "description": "Dòng 1\nDòng 2",
            },
            format="json",
        )
        assert res.status_code == 201, res.data
        tid = res.data["id"]
        assert res.data["status"] == "todo" and res.data["assigner"]["id"] == str(company.users["project_manager"].id)
        assert Issue.objects.filter(pk=tid, project_id=p).exists()
        assert Notification.objects.filter(recipient=company.users["accountant"], type="task_new").exists()

        acc = company.client("accountant")  # only task.view
        assert acc.patch(company.url(f"tasks/{tid}/"), {"title": "đổi"}, format="json").status_code == 403
        res = acc.patch(company.url(f"tasks/{tid}/"), {"status": "done"}, format="json")
        assert res.status_code == 200 and res.data["status"] == "done"
        assert Issue.objects.get(pk=tid).completed_at is not None

        res = acc.post(company.url(f"tasks/{tid}/comments/"), {"text": "Đã hoàn thành"}, format="json")
        assert res.status_code == 200 and res.data[-1]["text"] == "Đã hoàn thành"
        assert Notification.objects.filter(
            recipient=company.users["project_manager"], title__startswith="Bình luận"
        ).exists()

        mine = company.client("accountant").get(company.url("tasks/?assignee=me")).data
        assert mine["count"] == 1
        assert pm.get(company.url("tasks/?overdue=true")).data["count"] == 0

    def test_overdue_filter(self, company):
        p = company.create_project()["id"]
        pm = company.client("project_manager")
        pm.post(
            company.url("tasks/"),
            {"project": p, "title": "Trễ", "due_date": str(timezone.localdate() - timedelta(days=1))},
            format="json",
        )
        res = pm.get(company.url("tasks/?overdue=true")).data
        assert res["count"] == 1 and res["results"][0]["is_overdue"] is True


@pytest.mark.contract
class TestAttachments:
    @pytest.fixture(autouse=True)
    def local_storage(self, tmp_path, monkeypatch):
        monkeypatch.setenv("CONSTRUCTION_FILE_STORAGE", "local")
        monkeypatch.setenv("CONSTRUCTION_MEDIA_ROOT", str(tmp_path))

    def test_photo_upload_download_and_access(self, company):
        p = company.create_project(members=("civil_engineer",))["id"]
        eng = company.client("civil_engineer")
        report = eng.post(
            company.url("daily-reports/"),
            {"project": p, "report_date": str(timezone.localdate()), "work_performed": "Đào móng"},
            format="json",
        ).data
        photo = SimpleUploadedFile("hien-truong.jpg", b"\xff\xd8\xff\xe0fakejpeg", content_type="image/jpeg")
        res = eng.post(
            company.url("attachments/"),
            {"entity_type": "daily_report", "entity_id": report["id"], "file": photo},
            format="multipart",
        )
        assert res.status_code == 201, res.data
        att = res.data[0]
        assert att["content_type"] == "image/jpeg"
        dl = eng.get(att["url"])
        assert dl.status_code == 200 and b"".join(dl.streaming_content).startswith(b"\xff\xd8")

        exe = SimpleUploadedFile("virus.exe", b"MZ", content_type="application/octet-stream")
        res = eng.post(
            company.url("attachments/"),
            {"entity_type": "daily_report", "entity_id": report["id"], "file": exe},
            format="multipart",
        )
        assert res.status_code == 400

        outsider = company.add("civil_engineer", key="eng2")
        assert outsider
        assert company.client("eng2").get(att["url"]).status_code == 404
        assert (
            company.client("eng2")
            .get(company.url(f"attachments/?entity_type=daily_report&entity_id={report['id']}"))
            .status_code
            == 404
        )

        assert eng.delete(company.url(f"attachments/{att['id']}/")).status_code == 204
        assert Attachment.objects.count() == 0

    def test_employee_photo(self, company):
        emp = company.client("hr_admin").get(company.url("employees/?q=qs")).data["results"][0]
        photo = SimpleUploadedFile("chan-dung.png", b"\x89PNG\r\n\x1a\nxxxx", content_type="image/png")
        res = company.client("hr_admin").post(
            company.url(f"employees/{emp['id']}/photo/"), {"file": photo}, format="multipart"
        )
        assert res.status_code == 200 and res.data["photo_url"]
        assert (
            company.client("civil_engineer")
            .post(company.url(f"employees/{emp['id']}/photo/"), {"file": photo}, format="multipart")
            .status_code
            == 403
        )


@pytest.mark.contract
class TestAuthAndAccounts:
    @pytest.fixture(autouse=True)
    def base_url(self, settings):
        settings.WEB_URL = "http://testserver"
        settings.APP_BASE_URL = "http://testserver"

    def test_login_logout(self, company):
        client = APIClient()
        user = company.users["qs"]
        bad = client.post("/api/construction/auth/login/", {"email": user.email, "password": "wrong"}, format="json")
        assert bad.status_code == 400
        ok = client.post("/api/construction/auth/login/", {"email": user.email, "password": PASSWORD}, format="json")
        assert ok.status_code == 200, ok.data
        me = client.get("/api/construction/me/")
        assert me.status_code == 200 and me.data["workspaces"][0]["slug"] == company.workspace.slug
        assert client.post("/api/construction/auth/logout/").status_code == 204
        assert client.get("/api/construction/me/").status_code in (401, 403)

    def test_login_rejects_foreign_origin(self, company):
        client = APIClient()
        res = client.post(
            "/api/construction/auth/login/",
            {"email": company.users["qs"].email, "password": PASSWORD},
            format="json",
            HTTP_ORIGIN="https://evil.example",
        )
        assert res.status_code == 403

    def test_hr_creates_account_for_employee(self, company):
        hr = company.client("hr_admin")
        emp = hr.post(
            company.url("employees/"),
            {"code": "NV-100", "full_name": "Trần Văn Mới", "email": "moi@test.vn"},
            format="json",
        )
        assert emp.status_code == 201, emp.data
        weak = hr.post(company.url(f"employees/{emp.data['id']}/create-account/"), {"password": "123"}, format="json")
        assert weak.status_code == 400
        res = hr.post(
            company.url(f"employees/{emp.data['id']}/create-account/"), {"password": "Xay-Dung@2026"}, format="json"
        )
        assert res.status_code == 201, res.data
        client = APIClient()
        assert (
            client.post(
                "/api/construction/auth/login/", {"email": "moi@test.vn", "password": "Xay-Dung@2026"}, format="json"
            ).status_code
            == 200
        )
        # assigning a role is a permission change: HR holds employee.* but not role.update
        res = hr.patch(
            company.url(f"employees/{emp.data['id']}/"), {"role": str(company.roles["director"].id)}, format="json"
        )
        assert res.status_code == 403
