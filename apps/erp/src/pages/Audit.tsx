import { useState } from "react";

import { DataTable, ListFooter, Toolbar, type Column } from "@/components/DataTable";
import { UserSelect } from "@/components/pickers";
import { Badge, Card, Input, Modal, PageHeader, Select } from "@/components/ui";
import { downloadExport } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useList } from "@/lib/hooks";
import { AUDIT_ACTION, ENTITY_LABEL } from "@/lib/labels";
import { useSession } from "@/lib/session";
import type { AuditLog } from "@/lib/types";

function show(v: unknown) {
  if (v === null || v === undefined || v === "") return "∅";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function AuditPage() {
  const { ws } = useSession();
  const list = useList<AuditLog>(
    ws("/audit-logs/"),
    { entity_type: "", action: "", actor: "", date_from: "", date_to: "" },
    30
  );
  const [open, setOpen] = useState<AuditLog | null>(null);
  const columns: Column<AuditLog>[] = [
    {
      key: "time",
      header: "Thời gian",
      render: (l) => <span className="whitespace-nowrap">{fmtDateTime(l.created_at)}</span>,
    },
    { key: "actor", header: "Người thực hiện", render: (l) => l.actor_detail?.display_name ?? "Hệ thống" },
    {
      key: "action",
      header: "Thao tác",
      render: (l) => (
        <Badge tone={l.action === "delete" ? "red" : l.action === "create" ? "green" : "blue"}>
          {AUDIT_ACTION[l.action] ?? l.action}
        </Badge>
      ),
    },
    {
      key: "entity",
      header: "Đối tượng",
      render: (l) => (
        <div className="max-w-80">
          <div className="text-xs text-slate-500">{ENTITY_LABEL[l.entity_type] ?? l.entity_type}</div>
          <div className="truncate">{l.entity_label}</div>
        </div>
      ),
    },
    {
      key: "changes",
      header: "Số trường thay đổi",
      hideOnMobile: true,
      render: (l) => Object.keys(l.changes ?? {}).length || "—",
    },
    { key: "ip", header: "IP", hideOnMobile: true, render: (l) => l.ip_address ?? "—" },
  ];
  return (
    <div>
      <PageHeader
        title="Nhật ký hoạt động"
        subtitle="Lịch sử thao tác không thể sửa / xóa - ai đã làm gì, lúc nào, thay đổi gì"
      />
      <Card bodyClassName="p-0">
        <Toolbar
          q={list.q}
          onQ={list.setQ}
          placeholder="Tìm theo tên đối tượng..."
          onExport={() => downloadExport(ws("/audit-logs/"), list.query)}
        >
          <Select
            className="w-full sm:w-44"
            placeholder="Mọi đối tượng"
            options={Object.entries(ENTITY_LABEL).map(([value, label]) => ({ value, label }))}
            value={String(list.filters.entity_type ?? "")}
            onChange={(e) => list.setFilter("entity_type", e.target.value)}
          />
          <Select
            className="w-full sm:w-40"
            placeholder="Mọi thao tác"
            options={Object.entries(AUDIT_ACTION).map(([value, label]) => ({ value, label }))}
            value={String(list.filters.action ?? "")}
            onChange={(e) => list.setFilter("action", e.target.value)}
          />
          <UserSelect
            className="w-full sm:w-48"
            placeholder="Mọi người dùng"
            value={String(list.filters.actor ?? "")}
            onChange={(e) => list.setFilter("actor", e.target.value)}
          />
          <Input
            type="date"
            className="w-full sm:w-40"
            value={String(list.filters.date_from ?? "")}
            onChange={(e) => list.setFilter("date_from", e.target.value)}
            title="Từ ngày"
          />
          <Input
            type="date"
            className="w-full sm:w-40"
            value={String(list.filters.date_to ?? "")}
            onChange={(e) => list.setFilter("date_to", e.target.value)}
            title="Đến ngày"
          />
        </Toolbar>
        <DataTable
          columns={columns}
          rows={list.data?.results}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          onRowClick={setOpen}
        />
        <ListFooter data={list.data} setPage={list.setPage} />
      </Card>
      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title="Chi tiết thay đổi" size="lg">
        {open && (
          <div className="text-sm space-y-3">
            <p>
              {fmtDateTime(open.created_at)} · <strong>{open.actor_detail?.display_name ?? "Hệ thống"}</strong> ·{" "}
              {AUDIT_ACTION[open.action] ?? open.action} · {ENTITY_LABEL[open.entity_type] ?? open.entity_type}:{" "}
              {open.entity_label}
            </p>
            {Object.keys(open.changes ?? {}).length === 0 ? (
              <p className="text-slate-500">Không có chi tiết trường.</p>
            ) : (
              <table className="cx-table w-full">
                <thead>
                  <tr>
                    <th>Trường</th>
                    <th>Giá trị cũ</th>
                    <th>Giá trị mới</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(open.changes).map(([k, v]) => {
                    const ch = (
                      v && typeof v === "object" && ("old" in (v as object) || "new" in (v as object)) ? v : { new: v }
                    ) as { old?: unknown; new?: unknown };
                    return (
                      <tr key={k}>
                        <td className="font-mono text-xs">{k}</td>
                        <td className="text-red-700">{show(ch.old)}</td>
                        <td className="text-emerald-700">{show(ch.new)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
