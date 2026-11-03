# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db import transaction
from django.utils import timezone

from ..models import Sequence


def next_code(workspace, prefix):
    """Return the next ``PREFIX-YYYY-NNNN`` code; safe under concurrency (row lock)."""
    year = timezone.localdate().year
    key = f"{prefix}-{year}"
    with transaction.atomic():
        seq, _ = Sequence.objects.select_for_update().get_or_create(workspace=workspace, key=key)
        seq.value += 1
        seq.save(update_fields=["value"])
    return f"{key}-{seq.value:04d}"
