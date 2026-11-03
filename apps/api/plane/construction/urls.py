# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import include, path
from rest_framework.routers import SimpleRouter

from .views.approvals import ApprovalRequestViewSet, ApprovalWorkflowViewSet
from .views.auth import ContextView, LoginView, LogoutView, MeView, SetupView, WorkspaceUsersView
from .views.catalog import (
    AttachmentViewSet,
    DocumentViewSet,
    MaterialViewSet,
    SupplierViewSet,
    TenderItemViewSet,
    TenderViewSet,
)
from .views.insights import AuditLogViewSet, DashboardView, NotificationViewSet, ReportView, SearchView
from .views.org import DepartmentViewSet, EmployeeViewSet, PermissionCatalogueView, RoleViewSet
from .views.projects import (
    DailyReportViewSet,
    DependencyViewSet,
    MilestoneViewSet,
    ProjectViewSet,
    ScheduleItemViewSet,
    WorkLogViewSet,
)
from .views.tasks import TaskViewSet

router = SimpleRouter(trailing_slash=True)
router.register("projects", ProjectViewSet, basename="cx-project")
router.register("schedule-items", ScheduleItemViewSet, basename="cx-schedule-item")
router.register("dependencies", DependencyViewSet, basename="cx-dependency")
router.register("milestones", MilestoneViewSet, basename="cx-milestone")
router.register("daily-reports", DailyReportViewSet, basename="cx-daily-report")
router.register("work-logs", WorkLogViewSet, basename="cx-work-log")
router.register("tasks", TaskViewSet, basename="cx-task")
router.register("roles", RoleViewSet, basename="cx-role")
router.register("departments", DepartmentViewSet, basename="cx-department")
router.register("employees", EmployeeViewSet, basename="cx-employee")
router.register("suppliers", SupplierViewSet, basename="cx-supplier")
router.register("materials", MaterialViewSet, basename="cx-material")
router.register("tenders", TenderViewSet, basename="cx-tender")
router.register("tender-items", TenderItemViewSet, basename="cx-tender-item")
router.register("documents", DocumentViewSet, basename="cx-document")
router.register("attachments", AttachmentViewSet, basename="cx-attachment")
router.register("approval-workflows", ApprovalWorkflowViewSet, basename="cx-approval-workflow")
router.register("approval-requests", ApprovalRequestViewSet, basename="cx-approval-request")
router.register("notifications", NotificationViewSet, basename="cx-notification")
router.register("audit-logs", AuditLogViewSet, basename="cx-audit-log")

workspace_patterns = [
    path("context/", ContextView.as_view(), name="cx-context"),
    path("setup/", SetupView.as_view(), name="cx-setup"),
    path("users/", WorkspaceUsersView.as_view(), name="cx-users"),
    path("permissions/", PermissionCatalogueView.as_view(), name="cx-permissions"),
    path("dashboard/", DashboardView.as_view(), name="cx-dashboard"),
    path("reports/<str:report>/", ReportView.as_view(), name="cx-report"),
    path("search/", SearchView.as_view(), name="cx-search"),
    path("", include(router.urls)),
]

urlpatterns = [
    path("auth/login/", LoginView.as_view(), name="cx-login"),
    path("auth/logout/", LogoutView.as_view(), name="cx-logout"),
    path("me/", MeView.as_view(), name="cx-me"),
    path("workspaces/<str:slug>/", include(workspace_patterns)),
]
