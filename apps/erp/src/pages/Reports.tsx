import { FileSpreadsheet, Printer } from "lucide-react";
import { useSearchParams } from "react-router";

import { DepartmentSelect, ProjectSelect } from "@/components/pickers";
import { Button, Card, Empty, ErrorBox, Field, Input, PageHeader, Select, Spinner, Tabs } from "@/components/ui";
import { downloadExport } from "@/lib/api";
import { fmtDate, fmtMoney } from "@/lib/format";
import { useFetch } from "@/lib/hooks";
import { SCHEDULE_LEVEL } from "@/lib/labels";
import { useSession } from "@/lib/session";

interface Report {
  title: string;
  columns: { label: string; key: string }[];
  rows: Record<string, unknown>[];
  meta: Record<string, string | null>;
}

const REPORTS = [
  { value: "project-summary", label: "Tổng hợp dự án" },
  { value: "progress", label: "Tiến độ thi công" },
  { value: "hr-efficiency", label: "Hiệu quả nhân sự" },
];

const MONEY_KEYS = new Set(["contract_value"]);
const PERCENT_KEYS = new Set(["planned", "actual", "variance", "completion_rate", "on_time_rate"]);

function cell(key: string, value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (MONEY_KEYS.has(key)) return fmtMoney(value as string);
  if (PERCENT_KEYS.has(key)) return `${Number(value).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return fmtDate(value);
  return String(value);
}

function metaText(meta: Record<string, string | null>) {
  return Object.entries(meta)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${fmtDate(String(v))}`)
    .join(" · ");
}

export function ReportsPage() {
  const { ws, can, workspace } = useSession();
  const [params, setParams] = useSearchParams();
  const report = params.get("report") ?? "project-summary";
  const filters = {
    project: params.get("project") ?? "",
    department: params.get("department") ?? "",
    date_from: params.get("date_from") ?? "",
    date_to: params.get("date_to") ?? "",
    as_of: params.get("as_of") ?? "",
    level: params.get("level") ?? "",
  };
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const allowedHr = can("employee.view");
  const { data, error, loading, reload } = useFetch<Report>(
    report === "hr-efficiency" && !allowedHr ? null : ws(`/reports/${report}/`),
    filters
  );

  return (
    <div>
      <PageHeader
        title="Báo cáo quản trị"
        subtitle="Tính trực tiếp từ dữ liệu tiến độ, công việc, nhật ký và giờ công"
        actions={
          <>
            <Button
              variant="secondary"
              icon={<FileSpreadsheet className="text-emerald-600 size-4" />}
              onClick={() => downloadExport(ws(`/reports/${report}/`), filters)}
            >
              Xuất Excel
            </Button>
            <Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => window.print()}>
              In / Lưu PDF
            </Button>
          </>
        }
      />
      <Tabs value={report} onChange={(v) => set("report", v)} tabs={REPORTS} />
      <div className="no-print border-slate-200 mb-4 grid grid-cols-2 gap-3 rounded-lg border bg-white p-3 md:grid-cols-4">
        <Field label="Dự án">
          <ProjectSelect
            placeholder="Tất cả dự án"
            value={filters.project}
            onChange={(e) => set("project", e.target.value)}
          />
        </Field>
        {report !== "progress" && (
          <Field label="Phòng ban">
            <DepartmentSelect
              placeholder="Tất cả"
              value={filters.department}
              onChange={(e) => set("department", e.target.value)}
            />
          </Field>
        )}
        {report === "progress" ? (
          <>
            <Field label="Tính đến ngày">
              <Input type="date" value={filters.as_of} onChange={(e) => set("as_of", e.target.value)} />
            </Field>
            <Field label="Cấp">
              <Select
                placeholder="Tất cả cấp"
                options={SCHEDULE_LEVEL}
                value={filters.level}
                onChange={(e) => set("level", e.target.value)}
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="Từ ngày">
              <Input type="date" value={filters.date_from} onChange={(e) => set("date_from", e.target.value)} />
            </Field>
            <Field label="Đến ngày">
              <Input type="date" value={filters.date_to} onChange={(e) => set("date_to", e.target.value)} />
            </Field>
          </>
        )}
      </div>
      {report === "hr-efficiency" && !allowedHr ? (
        <ErrorBox message="Báo cáo nhân sự cần quyền xem nhân sự." />
      ) : error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : loading && !data ? (
        <Spinner />
      ) : data ? (
        <Card
          title={
            <span>
              {data.title}{" "}
              <span className="font-normal text-slate-500">
                · {workspace?.name} · {metaText(data.meta)}
              </span>
            </span>
          }
          bodyClassName="p-0"
        >
          {data.rows.length === 0 ? (
            <Empty>Không có dữ liệu cho bộ lọc này.</Empty>
          ) : (
            <div className="print-full overflow-x-auto">
              <table className="cx-table w-full">
                <thead>
                  <tr>
                    {data.columns.map((c) => (
                      <th key={c.key}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r, i) => (
                    // oxlint-disable-next-line react/no-array-index-key -- read-only report rows, never reordered
                    <tr key={i}>
                      {data.columns.map((c) => (
                        <td
                          key={c.key}
                          className={
                            typeof r[c.key] === "number" || MONEY_KEYS.has(c.key)
                              ? "text-right whitespace-nowrap tabular-nums"
                              : ""
                          }
                        >
                          {c.key === "behind" ? (
                            <span className={r[c.key] === "Chậm" ? "text-red-600 font-medium" : "text-emerald-700"}>
                              {String(r[c.key])}
                            </span>
                          ) : (
                            cell(c.key, r[c.key])
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}
    </div>
  );
}
