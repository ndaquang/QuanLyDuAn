// oxlint-disable-next-line import/no-unassigned-import -- global stylesheet
import "./index.css";

import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Link, Navigate } from "react-router";
import { RouterProvider } from "react-router/dom";

import { Layout } from "@/components/Layout";
import { Spinner, UiProvider } from "@/components/ui";
import { SessionProvider, useSession } from "@/lib/session";
import { ApprovalDetailPage, ApprovalsPage } from "@/pages/Approvals";
import { AuditPage } from "@/pages/Audit";
import { DashboardPage } from "@/pages/Dashboard";
import { DocumentsPage } from "@/pages/Documents";
import { EmployeeDetailPage, EmployeesPage } from "@/pages/Employees";
import { LoginPage } from "@/pages/Login";
import { MaterialsPage } from "@/pages/Materials";
import { NotificationsPage } from "@/pages/Notifications";
import { ProjectDetailPage } from "@/pages/ProjectDetail";
import { ProjectsPage } from "@/pages/Projects";
import { ReportsPage } from "@/pages/Reports";
import { SchedulePage } from "@/pages/Schedule";
import { SettingsPage } from "@/pages/Settings";
import { SetupPage } from "@/pages/Setup";
import { TaskDetailPage, TasksPage } from "@/pages/Tasks";
import { TenderDetailPage, TendersPage } from "@/pages/Tenders";

/** Hides a page the role cannot open (the API refuses it anyway). */
function Guard({ perm, children }: { perm: string | string[]; children: ReactNode }) {
  const { can } = useSession();
  const ok = Array.isArray(perm) ? perm.some(can) : can(perm);
  if (ok) return <>{children}</>;
  return (
    <div className="border-amber-200 bg-amber-50 text-sm text-amber-900 rounded-lg border p-6">
      Bạn chưa được cấp quyền truy cập chức năng này. Liên hệ quản trị viên nếu cần.{" "}
      <Link className="text-brand-700 ml-2 underline" to="/">
        Về trang chủ
      </Link>
    </div>
  );
}

function Home() {
  const { can } = useSession();
  if (can("dashboard.view")) return <DashboardPage />;
  if (can("task.view")) return <Navigate to="/tasks" replace />;
  return (
    <div className="border-slate-200 text-sm text-slate-600 rounded-lg border bg-white p-6">
      Tài khoản của bạn chưa được gán vai trò. Vui lòng liên hệ bộ phận Nhân sự - Hành chính hoặc quản trị viên để được
      phân quyền.
    </div>
  );
}

const g = (perm: string | string[], el: ReactNode) => <Guard perm={perm}>{el}</Guard>;

const router = createBrowserRouter(
  [
    {
      path: "/",
      element: <Layout />,
      children: [
        { index: true, element: <Home /> },
        { path: "projects", element: g("project.view", <ProjectsPage />) },
        { path: "projects/:id", element: g("project.view", <ProjectDetailPage />) },
        { path: "schedule", element: g("schedule.view", <SchedulePage />) },
        { path: "tasks", element: g("task.view", <TasksPage />) },
        { path: "tasks/:id", element: g("task.view", <TaskDetailPage />) },
        { path: "employees", element: g("employee.view", <EmployeesPage />) },
        { path: "employees/:id", element: g("employee.view", <EmployeeDetailPage />) },
        { path: "tenders", element: g("tender.view", <TendersPage />) },
        { path: "tenders/:id", element: g("tender.view", <TenderDetailPage />) },
        { path: "documents", element: g("document.view", <DocumentsPage />) },
        { path: "materials", element: g(["material.view", "supplier.view"], <MaterialsPage />) },
        { path: "approvals", element: g("approval.view", <ApprovalsPage />) },
        { path: "approvals/:id", element: g("approval.view", <ApprovalDetailPage />) },
        { path: "reports", element: g("report.view", <ReportsPage />) },
        { path: "audit", element: g("audit.view", <AuditPage />) },
        { path: "settings", element: g(["role.view", "approval_config.view"], <SettingsPage />) },
        { path: "notifications", element: <NotificationsPage /> },
        {
          path: "*",
          element: (
            <div className="text-sm text-slate-500 p-6">
              Không tìm thấy trang.{" "}
              <Link className="text-brand-700 underline" to="/">
                Về trang chủ
              </Link>
            </div>
          ),
        },
      ],
    },
  ],
  { basename: "/erp" }
);

function App() {
  const { status } = useSession();
  if (status === "loading") return <Spinner className="h-full" />;
  if (status === "anonymous") return <LoginPage />;
  if (status === "no-workspace" || status === "not-configured") return <SetupPage />;
  return <RouterProvider router={router} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <UiProvider>
      <SessionProvider>
        <App />
      </SessionProvider>
    </UiProvider>
  </StrictMode>
);
