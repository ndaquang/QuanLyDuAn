import { clsx } from "clsx";
import { FileSpreadsheet, Search } from "lucide-react";
import type { ReactNode } from "react";

import type { Page } from "@/lib/api";

import { Button, Empty, ErrorBox, Input, Pagination, Spinner } from "./ui";

export interface Column<T> {
  key: string;
  header: ReactNode;
  render?: (row: T) => ReactNode;
  className?: string;
  /** hide on small screens */
  hideOnMobile?: boolean;
}

export function DataTable<T extends { id: string }>({
  columns,
  rows,
  loading,
  error,
  onRetry,
  onRowClick,
  empty,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
}) {
  if (error)
    return (
      <div className="p-3">
        <ErrorBox message={error} onRetry={onRetry} />
      </div>
    );
  if (loading && !rows) return <Spinner />;
  if (!rows || rows.length === 0) return <Empty>{empty ?? "Chưa có dữ liệu"}</Empty>;
  return (
    <div className="print-full overflow-x-auto">
      <table className={clsx("cx-table w-full", loading && "opacity-60")}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={clsx(c.className, c.hideOnMobile && "hidden md:table-cell")}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={clsx(onRowClick && "hover:bg-brand-50/60 cursor-pointer")}
            >
              {columns.map((c) => (
                <td key={c.key} className={clsx(c.className, c.hideOnMobile && "hidden md:table-cell")}>
                  {c.render ? c.render(row) : String((row as unknown as Record<string, unknown>)[c.key] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Search box + filters + export button above a table. */
export function Toolbar({
  q,
  onQ,
  placeholder = "Tìm kiếm...",
  children,
  onExport,
  right,
}: {
  q?: string;
  onQ?: (v: string) => void;
  placeholder?: string;
  children?: ReactNode;
  onExport?: () => void;
  right?: ReactNode;
}) {
  return (
    <div className="no-print border-slate-100 flex flex-wrap items-center gap-2 border-b p-3">
      {onQ && (
        <div className="relative w-full sm:w-64">
          <Search className="text-slate-400 pointer-events-none absolute top-2.5 left-2.5 size-4" />
          <Input value={q} onChange={(e) => onQ(e.target.value)} placeholder={placeholder} className="pl-8" />
        </div>
      )}
      {children}
      <div className="ml-auto flex flex-wrap gap-2">
        {right}
        {onExport && (
          <Button variant="secondary" icon={<FileSpreadsheet className="text-emerald-600 size-4" />} onClick={onExport}>
            Xuất Excel
          </Button>
        )}
      </div>
    </div>
  );
}

export function ListFooter<T>({ data, setPage }: { data: Page<T> | null; setPage: (p: number) => void }) {
  if (!data) return null;
  return <Pagination page={data.page} totalPages={data.total_pages} count={data.count} onChange={setPage} />;
}
