import { clsx } from "clsx";
import {
  Award,
  Bell,
  BarChart3,
  Building2,
  CalendarRange,
  CheckSquare,
  ClipboardCheck,
  FileStack,
  Gavel,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Search,
  Settings,
  Users,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";

import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useDebounced, useFetch } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import type { NotificationItem, Page } from "@/lib/types";

import { Input } from "./ui";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  perm: string | string[];
}

const MAIN: NavItem[] = [
  { to: "/", label: "Tổng quan", icon: <LayoutDashboard className="size-4" />, perm: "dashboard.view" },
  { to: "/projects", label: "Dự án", icon: <Building2 className="size-4" />, perm: "project.view" },
  { to: "/schedule", label: "Tiến độ", icon: <CalendarRange className="size-4" />, perm: "schedule.view" },
  { to: "/tasks", label: "Công việc", icon: <CheckSquare className="size-4" />, perm: "task.view" },
  { to: "/employees", label: "Nhân sự", icon: <Users className="size-4" />, perm: "employee.view" },
  { to: "/reports", label: "Báo cáo", icon: <BarChart3 className="size-4" />, perm: "report.view" },
];

const MORE: NavItem[] = [
  { to: "/approvals", label: "Phê duyệt", icon: <ClipboardCheck className="size-4" />, perm: "approval.view" },
  { to: "/tenders", label: "Đấu thầu", icon: <Gavel className="size-4" />, perm: "tender.view" },
  { to: "/capabilities", label: "Hồ sơ năng lực", icon: <Award className="size-4" />, perm: "capability.view" },
  { to: "/documents", label: "Hồ sơ tài liệu", icon: <FileStack className="size-4" />, perm: "document.view" },
  {
    to: "/materials",
    label: "Vật tư & NCC",
    icon: <Package className="size-4" />,
    perm: ["material.view", "supplier.view"],
  },
  { to: "/audit", label: "Nhật ký hoạt động", icon: <History className="size-4" />, perm: "audit.view" },
  {
    to: "/settings",
    label: "Cài đặt & phân quyền",
    icon: <Settings className="size-4" />,
    perm: ["role.view", "approval_config.view"],
  },
];

function allowed(can: (c: string) => boolean, perm: string | string[]) {
  return Array.isArray(perm) ? perm.some(can) : can(perm);
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { can, workspace, ctx } = useSession();
  const link = (item: NavItem) =>
    allowed(can, item.perm) && (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.to === "/"}
        onClick={onNavigate}
        className={({ isActive }) =>
          clsx(
            "text-sm flex items-center gap-3 rounded-md px-3 py-2 font-medium transition",
            isActive ? "bg-brand-600 shadow-sm text-white" : "text-navy-100 hover:bg-navy-800 hover:text-white"
          )
        }
      >
        {item.icon}
        {item.label}
      </NavLink>
    );
  return (
    <div className="bg-navy-900 flex h-full flex-col text-white">
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="bg-brand-500 text-navy-900 flex size-9 items-center justify-center rounded-lg font-bold">
          XD
        </div>
        <div className="min-w-0">
          <div className="text-sm truncate font-semibold">{workspace?.name}</div>
          <div className="text-xs text-navy-100/70 truncate">
            {ctx?.role?.name ?? (ctx?.is_admin ? "Quản trị hệ thống" : "")}
          </div>
        </div>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
        {MAIN.map(link)}
        <div className="tracking-wider text-navy-100/50 px-3 pt-4 pb-1 text-[11px] font-semibold uppercase">
          Nghiệp vụ
        </div>
        {MORE.map(link)}
      </nav>
      <a
        href="/"
        className="border-navy-700 text-xs text-navy-100 hover:bg-navy-800 m-3 rounded-md border px-3 py-2 text-center"
      >
        Mở bảng công việc nâng cao (Plane)
      </a>
    </div>
  );
}

