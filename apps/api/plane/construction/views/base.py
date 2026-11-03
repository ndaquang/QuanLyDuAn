# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import math

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from plane.authentication.session import BaseSessionAuthentication

from ..exports import xlsx_response
from ..permissions import ConstructionPermission
from ..services import audit

MAX_PAGE_SIZE = 200


class LockedError(ValidationError):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "Dữ liệu đã được phê duyệt và bị khóa, không thể chỉnh sửa hoặc xóa."


def paginate(request, items, serialize):
    """Offset pagination with page numbers (what ERP tables need)."""
    try:
        page = max(1, int(request.query_params.get("page", 1)))
        page_size = min(MAX_PAGE_SIZE, max(1, int(request.query_params.get("page_size", 20))))
    except ValueError:
        raise ValidationError({"page": "Tham số phân trang không hợp lệ."})
    count = items.count() if hasattr(items, "count") and not isinstance(items, list) else len(items)
    start = (page - 1) * page_size
    chunk = items[start : start + page_size]
    return Response(
        {
            "results": serialize(chunk),
            "count": count,
            "page": page,
            "page_size": page_size,
            "total_pages": max(1, math.ceil(count / page_size)),
        }
    )


class CxAPIView(APIView):
    authentication_classes = [BaseSessionAuthentication]
    permission_classes = [IsAuthenticated, ConstructionPermission]
    permission_module = None

    @property
    def cx(self):
        return self.request.cx


class CxViewSet(viewsets.ModelViewSet):
    authentication_classes = [BaseSessionAuthentication]
    permission_classes = [IsAuthenticated, ConstructionPermission]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    model = None
    permission_module = None
    permission_map = {}
    project_field = None  # e.g. "project_id" -> rows restricted to accessible projects
    select_related = ()
    search_fields = ()
    filter_fields = {}  # query param -> ORM lookup
    ordering_fields = ()
    export_columns = None  # [(header, accessor)] enables ?export=xlsx
    export_title = ""
    soft_delete = True

    @property
    def cx(self):
        return self.request.cx

    # ------------------------------------------------------------------ queries
    def base_queryset(self):
        qs = self.model.objects.filter(workspace=self.cx.workspace)
        if self.select_related:
            qs = qs.select_related(*self.select_related)
        if self.project_field:
            qs = self.cx.filter_projects(qs, self.project_field)
        return qs

    def get_queryset(self):
        return self.base_queryset()

    def filter_queryset(self, queryset):
        params = self.request.query_params
        q = (params.get("q") or "").strip()
        if q and self.search_fields:
            cond = Q()
            for f in self.search_fields:
                cond |= Q(**{f"{f}__icontains": q})
            queryset = queryset.filter(cond)
        for param, lookup in self.filter_fields.items():
            value = params.get(param)
            if value in (None, ""):
                continue
            if lookup.endswith("__in"):
                value = [v for v in value.split(",") if v]
            elif value in ("true", "false"):
                value = value == "true"
            try:
                queryset = queryset.filter(**{lookup: value})
            except (ValueError, DjangoValidationError):  # bad uuid/date in a filter
                raise ValidationError({param: "Giá trị lọc không hợp lệ."})
        ordering = params.get("ordering")
        if ordering and ordering.lstrip("-") in self.ordering_fields:
            queryset = queryset.order_by(ordering)
        return queryset

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx.update(self.extra_context())
        return ctx

    def extra_context(self):
        return {}

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        if request.query_params.get("export") == "xlsx" and self.export_columns:
            rows = self.get_serializer(queryset[:5000], many=True).data
            return xlsx_response(self.export_title or self.model.__name__, self.export_title, self.export_columns, rows)
        return paginate(request, queryset, lambda chunk: self.get_serializer(chunk, many=True).data)

    # ------------------------------------------------------------------ writes
    def check_locked(self, instance):
        if getattr(instance, "is_locked", False):
            raise LockedError()

    def perform_create(self, serializer):
        try:
            with transaction.atomic():
                instance = serializer.save(workspace=self.cx.workspace, **self.create_extra(serializer))
        except IntegrityError:
            raise ValidationError({"detail": "Dữ liệu bị trùng lặp với bản ghi đã có."})
        audit.record(self.request, "create", instance, changes=audit.diff({}, audit.snapshot(instance)))
        self.after_create(instance)

    def create_extra(self, serializer):
        return {}

    def after_create(self, instance):
        pass

    def perform_update(self, serializer):
        instance = serializer.instance
        self.check_locked(instance)
        before = audit.snapshot(instance)
        try:
            with transaction.atomic():
                instance = serializer.save()
        except IntegrityError:
            raise ValidationError({"detail": "Dữ liệu bị trùng lặp với bản ghi đã có."})
        changes = audit.diff(before, audit.snapshot(instance))
        if changes:
            audit.record(self.request, "update", instance, changes=changes)
        self.after_update(instance, before)

    def after_update(self, instance, before):
        pass

    def perform_destroy(self, instance):
        self.check_locked(instance)
        self.before_destroy(instance)
        label = str(instance)
        if self.soft_delete and hasattr(instance, "deleted_at"):
            instance.deleted_at = timezone.now()
            instance.save()
        else:
            instance.delete()
        audit.record(self.request, "delete", instance, label=label)

    def before_destroy(self, instance):
        pass
