# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Progress calculations (actual vs planned), all derived from schedule data."""

from collections import defaultdict
from decimal import ROUND_HALF_UP, Decimal

from django.db.models import Avg
from django.utils import timezone

from ..models import ScheduleItem

ZERO = Decimal("0")
HUNDRED = Decimal("100")
# A project is "behind schedule" when actual progress lags the plan by more than this many points.
DELAY_THRESHOLD = Decimal("10")


def _q(value):
    return Decimal(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def planned_progress_of(item_start, item_end, on_date):
    if on_date < item_start:
        return ZERO
    if on_date >= item_end:
        return HUNDRED
    total = (item_end - item_start).days + 1
    elapsed = (on_date - item_start).days + 1
    return Decimal(elapsed) * HUNDRED / Decimal(total)


def recompute_parents(item):
    """Roll the weighted progress of children up the WBS tree (activity -> task -> category)."""
    parent = item.parent
    while parent is not None:
        children = list(ScheduleItem.objects.filter(parent=parent).values("progress", "weight"))
        total_weight = sum((c["weight"] for c in children), ZERO)
        if children:
            if total_weight > 0:
                value = sum((c["progress"] * c["weight"] for c in children), ZERO) / total_weight
            else:
                value = sum((c["progress"] for c in children), ZERO) / len(children)
            parent.progress = _q(value)
            parent.save()
        parent = parent.parent


def project_progress(project_ids, on_date=None):
    """{project_id: {"actual": Decimal, "planned": Decimal, "items": n, "overdue": n}} based on leaf items."""
    on_date = on_date or timezone.localdate()
    items = ScheduleItem.objects.filter(project_id__in=project_ids).values(
        "id", "project_id", "parent_id", "progress", "weight", "start_date", "end_date", "status"
    )
    items = list(items)
    parents = {i["parent_id"] for i in items if i["parent_id"]}
    acc = defaultdict(lambda: {"w": ZERO, "actual": ZERO, "planned": ZERO, "items": 0, "overdue": 0, "count": 0})
    for item in items:
        if item["id"] in parents:
            continue  # only leaves carry real progress
        a = acc[item["project_id"]]
        w = item["weight"] if item["weight"] > 0 else Decimal("1")
        a["w"] += w
        a["actual"] += item["progress"] * w
        a["planned"] += planned_progress_of(item["start_date"], item["end_date"], on_date) * w
        a["count"] += 1
        if item["status"] != ScheduleItem.Status.COMPLETED and item["end_date"] < on_date:
            a["overdue"] += 1
    result = {}
    for pid in project_ids:
        a = acc.get(pid)
        if not a or a["w"] == 0:
            result[pid] = {"actual": ZERO, "planned": ZERO, "items": 0, "overdue": 0}
            continue
        result[pid] = {
            "actual": _q(a["actual"] / a["w"]),
            "planned": _q(a["planned"] / a["w"]),
            "items": a["count"],
            "overdue": a["overdue"],
        }
    return result


def is_behind(profile, progress, on_date=None):
    """Behind schedule if actual lags plan by > DELAY_THRESHOLD, or past the planned end and not completed."""
    from ..models import ProjectProfile

    on_date = on_date or timezone.localdate()
    if profile.status == ProjectProfile.Status.COMPLETED:
        return False
    if profile.status == ProjectProfile.Status.DELAYED:
        return True
    if profile.planned_end_date < on_date and profile.status != ProjectProfile.Status.AWAITING_ACCEPTANCE:
        return True
    return (progress["planned"] - progress["actual"]) > DELAY_THRESHOLD


def average_progress(queryset):
    return queryset.aggregate(v=Avg("progress"))["v"] or ZERO


def leaves(queryset):
    """Keep only leaf items (no live children) - the ones that carry real work."""
    parent_ids = ScheduleItem.objects.filter(parent__isnull=False).values("parent_id")
    return queryset.exclude(id__in=parent_ids)
