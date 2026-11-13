# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest
from rest_framework.test import APIClient

from plane.construction.models import AuditLog, ProjectProfile
from plane.db.models import Project, ProjectMember, State, User, WorkspaceMember


@pytest.mark.contract
class TestAccessControl:
    def test_anonymous_is_rejected(self, company):
        assert APIClient().get(company.url("projects/")).status_code in (401, 403)

    def test_non_member_of_workspace_gets_404(self, company):
        outsider = User.objects.create(email="out@x.vn", username="outsider")
        client = APIClient()
        client.force_authenticate(outsider)
        assert client.get(company.url("projects/")).status_code == 404

    def test_member_without_role_has_no_permission(self, company):
        user = User.objects.create(email="norole@x.vn", username="norole")
        WorkspaceMember.objects.create(workspace=company.workspace, member=user, role=15)
        client = APIClient()
        client.force_authenticate(user)
        assert client.get(company.url("projects/")).status_code == 403
        ctx = client.get(company.url("context/")).data
        assert ctx["permissions"] == []

    def test_engineer_cannot_create_project(self, company):
        res = company.client("civil_engineer").post(company.url("projects/"), {"code": "X"}, format="json")
        assert res.status_code == 403

    def test_project_manager_creates_project_with_plane_backing(self, company):
        data = company.create_project("DA-100")
        project = Project.objects.get(pk=data["id"])
        assert project.network == 0
        assert State.objects.filter(project=project).count() >= 5
        assert ProjectMember.objects.filter(project=project, member=company.users["project_manager"], role=20).exists()
        assert ProjectMember.objects.filter(
            project=project, member=company.users["civil_engineer"], is_active=True
        ).exists()
        assert AuditLog.objects.filter(entity_type="cx_project_profiles", action="create").exists()

    def test_duplicate_project_code_rejected(self, company):
        company.create_project("DA-200")
        res = company.client("project_manager").post(
            company.url("projects/"),
            {
                "code": "da-200",
                "name": "x",
                "investor": "y",
                "start_date": "2026-01-01",
                "planned_end_date": "2026-02-01",
                "manager": str(company.users["project_manager"].id),
            },
            format="json",
        )
        assert res.status_code == 400 and "code" in res.data
        res = company.client("project_manager").post(
            company.url("projects/"),
            {
                "code": "DA-201",
                "name": "Công trình DA-200",
                "investor": "y",
                "start_date": "2026-01-01",
                "planned_end_date": "2026-02-01",
                "manager": str(company.users["project_manager"].id),
            },
            format="json",
        )
        assert res.status_code == 400 and "name" in res.data

    def test_end_date_must_follow_start(self, company):
        res = company.client("project_manager").post(
            company.url("projects/"),
            {
                "code": "DA-9",
                "name": "x",
                "investor": "y",
                "start_date": "2026-03-01",
                "planned_end_date": "2026-02-01",
                "manager": str(company.users["project_manager"].id),
            },
            format="json",
        )
        assert res.status_code == 400 and "planned_end_date" in res.data

    def test_project_visibility_is_per_project(self, company):
        data = company.create_project("DA-300", members=("civil_engineer",))
        outsider = company.add("mep_engineer", key="mep2")
        member_list = company.client("civil_engineer").get(company.url("projects/")).data
        assert [p["code"] for p in member_list["results"]] == ["DA-300"]
        other = company.client("mep2")
        assert other.get(company.url("projects/")).data["count"] == 0
        assert other.get(company.url(f"projects/{data['id']}/")).status_code == 404
        # nor can the outsider read its schedule, tasks or reports
        assert other.get(company.url(f"schedule-items/?project={data['id']}")).data["count"] == 0
        assert other.get(company.url(f"tasks/?project={data['id']}")).data["count"] == 0
        assert outsider is not None
        # see_all_projects roles (director) see it without membership
        assert company.client("director").get(company.url(f"projects/{data['id']}/")).status_code == 200

    def test_delete_archives_instead_of_erasing(self, company):
        data = company.create_project("DA-400")
        assert company.client("project_manager").delete(company.url(f"projects/{data['id']}/")).status_code == 204
        assert Project.objects.get(pk=data["id"]).archived_at is not None
        assert ProjectProfile.all_objects.get(project_id=data["id"]).deleted_at is not None
        assert AuditLog.objects.filter(action="delete", entity_type="cx_project_profiles").exists()

    def test_role_matrix_change_requires_permission(self, company):
        role_id = company.roles["civil_engineer"].id
        res = company.client("civil_engineer").patch(
            company.url(f"roles/{role_id}/"), {"permission_codes": ["project.create"]}, format="json"
        )
        assert res.status_code == 403
        res = company.client("director").patch(
            company.url(f"roles/{role_id}/"), {"permission_codes": ["project.view", "project.create"]}, format="json"
        )
        assert res.status_code == 200
        assert sorted(res.data["permissions"]) == ["project.create", "project.view"]
        # takes effect immediately on the backend
        res = company.client("civil_engineer").get(company.url("context/"))
        assert "project.create" in res.data["permissions"]

    def test_audit_log_is_append_only(self, company):
        company.create_project("DA-500")
        log = AuditLog.objects.first()
        client = company.client("director")
        assert client.get(company.url("audit-logs/")).status_code == 200
        assert client.delete(company.url(f"audit-logs/{log.id}/")).status_code == 405
        assert client.patch(company.url(f"audit-logs/{log.id}/"), {"action": "x"}, format="json").status_code == 405
        # engineers lack audit.view
        assert company.client("civil_engineer").get(company.url("audit-logs/")).status_code == 403

    def test_cross_company_reference_rejected(self, company):
        from plane.construction.models import Department
        from plane.db.models import Workspace

        other_ws = Workspace.objects.create(name="Khác", slug="cong-ty-khac", owner=company.owner)
        foreign = Department.objects.create(workspace=other_ws, code="X", name="X")
        res = company.client("hr_admin").post(
            company.url("employees/"), {"code": "NV-X", "full_name": "A", "department": str(foreign.id)}, format="json"
        )
        assert res.status_code == 400


