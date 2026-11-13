import { AlertTriangle, Building2, CheckCircle2, ClipboardCheck, Clock, Wallet } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { DepartmentSelect, ProjectSelect } from "@/components/pickers";
import { Badge, Card, ErrorBox, Field, Input, PageHeader, ProgressBar, Spinner } from "@/components/ui";
import { fmtDate, fmtDateTime, fmtMoneyShort } from "@/lib/format";
import { useFetch } from "@/lib/hooks";
import { PROJECT_STATUS, toneOf } from "@/lib/labels";
import { useSession } from "@/lib/session";
import type { UserBrief } from "@/lib/types";

// Validated categorical pair (lightness, chroma, CVD and contrast checks pass on white).
const PLANNED = "#4f46e5";
const ACTUAL = "#0891b2";

interface Dashboard {
  as_of: string;
  kpis: {
    active_projects: number;
    completed_projects: number;
    paused_projects: number;
    delayed_projects: number;
    total_projects: number;
    total_contract_value: string;
    overdue_schedule_items: number;
    overdue_tasks: number;
    pending_my_approval: number;
  };
  progress_chart: {
    project_id: string;
    code: string;
    name: string;
    planned: number;
    actual: number;
    is_behind: boolean;
  }[];
  status_breakdown: { status: string; label: string; count: number }[];
  delayed_projects: {
    project_id: string;
    code: string;
    name: string;
    manager: UserBrief | null;
    planned: number;
    actual: number;
    planned_end_date: string;
  }[];
  overdue: {
    kind: string;
    id: string;
    name: string;
    project_id: string;
    project_name: string;
    due_date: string;
    days_late: number;
    assignees: UserBrief[];
  }[];
  upcoming: {
    id: string;
    name: string;
    project_id: string;
    project_name: string;
    due_date: string;
    assignee: UserBrief | null;
    progress: number;
  }[];
  tenders: { id: string; code: string; name: string; submission_deadline: string }[];
}

