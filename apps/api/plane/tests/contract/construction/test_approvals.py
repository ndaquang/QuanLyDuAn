# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest

from plane.construction.models import ApprovalHistory, ApprovalRequest, Employee, Notification


def _create(
    company, who="procurement", amount=100_000_000, project=None, request_type="purchase", submit=True, **extra
):
    payload = {"request_type": request_type, "title": "Mua thép", "amount": amount, "submit": submit, **extra}
    if project:
        payload["project"] = project
    return company.client(who).post(company.url("approval-requests/"), payload, format="json")


def _act(company, who, rid, verb, comment=""):
    return company.client(who).post(
        company.url(f"approval-requests/{rid}/{verb}/"), {"comment": comment}, format="json"
    )


@pytest.mark.contract
class TestApprovalWorkflow:
    def test_full_financial_chain_with_director_limit(self, company):
        p = company.create_project()["id"]
        res = _create(company, project=p)
        assert res.status_code == 201, res.data
        rid = res.data["id"]
        assert res.data["code"].startswith("PD-")
        assert res.data["status"] == "pending"
        assert res.data["current_step_name"] == "Trưởng bộ phận kiểm tra"
        assert Notification.objects.filter(recipient=company.users["ptm_head"], type="purchase_request").exists()

        # requester cannot approve; nobody can skip ahead
        assert _act(company, "procurement", rid, "approve").status_code == 403
        assert _act(company, "director", rid, "approve").status_code == 403
        assert _act(company, "ptm_head", rid, "approve").status_code == 200
        # not yet their turn: the request is not even visible to them
        assert _act(company, "accountant", rid, "approve").status_code in (403, 404)
        assert _act(company, "project_manager", rid, "approve").status_code == 200
        # budget check step needs a written comment
        assert _act(company, "accountant", rid, "approve").status_code == 400
        assert _act(company, "accountant", rid, "approve", "Còn ngân sách vật tư").status_code == 200
        req = ApprovalRequest.objects.get(pk=rid)
        assert req.status == "pending" and req.current_step.name == "Giám đốc phê duyệt"
        assert _act(company, "director", rid, "approve", "Đồng ý").status_code == 200
        req.refresh_from_db()
        assert req.status == "approved" and req.decided_at is not None
        assert list(req.history.values_list("action", flat=True)) == [
            "submit",
            "approve",
            "approve",
            "approve",
            "approve",
        ]
        assert Notification.objects.filter(recipient=company.users["procurement"], type="approval_result").exists()

        # locked once approved
        client = company.client("procurement")
        assert client.patch(company.url(f"approval-requests/{rid}/"), {"title": "x"}, format="json").status_code == 409
        assert client.delete(company.url(f"approval-requests/{rid}/")).status_code == 409
        assert _act(company, "procurement", rid, "cancel").status_code == 400

    def test_below_limit_skips_director_but_still_needs_humans(self, company):
        p = company.create_project()["id"]
        res = _create(company, amount=10_000_000, project=p)
        req = ApprovalRequest.objects.get(pk=res.data["id"])
        assert len(req.step_plan) == 3
        names = [s for s in req.workflow.steps.filter(id__in=req.step_plan).values_list("name", flat=True)]
        assert "Giám đốc phê duyệt" not in names

    def test_financial_request_with_missing_approver_cannot_be_submitted(self, company):
        Employee.objects.filter(user=company.users["accountant"]).update(role=None)
        p = company.create_project()["id"]
        res = _create(company, project=p)
        assert res.status_code == 400
        # create + submit is atomic: nothing half-done is left behind
        assert not ApprovalRequest.objects.exists()
        draft = _create(company, project=p, submit=False)
        assert draft.status_code == 201
        assert _act(company, "procurement", draft.data["id"], "submit").status_code == 400
        assert ApprovalRequest.objects.get().status == "draft"

    def test_company_level_request_skips_project_manager_step(self, company):
        res = _create(company)  # no project
        assert res.status_code == 201, res.data
        req = ApprovalRequest.objects.get(pk=res.data["id"])
        names = list(req.workflow.steps.filter(id__in=req.step_plan).order_by("order").values_list("name", flat=True))
        assert names == ["Trưởng bộ phận kiểm tra", "Kế toán kiểm tra ngân sách", "Giám đốc phê duyệt"]

    def test_financial_request_needs_amount(self, company):
        assert _create(company, amount=0).status_code == 400

    def test_purchase_lines_compute_amount(self, company):
        res = _create(
            company, amount=1, submit=False, details={"lines": [{"name": "Thép", "quantity": 100, "unit_price": 20000}]}
        )
        assert res.status_code == 201
        assert res.data["amount"] == "2000000"

    def test_requester_who_is_department_head_skips_own_level(self, company):
        p = company.create_project(members=("ptm_head",))["id"]
        res = _create(company, who="ptm_head", project=p)
        assert res.status_code == 201
        assert res.data["current_step_name"] == "Trưởng dự án xác nhận"
        assert ApprovalHistory.objects.filter(request_id=res.data["id"], action="skip").exists()

    def test_reject_requires_reason_and_allows_resubmission(self, company):
        p = company.create_project()["id"]
        rid = _create(company, project=p).data["id"]
        assert _act(company, "ptm_head", rid, "reject").status_code == 400
        assert _act(company, "ptm_head", rid, "reject", "Thiếu báo giá").status_code == 200
        client = company.client("procurement")
        assert (
            client.patch(company.url(f"approval-requests/{rid}/"), {"amount": 90_000_000}, format="json").status_code
            == 200
        )
        res = client.post(company.url(f"approval-requests/{rid}/submit/"))
        assert res.status_code == 200 and res.data["status"] == "pending"

    def test_visibility_of_requests(self, company):
        p = company.create_project()["id"]
        rid = _create(company, project=p).data["id"]
        assert company.client("hse").get(company.url(f"approval-requests/{rid}/")).status_code == 404
        assert company.client("ptm_head").get(company.url("approval-requests/?scope=to_approve")).data["count"] == 1
        assert (
            company.client("director").get(company.url("approval-requests/")).data["count"] == 1
        )  # approval_config.view

    def test_leave_request_non_financial(self, company):
        res = _create(
            company,
            who="civil_engineer",
            request_type="leave",
            amount=0,
            details={"from": "2026-12-01", "to": "2026-12-02"},
        )
        assert res.status_code == 201, res.data
        rid = res.data["id"]
        assert _act(company, "ptm_head", rid, "approve").status_code == 200
        assert _act(company, "hr_admin", rid, "approve").status_code == 200
        assert ApprovalRequest.objects.get(pk=rid).status == "approved"

    def test_workflow_configuration_requires_permission(self, company):
        wf = company.client("director").get(company.url("approval-workflows/")).data[0]
        steps = [
            {
                "order": 1,
                "name": "Giám đốc duyệt",
                "approver_kind": "role",
                "approver_role": str(company.roles["director"].id),
            }
        ]
        assert (
            company.client("project_manager")
            .patch(company.url(f"approval-workflows/{wf['id']}/"), {"steps": steps}, format="json")
            .status_code
            == 403
        )
        res = company.client("director").patch(
            company.url(f"approval-workflows/{wf['id']}/"), {"steps": steps}, format="json"
        )
        assert res.status_code == 200 and len(res.data["steps"]) == 1
        assert (
            company.client("director")
            .patch(company.url(f"approval-workflows/{wf['id']}/"), {"steps": []}, format="json")
            .status_code
            == 400
        )
