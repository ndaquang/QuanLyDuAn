# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import uuid
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from plane.construction.models import Department, Employee
from plane.construction.services.setup import ensure_workspace_setup
from plane.db.models import User, Workspace, WorkspaceMember

PASSWORD = "Str0ng-Passw0rd!"


class Company:
    """A configured company with one account per business role."""

    def __init__(self):
        self.users = {}
        self.owner = self._user("owner")
        self.workspace = Workspace.objects.create(
            name="Công ty Test", slug=f"ct-{uuid.uuid4().hex[:8]}", owner=self.owner
        )
        WorkspaceMember.objects.create(workspace=self.workspace, member=self.owner, role=20)
        self.roles = ensure_workspace_setup(self.workspace, self.owner)
        self.departments = {d.code: d for d in Department.objects.filter(workspace=self.workspace)}
        for role in (
            "director",
            "project_manager",
            "civil_engineer",
            "mep_engineer",
            "qs",
            "hse",
            "procurement",
            "hr_admin",
            "accountant",
        ):
            self.add(role)
        # Department heads used by the approval workflow.
        self.departments["PTM"].head = self.add("procurement", key="ptm_head")
        self.departments["PTM"].save()

    def _user(self, name):
        user = User.objects.create(
            email=f"{name}-{uuid.uuid4().hex[:6]}@test.vn", username=uuid.uuid4().hex, first_name=name
        )
        user.set_password(PASSWORD)
        user.save()
        return user

    def add(self, role_code, dept="PTM", key=None):
        key = key or role_code
        user = self._user(key)
        WorkspaceMember.objects.create(workspace=self.workspace, member=user, role=15)
        Employee.objects.create(
            workspace=self.workspace,
            user=user,
            code=f"NV-{key}",
            full_name=key,
            role=self.roles[role_code],
            department=self.departments[dept],
        )
        self.users[key] = user
        return user

    def client(self, key):
        client = APIClient()
        client.force_authenticate(user=self.users[key] if key != "owner" else self.owner)
        return client

    def url(self, path):
        return f"/api/construction/workspaces/{self.workspace.slug}/{path}"

    def create_project(
        self, code="DA-01", members=("civil_engineer", "mep_engineer", "qs", "hse", "procurement"), **extra
    ):
        today = timezone.localdate()
        payload = {
            "code": code,
            "name": f"Công trình {code}",
            "investor": "Chủ đầu tư A",
            "location": "Hà Nội",
            "project_type": "civil",
            "start_date": str(today - timedelta(days=30)),
            "planned_end_date": str(today + timedelta(days=60)),
            "manager": str(self.users["project_manager"].id),
            "member_ids": [str(self.users[m].id) for m in members],
            "contract_value": "1000000000",
            **extra,
        }
        res = self.client("project_manager").post(self.url("projects/"), payload, format="json")
        assert res.status_code == 201, res.data
        return res.data


@pytest.fixture
def company(db):
    return Company()