function Kpi({
  label,
  value,
  icon,
  tone,
  to,
}: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  tone: string;
  to?: string;
}) {
  const body = (
    <div className="border-slate-200 shadow-xs hover:shadow-sm flex items-center gap-3 rounded-lg border bg-white p-4 transition">
      <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${tone}`}>{icon}</div>
      <div className="min-w-0">
        <div className="text-xs text-slate-500 leading-tight">{label}</div>
        <div className="text-xl text-navy-800 font-semibold tabular-nums">{value}</div>
      </div>
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

function ProgressTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: Dashboard["progress_chart"][number] }[];
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="border-slate-200 text-xs shadow-lg rounded-md border bg-white px-3 py-2">
      <div className="text-slate-800 mb-1 font-semibold">
        {p.code} - {p.name}
      </div>
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-sm" style={{ background: PLANNED }} /> Kế hoạch:{" "}
        <strong>{p.planned.toFixed(1)}%</strong>
      </div>
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-sm" style={{ background: ACTUAL }} /> Thực tế:{" "}
        <strong>{p.actual.toFixed(1)}%</strong>
      </div>
      {p.is_behind && <div className="text-red-700 mt-1 font-medium">⚠ Chậm tiến độ</div>}
    </div>
  );
}

export function DashboardPage() {
  const { ws, can } = useSession();
  const [filters, setFilters] = useState({ date_from: "", date_to: "", project: "", department: "" });
  const { data, error, loading, reload } = useFetch<Dashboard>(ws("/dashboard/"), filters);
  const set = (k: keyof typeof filters, v: string) => setFilters((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Dashboard điều hành"
        subtitle={data ? `Số liệu tính đến ${fmtDate(data.as_of)} từ dữ liệu tiến độ và công việc thực tế` : undefined}
      />
      <div className="no-print border-slate-200 grid grid-cols-2 gap-3 rounded-lg border bg-white p-3 md:grid-cols-4">
        <Field label="Từ ngày">
          <Input type="date" value={filters.date_from} onChange={(e) => set("date_from", e.target.value)} />
        </Field>
        <Field label="Đến ngày">
          <Input type="date" value={filters.date_to} onChange={(e) => set("date_to", e.target.value)} />
        </Field>
        <Field label="Dự án">
          <ProjectSelect
            placeholder="Tất cả dự án"
            value={filters.project}
            onChange={(e) => set("project", e.target.value)}
          />
        </Field>
        <Field label="Phòng ban">
          <DepartmentSelect
            placeholder="Tất cả phòng ban"
            value={filters.department}
            onChange={(e) => set("department", e.target.value)}
          />
        </Field>
      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Spinner />}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
            <Kpi
              label="Dự án đang thực hiện"
              value={data.kpis.active_projects}
              icon={<Building2 className="size-5" />}
              tone="bg-brand-100 text-brand-700"
              to="/projects?status=in_progress,delayed,awaiting_acceptance"
            />
            <Kpi
              label="Dự án hoàn thành"
              value={data.kpis.completed_projects}
              icon={<CheckCircle2 className="size-5" />}
              tone="bg-emerald-100 text-emerald-700"
              to="/projects?status=completed"
            />
            <Kpi
              label="Dự án chậm tiến độ"
              value={data.kpis.delayed_projects}
              icon={<AlertTriangle className="size-5" />}
              tone="bg-red-100 text-red-700"
            />
            <Kpi
              label="Tổng giá trị hợp đồng"
              value={fmtMoneyShort(data.kpis.total_contract_value)}
              icon={<Wallet className="size-5" />}
              tone="bg-navy-100 text-navy-700"
            />
            <Kpi
              label="Công việc quá hạn"
              value={data.kpis.overdue_schedule_items + data.kpis.overdue_tasks}
              icon={<Clock className="size-5" />}
              tone="bg-amber-100 text-amber-800"
              to="/tasks?overdue=true"
            />
            <Kpi
              label="Chờ tôi phê duyệt"
              value={data.kpis.pending_my_approval}
              icon={<ClipboardCheck className="size-5" />}
              tone="bg-violet-100 text-violet-700"
              to="/approvals?scope=to_approve"
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card title="Tiến độ các công trình (% kế hoạch so với thực tế)" className="xl:col-span-2">
              {data.progress_chart.length === 0 ? (
                <p className="text-sm text-slate-500 py-10 text-center">Chưa có dự án trong bộ lọc.</p>
              ) : (
                <div style={{ height: Math.max(260, data.progress_chart.length * 44 + 60) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data.progress_chart}
                      layout="vertical"
                      margin={{ left: 8, right: 24, top: 4, bottom: 4 }}
                      barGap={2}
                      barCategoryGap="28%"
                    >
                      <CartesianGrid horizontal={false} stroke="#e2e8f0" />
                      <XAxis
                        type="number"
                        domain={[0, 100]}
                        unit="%"
                        tick={{ fontSize: 11, fill: "#64748b" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        type="category"
                        dataKey="code"
                        width={80}
                        tick={{ fontSize: 12, fill: "#334155" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip content={<ProgressTooltip />} cursor={{ fill: "#f1f5f9" }} />
                      <Legend
                        wrapperStyle={{ fontSize: 12 }}
                        iconType="square"
                        formatter={(value: string) => <span style={{ color: "#334155" }}>{value}</span>}
                      />
                      <Bar dataKey="planned" name="Kế hoạch" fill={PLANNED} radius={[0, 4, 4, 0]} maxBarSize={14} />
                      <Bar dataKey="actual" name="Thực tế" fill={ACTUAL} radius={[0, 4, 4, 0]} maxBarSize={14} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
            <Card title="Dự án theo trạng thái">
              <ul className="space-y-2">
                {data.status_breakdown.map((s) => (
                  <li key={s.status} className="flex items-center gap-3">
                    <Badge tone={toneOf(PROJECT_STATUS, s.status)} className="w-32 justify-center">
                      {s.label}
                    </Badge>
                    <div className="bg-slate-100 h-2 flex-1 overflow-hidden rounded-full">
                      <div
                        className="bg-navy-600 h-full rounded-full"
                        style={{
                          width: `${data.kpis.total_projects ? (s.count * 100) / data.kpis.total_projects : 0}%`,
                        }}
                      />
                    </div>
                    <span className="text-sm w-6 text-right font-semibold tabular-nums">{s.count}</span>
                  </li>
                ))}
              </ul>
              {data.delayed_projects.length > 0 && (
                <div className="mt-5">
                  <div className="text-xs text-red-700 mb-2 font-semibold tracking-wide uppercase">
                    Dự án chậm tiến độ
                  </div>
                  <ul className="space-y-2">
                    {data.delayed_projects.map((p) => (
                      <li key={p.project_id}>
                        <Link
                          to={`/projects/${p.project_id}`}
                          className="border-red-100 bg-red-50/50 hover:bg-red-50 block rounded-md border p-2"
                        >
                          <div className="text-sm font-medium">
                            {p.code} - {p.name}
                          </div>
                          <ProgressBar value={p.actual} planned={p.planned} className="mt-1" />
                          <div className="text-xs text-slate-500 mt-0.5">
                            Kế hoạch {p.planned.toFixed(0)}% · Hạn {fmtDate(p.planned_end_date)}
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card title={`Công việc quá hạn (${data.kpis.overdue_schedule_items + data.kpis.overdue_tasks})`}>
              {data.overdue.length === 0 ? (
                <p className="text-sm text-emerald-700 py-6 text-center">Không có công việc quá hạn 👍</p>
              ) : (
                <ul className="divide-slate-100 divide-y">
                  {data.overdue.map((o) => (
                    <li key={`${o.kind}-${o.id}`} className="flex items-center gap-3 py-2">
                      <Badge tone="red">trễ {o.days_late} ngày</Badge>
                      <Link
                        to={o.kind === "task" ? `/tasks/${o.id}` : `/schedule?project=${o.project_id}&item=${o.id}`}
                        className="min-w-0 flex-1"
                      >
                        <div className="text-sm hover:text-brand-700 truncate font-medium">{o.name}</div>
                        <div className="text-xs text-slate-500 truncate">
                          {o.project_name} · {o.assignees.map((a) => a.display_name).join(", ") || "Chưa giao"}
                        </div>
                      </Link>
                      <span className="text-xs text-slate-500">{fmtDate(o.due_date)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Sắp đến hạn trong 7 ngày">
              {data.upcoming.length === 0 ? (
                <p className="text-sm text-slate-500 py-6 text-center">Không có hạng mục sắp đến hạn.</p>
              ) : (
                <ul className="divide-slate-100 divide-y">
                  {data.upcoming.map((u) => (
                    <li key={u.id} className="flex items-center gap-3 py-2">
                      <Link to={`/schedule?project=${u.project_id}&item=${u.id}`} className="min-w-0 flex-1">
                        <div className="text-sm hover:text-brand-700 truncate font-medium">{u.name}</div>
                        <div className="text-xs text-slate-500 truncate">
                          {u.project_name} · {u.assignee?.display_name ?? "Chưa giao"}
                        </div>
                      </Link>
                      <ProgressBar value={u.progress} className="w-28" />
                      <span className="text-xs text-slate-500">{fmtDate(u.due_date)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {can("tender.view") && data.tenders.length > 0 && (
                <div className="border-slate-100 mt-4 border-t pt-3">
                  <div className="text-xs text-slate-500 mb-2 font-semibold tracking-wide uppercase">
                    Hạn nộp thầu 14 ngày tới
                  </div>
                  {data.tenders.map((t) => (
                    <Link
                      key={t.id}
                      to={`/tenders/${t.id}`}
                      className="text-sm hover:text-brand-700 flex justify-between py-1"
                    >
                      <span className="truncate">
                        {t.code} - {t.name}
                      </span>
                      <span className="text-xs text-slate-500 shrink-0">{fmtDateTime(t.submission_deadline)}</span>
                    </Link>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
