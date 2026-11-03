# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Create / maintain the Plane project behind each construction project."""

import re

from django.db import transaction
from rest_framework.exceptions import ValidationError

from plane.db.models import Project, ProjectMember, State, WorkspaceMember
from plane.db.models.state import DEFAULT_STATES

ADMIN, MEMBER = 20, 15


def _identifier_from_code(workspace, code):
    base = re.sub(r"[^A-Z0-9]", "", code.upper())[:10] or "DA"
    candidate, n = base, 1
    while Project.all_objects.filter(workspace=workspace, identifier=candidate).exists():
        n += 1
        candidate = f"{base[: 12 - len(str(n))]}{n}"
    return candidate


def _ensure_workspace_members(workspace, user_ids):
    user_ids = {u for u in user_ids if u}
    active = set(
        WorkspaceMember.objects.filter(workspace=workspace, member_id__in=user_ids, is_active=True).values_list(
            "member_id", flat=True
        )
    )
    missing = user_ids - active
    if missing:
        raise ValidationError({"member_ids": "Có người dùng không thuộc công ty (chưa là thành viên workspace)."})


def set_member(project, user_id, role=MEMBER):
    """Activate (or create) a Plane project membership; never downgrades an admin."""
    member = ProjectMember.all_objects.filter(project=project, member_id=user_id).first()
    if member is None:
        ProjectMember.objects.create(project=project, workspace=project.workspace, member_id=user_id, role=role)
        return True
    changed = False
    if member.deleted_at is not None or not member.is_active:
        member.deleted_at = None
        member.is_active = True
        changed = True
    if role > member.role:
        member.role = role
        changed = True
    if changed:
        member.save()
    return changed


def remove_member(project, user_id):
    ProjectMember.objects.filter(project=project, member_id=user_id).update(is_active=False)


@transaction.atomic
def create_plane_project(workspace, creator, name, code, manager_id, member_ids, description=""):
    _ensure_workspace_members(workspace, {manager_id, *member_ids})
    project = Project(
        workspace=workspace,
        name=name,
        identifier=_identifier_from_code(workspace, code),
        description=description or "",
        project_lead_id=manager_id,
        network=0,  # secret: only members see it in Plane as well
    )
    project.save(created_by_id=creator.id)
    State.objects.bulk_create(
        [
            State(
                name=s["name"],
                color=s["color"],
                project=project,
                sequence=s["sequence"],
                workspace=workspace,
                group=s["group"],
                default=s.get("default", False),
                created_by=creator,
            )
            for s in DEFAULT_STATES
        ]
    )
    set_member(project, creator.id, ADMIN)
    if manager_id:
        set_member(project, manager_id, ADMIN)
    for uid in member_ids:
        set_member(project, uid, MEMBER)
    return project


def sync_members(project, manager_id, member_ids):
    _ensure_workspace_members(project.workspace, {manager_id, *member_ids})
    if manager_id:
        set_member(project, manager_id, ADMIN)
    for uid in member_ids:
        set_member(project, uid, MEMBER)
