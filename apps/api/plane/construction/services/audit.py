# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Append-only activity history ("Nhật ký hoạt động")."""

import datetime
import decimal
import ipaddress
import uuid

from django.db import models

from plane.utils.ip_address import get_client_ip

from ..models import AuditLog

IGNORED_FIELDS = {"created_at", "updated_at", "created_by", "updated_by", "deleted_at", "workspace"}


def _json_value(value):
    if isinstance(value, (datetime.date, datetime.datetime)):
        return value.isoformat()
    if isinstance(value, (decimal.Decimal, uuid.UUID)):
        return str(value)
    if isinstance(value, models.Model):
        return str(value.pk)
    return value


def snapshot(instance):
    """Plain dict of concrete field values, used to compute diffs."""
    data = {}
    for f in instance._meta.concrete_fields:
        if f.name in IGNORED_FIELDS:
            continue
        data[f.name] = _json_value(getattr(instance, f.attname))
    return data


def diff(before, after):
    changes = {}
    for key in set(before or {}) | set(after or {}):
        old = (before or {}).get(key)
        new = (after or {}).get(key)
        if old != new:
            changes[key] = {"old": old, "new": new}
    return changes


def _client_ip(request):
    ip = (get_client_ip(request) or "").strip()
    try:
        return str(ipaddress.ip_address(ip))
    except ValueError:
        return None


def record(
    request, action, instance=None, *, entity_type=None, entity_id=None, label="", changes=None, project_id=None
):
    ctx = getattr(request, "cx", None)
    workspace = ctx.workspace if ctx else None
    if instance is not None:
        entity_type = entity_type or instance._meta.db_table
        entity_id = entity_id or str(instance.pk)
        label = label or str(instance)[:500]
        if project_id is None:
            project_id = getattr(instance, "project_id", None)
    user = request.user if request.user and request.user.is_authenticated else None
    return AuditLog.objects.create(
        workspace=workspace,
        actor=user,
        action=action,
        entity_type=entity_type or "",
        entity_id=entity_id or "",
        entity_label=label[:500],
        project_id=project_id,
        changes=changes or {},
        ip_address=_client_ip(request),
        user_agent=(request.META.get("HTTP_USER_AGENT") or "")[:500],
    )
