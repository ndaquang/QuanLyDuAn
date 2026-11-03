# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""In-app notifications of the construction module."""

from django.db import IntegrityError, transaction

from ..models import Notification


def notify(
    workspace,
    recipients,
    type,
    title,
    *,
    message="",
    project_id=None,
    entity_type="",
    entity_id=None,
    link="",
    dedup_key=None,
    exclude=None,
):
    """Create one notification per distinct recipient. Returns the number created.

    ``dedup_key`` makes the call idempotent per recipient (used by periodic reminders).
    ``exclude`` is a user (usually the actor) who should not be notified about their own action.
    """
    created = 0
    seen = set()
    exclude_id = getattr(exclude, "id", exclude)
    for user in recipients:
        user_id = getattr(user, "id", user)
        if user_id is None or user_id in seen or (exclude_id is not None and user_id == exclude_id):
            continue
        seen.add(user_id)
        try:
            with transaction.atomic():
                Notification.objects.create(
                    workspace=workspace,
                    recipient_id=user_id,
                    project_id=project_id,
                    type=type,
                    title=title[:255],
                    message=message,
                    entity_type=entity_type,
                    entity_id=entity_id,
                    link=link,
                    dedup_key=dedup_key,
                )
            created += 1
        except IntegrityError:
            # Same reminder already delivered (dedup_key) - nothing to do.
            continue
    return created
