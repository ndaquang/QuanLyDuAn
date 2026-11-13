# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.apps import AppConfig


class ConstructionConfig(AppConfig):
    """Construction-company ERP module built on top of Plane's workspaces, projects and issues."""

    name = "plane.construction"
    label = "construction"
    verbose_name = "Quản lý công ty xây dựng"
    default_auto_field = "django.db.models.BigAutoField"