function GlobalSearch() {
  const { ws } = useSession();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const term = useDebounced(q.trim(), 300);
  const navigate = useNavigate();
  const { data } = useFetch<{ results: { type: string; id: string; title: string; subtitle: string; link: string }[] }>(
    term.length >= 2 ? ws("/search/") : null,
    { q: term }
  );
  const TYPE: Record<string, string> = {
    project: "Dự án",
    schedule: "Tiến độ",
    task: "Công việc",
    employee: "Nhân sự",
    document: "Hồ sơ",
    tender: "Gói thầu",
  };
  return (
    <div className="relative w-full max-w-md">
      <Search className="text-slate-400 pointer-events-none absolute top-2.5 left-2.5 size-4" />
      <Input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        placeholder="Tìm dự án, công việc, nhân sự, hồ sơ..."
        className="pl-8"
      />
      {open && term.length >= 2 && (
        <div className="border-slate-200 shadow-lg absolute z-40 mt-1 w-full overflow-hidden rounded-md border bg-white">
          {!data ? (
            <div className="text-sm text-slate-500 px-3 py-2">Đang tìm...</div>
          ) : data.results.length === 0 ? (
            <div className="text-sm text-slate-500 px-3 py-2">Không tìm thấy kết quả</div>
          ) : (
            data.results.map((r) => (
              <button
                key={`${r.type}-${r.id}`}
                type="button"
                className="text-sm hover:bg-brand-50 flex w-full items-center gap-2 px-3 py-2 text-left"
                onMouseDown={() => {
                  setQ("");
                  navigate(r.link);
                }}
              >
                <span className="text-xs text-slate-400 w-16 shrink-0">{TYPE[r.type] ?? r.type}</span>
                <span className="min-w-0 flex-1 truncate">{r.title}</span>
                <span className="text-xs text-slate-400 hidden truncate sm:inline">{r.subtitle}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function NotificationBell() {
  const { ws } = useSession();
  const [open, setOpen] = useState(false);
  const count = useFetch<{ count: number }>(ws("/notifications/unread-count/"));
  const list = useFetch<Page<NotificationItem>>(open ? ws("/notifications/") : null, { page_size: 15 });
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => void count.reload(), 60_000);
    return () => clearInterval(t);
  }, [count]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const openItem = async (n: NotificationItem) => {
    if (!n.read_at) await api.post(ws(`/notifications/${n.id}/read/`)).catch(() => undefined);
    setOpen(false);
    void count.reload();
    if (n.link) navigate(n.link);
  };

  const unread = count.data?.count ?? 0;
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-slate-600 hover:bg-slate-100 relative rounded-full p-2"
        aria-label="Thông báo"
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="bg-red-600 absolute -top-0.5 -right-0.5 min-w-5 rounded-full px-1 text-center text-[11px] leading-5 font-semibold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="border-slate-200 shadow-xl absolute right-0 z-40 mt-2 w-[min(92vw,380px)] overflow-hidden rounded-lg border bg-white">
          <div className="border-slate-100 flex items-center justify-between border-b px-4 py-2">
            <span className="text-sm font-semibold">Thông báo</span>
            <button
              type="button"
              className="text-xs text-brand-700 hover:underline"
              onClick={async () => {
                await api.post(ws("/notifications/read-all/"));
                void count.reload();
                void list.reload();
              }}
            >
              Đánh dấu đã đọc tất cả
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {(list.data?.results ?? []).length === 0 ? (
              <div className="text-sm text-slate-500 px-4 py-6 text-center">
                {list.loading ? "Đang tải..." : "Không có thông báo"}
              </div>
            ) : (
              list.data?.results.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => void openItem(n)}
                  className={clsx(
                    "border-slate-50 hover:bg-slate-50 block w-full border-b px-4 py-2.5 text-left",
                    !n.read_at && "bg-brand-50/60"
                  )}
                >
                  <div className="text-xs text-brand-700">{n.type_label}</div>
                  <div className="text-sm text-slate-800 font-medium">{n.title}</div>
                  {n.message && <div className="text-xs text-slate-500 truncate">{n.message}</div>}
                  <div className="text-slate-400 mt-0.5 text-[11px]">{fmtDateTime(n.created_at)}</div>
                </button>
              ))
            )}
          </div>
          <button
            type="button"
            className="border-slate-100 text-sm text-brand-700 hover:bg-slate-50 block w-full border-t py-2 text-center"
            onClick={() => {
              setOpen(false);
              navigate("/notifications");
            }}
          >
            Xem tất cả
          </button>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { user, workspaces, workspace, switchWorkspace, logout } = useSession();
  const [open, setOpen] = useState(false);
  const initials = (user?.display_name || "?")
    .split(" ")
    .map((p) => p[0])
    .slice(-2)
    .join("")
    .toUpperCase();
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="hover:bg-slate-100 flex items-center gap-2 rounded-full p-1"
        aria-label="Tài khoản"
      >
        <span className="bg-navy-700 text-xs flex size-8 items-center justify-center rounded-full font-semibold text-white">
          {initials}
        </span>
        <span className="text-sm text-slate-700 hidden max-w-36 truncate font-medium lg:inline">
          {user?.display_name}
        </span>
      </button>
      {open && (
        <div
          className="border-slate-200 shadow-xl absolute right-0 z-40 mt-2 w-64 rounded-lg border bg-white py-1"
          onMouseLeave={() => setOpen(false)}
        >
          <div className="border-slate-100 border-b px-4 py-2">
            <div className="text-sm font-medium">{user?.display_name}</div>
            <div className="text-xs text-slate-500 truncate">{user?.email}</div>
          </div>
          {workspaces.length > 1 && (
            <div className="border-slate-100 border-b py-1">
              <div className="text-xs text-slate-400 px-4 py-1">Chuyển công ty</div>
              {workspaces.map((w) => (
                <button
                  key={w.slug}
                  type="button"
                  className={clsx(
                    "text-sm hover:bg-slate-50 block w-full px-4 py-1.5 text-left",
                    w.slug === workspace?.slug && "text-brand-700 font-semibold"
                  )}
                  onClick={() => {
                    setOpen(false);
                    switchWorkspace(w.slug);
                  }}
                >
                  {w.name}
                </button>
              ))}
            </div>
          )}
          <a href="/settings/profile/security" className="text-sm hover:bg-slate-50 block px-4 py-2">
            Đổi mật khẩu / hồ sơ cá nhân
          </a>
          <button
            type="button"
            onClick={() => void logout()}
            className="text-sm text-red-600 hover:bg-red-50 flex w-full items-center gap-2 px-4 py-2 text-left"
          >
            <LogOut className="size-4" /> Đăng xuất
          </button>
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();
  useEffect(() => setDrawer(false), [location.pathname]);
  return (
    <div className="flex h-full">
      <aside className="no-print hidden w-60 shrink-0 lg:block">
        <Sidebar />
      </aside>
      {drawer && (
        <div className="no-print fixed inset-0 z-50 flex lg:hidden">
          <div className="shadow-xl w-64">
            <Sidebar onNavigate={() => setDrawer(false)} />
          </div>
          <button
            type="button"
            className="bg-slate-900/40 flex-1"
            onClick={() => setDrawer(false)}
            aria-label="Đóng menu"
          >
            <X className="mt-2 ml-2 size-6 text-white" />
          </button>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print border-slate-200 sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-white px-4">
          <button
            type="button"
            className="text-slate-600 hover:bg-slate-100 rounded p-1.5 lg:hidden"
            onClick={() => setDrawer(true)}
            aria-label="Mở menu"
          >
            <Menu className="size-5" />
          </button>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-1">
            <NotificationBell />
            <UserMenu />
          </div>
        </header>
        <main className="print-full flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