@pytest.mark.contract
class TestProjectMembers:
    def test_add_and_remove_members_with_string_ids(self, company):
        data = company.create_project("DA-600", members=("civil_engineer",))
        pm = company.client("project_manager")
        qs_id = str(company.users["qs"].id)
        res = pm.post(company.url(f"projects/{data['id']}/members/add/"), {"user_ids": [qs_id]}, format="json")
        assert res.status_code == 200, res.data
        assert qs_id in {m["id"] for m in res.data}
        assert company.client("qs").get(company.url(f"projects/{data['id']}/")).status_code == 200
        # unknown and malformed ids are refused
        assert (
            pm.post(
                company.url(f"projects/{data['id']}/members/add/"),
                {"user_ids": ["00000000-0000-0000-0000-000000000000"]},
                format="json",
            ).status_code
            == 400
        )
        assert (
            pm.post(
                company.url(f"projects/{data['id']}/members/add/"), {"user_ids": ["not-a-uuid"]}, format="json"
            ).status_code
            == 400
        )
        # engineers cannot change membership
        assert (
            company.client("civil_engineer")
            .post(company.url(f"projects/{data['id']}/members/add/"), {"user_ids": [qs_id]}, format="json")
            .status_code
            == 403
        )
        res = pm.post(company.url(f"projects/{data['id']}/members/remove/"), {"user_id": qs_id}, format="json")
        assert res.status_code == 204
        assert company.client("qs").get(company.url(f"projects/{data['id']}/")).status_code == 404
        # the manager cannot be removed
        mgr = str(company.users["project_manager"].id)
        assert (
            pm.post(company.url(f"projects/{data['id']}/members/remove/"), {"user_id": mgr}, format="json").status_code
            == 400
        )
