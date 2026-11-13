import { CheckCircle2, Lock, Plus, Send, Trash2, XCircle } from "lucide-react";
import { useState } from "react";

import { api, downloadExport } from "@/lib/api";
import { fmtDate, todayISO } from "@/lib/format";
import { useList } from "@/lib/hooks";
import { REVIEW_STATUS, WEATHER, labelOf, toneOf } from "@/lib/labels";
import { useSession } from "@/lib/session";
import type { DailyReport } from "@/lib/types";

import { Attachments } from "./Attachments";
import { DataTable, ListFooter, Toolbar, type Column } from "./DataTable";
import { useForm } from "./form";
import { Badge, Button, Card, Field, Input, Modal, Select, Textarea, useAction, useUi } from "./ui";

function ReportModal({
  projectId,
  report,
  onClose,
  onSaved,
}: {
  projectId: string;
  report: DailyReport | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { ws, can, user } = useSession();
  const { confirm } = useUi();
  const { run } = useAction();
  const locked = report ? report.status === "submitted" || report.status === "approved" : false;
  const editable = !locked && (report ? can("daily_report.update") : can("daily_report.create"));
  const form = useForm({
    project: projectId,
    report_date: report?.report_date ?? todayISO(),
    weather: report?.weather ?? "sunny",
    manpower_count: String(report?.manpower_count ?? 0),
    equipment: report?.equipment ?? "",
    work_performed: report?.work_performed ?? "",
    issues: report?.issues ?? "",
    hse_notes: report?.hse_notes ?? "",
    next_plan: report?.next_plan ?? "",
  });
  const { bind, errors } = form;
  const [current, setCurrent] = useState(report);

  const save = async () => {
    const res = await form.submit(
      (v) =>
        current
          ? api.patch<DailyReport>(ws(`/daily-reports/${current.id}/`), v)
          : api.post<DailyReport>(ws("/daily-reports/"), v),
      "Đã lưu nhật ký"
    );
    if (res) {
      setCurrent(res);
      onSaved();
    }
  };
  const act = async (verb: "submit" | "approve" | "reject") => {
    if (!current) return;
    let comment = "";
    if (verb !== "submit") {
      const r = await confirm({
        title: verb === "approve" ? "Duyệt nhật ký công trường" : "Trả lại nhật ký",
        message: verb === "approve" ? "Sau khi duyệt, nhật ký sẽ bị khóa, không thể sửa hoặc xóa." : undefined,
        input: { label: verb === "approve" ? "Ý kiến (không bắt buộc)" : "Lý do trả lại", required: verb === "reject" },
        confirmText: verb === "approve" ? "Duyệt" : "Trả lại",
        danger: verb === "reject",
      });
      if (!r.ok) return;
      comment = r.value;
    }
    const res = await run(
      () => api.post<DailyReport>(ws(`/daily-reports/${current.id}/${verb}/`), { comment }),
      verb === "submit" ? "Đã gửi duyệt" : verb === "approve" ? "Đã duyệt nhật ký" : "Đã trả lại nhật ký"
    );
    if (res) {
      setCurrent(res);
      onSaved();
    }
  };
  const remove = async () => {
    if (!current) return;
    const { ok } = await confirm({
      title: "Xóa nhật ký?",
      message: `Nhật ký ngày ${fmtDate(current.report_date)} sẽ bị xóa.`,
      danger: true,
      confirmText: "Xóa",
    });
    if (ok && (await run(() => api.del(ws(`/daily-reports/${current.id}/`)), "Đã xóa")) !== undefined) {
      onSaved();
      onClose();
    }
  };

  const canReview =
    current?.status === "submitted" && can("daily_report.approve") && current.created_by_detail?.id !== user?.id;
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={current ? `Nhật ký công trường ngày ${fmtDate(current.report_date)}` : "Lập nhật ký công trường"}
      footer={
        <>
          {current && editable && can("daily_report.delete") && (
            <Button
              variant="danger"
              className="mr-auto"
              icon={<Trash2 className="size-4" />}
              onClick={() => void remove()}
            >
              Xóa
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Đóng
          </Button>
          {editable && (
            <Button loading={form.saving} onClick={() => void save()}>
              Lưu
            </Button>
          )}
          {current && editable && (
            <Button variant="secondary" icon={<Send className="size-4" />} onClick={() => void act("submit")}>
              Gửi duyệt
            </Button>
          )}
          {canReview && (
            <Button variant="danger" icon={<XCircle className="size-4" />} onClick={() => void act("reject")}>
              Trả lại
            </Button>
          )}
          {canReview && (
            <Button variant="success" icon={<CheckCircle2 className="size-4" />} onClick={() => void act("approve")}>
              Duyệt
            </Button>
          )}
        </>
      }
    >
      {current && (
        <div className="text-sm mb-4 flex flex-wrap items-center gap-2">
          <Badge tone={toneOf(REVIEW_STATUS, current.status)}>{labelOf(REVIEW_STATUS, current.status)}</Badge>
          {locked && (
            <span className="text-xs text-slate-500 inline-flex items-center gap-1">
              <Lock className="size-3" /> Đã khóa chỉnh sửa
            </span>
          )}
          {current.reviewed_by_detail && (
            <span className="text-xs text-slate-500">
              Người duyệt: {current.reviewed_by_detail.display_name}
              {current.review_comment && ` — "${current.review_comment}"`}
            </span>
          )}
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Ngày" required error={errors.report_date}>
          <Input type="date" disabled={!editable} max={todayISO()} {...bind("report_date")} />
        </Field>
        <Field label="Thời tiết" error={errors.weather}>
          <Select disabled={!editable} options={WEATHER} {...bind("weather")} />
        </Field>
        <Field label="Nhân lực (người)" error={errors.manpower_count}>
          <Input type="number" min={0} disabled={!editable} {...bind("manpower_count")} />
        </Field>
        <Field label="Công việc thực hiện trong ngày" required className="md:col-span-3" error={errors.work_performed}>
          <Textarea rows={4} disabled={!editable} {...bind("work_performed")} />
        </Field>
        <Field label="Máy móc, thiết bị" className="md:col-span-3" error={errors.equipment}>
          <Textarea rows={2} disabled={!editable} {...bind("equipment")} />
        </Field>
        <Field label="Vướng mắc, sự cố" className="md:col-span-3" error={errors.issues}>
          <Textarea rows={2} disabled={!editable} {...bind("issues")} />
        </Field>
        <Field label="An toàn lao động - môi trường" className="md:col-span-3" error={errors.hse_notes}>
          <Textarea rows={2} disabled={!editable} {...bind("hse_notes")} />
        </Field>
        <Field label="Kế hoạch ngày tiếp theo" className="md:col-span-3" error={errors.next_plan}>
          <Textarea rows={2} disabled={!editable} {...bind("next_plan")} />
        </Field>
      </div>
      {current ? (
        <div className="mt-4">
          <div className="text-sm text-slate-700 mb-2 font-medium">Ảnh hiện trường / tệp đính kèm</div>
          <Attachments entityType="daily_report" entityId={current.id} canUpload={editable} onChange={onSaved} />
        </div>
      ) : (
        <p className="text-xs text-slate-500 mt-4">Lưu nhật ký trước, sau đó có thể chụp / tải ảnh hiện trường.</p>
      )}
    </Modal>
  );
}

export function DailyReports({ projectId }: { projectId: string }) {
  const { ws, can } = useSession();
  const list = useList<DailyReport>(ws("/daily-reports/"), {
    project: projectId,
    status: "",
    date_from: "",
    date_to: "",
  });
  const [open, setOpen] = useState<{ report: DailyReport | null } | null>(null);
  const columns: Column<DailyReport>[] = [
    { key: "date", header: "Ngày", render: (r) => <span className="font-medium">{fmtDate(r.report_date)}</span> },
    { key: "weather", header: "Thời tiết", hideOnMobile: true, render: (r) => labelOf(WEATHER, r.weather) },
    { key: "manpower", header: "Nhân lực", hideOnMobile: true, render: (r) => `${r.manpower_count} người` },
    {
      key: "work",
      header: "Công việc",
      render: (r) => <span className="line-clamp-2 max-w-96">{r.work_performed}</span>,
    },
    { key: "files", header: "Ảnh", hideOnMobile: true, render: (r) => r.attachment_count || "—" },
    { key: "by", header: "Người lập", hideOnMobile: true, render: (r) => r.created_by_detail?.display_name ?? "—" },
    {
      key: "status",
      header: "Trạng thái",
      render: (r) => <Badge tone={toneOf(REVIEW_STATUS, r.status)}>{labelOf(REVIEW_STATUS, r.status)}</Badge>,
    },
  ];
  return (
    <Card bodyClassName="p-0">
      <Toolbar
        onExport={() => downloadExport(ws("/daily-reports/"), list.query)}
        right={
          can("daily_report.create") && (
            <Button icon={<Plus className="size-4" />} onClick={() => setOpen({ report: null })}>
              Lập nhật ký
            </Button>
          )
        }
      >
        <Select
          className="w-full sm:w-40"
          placeholder="Mọi trạng thái"
          options={REVIEW_STATUS}
          value={String(list.filters.status ?? "")}
          onChange={(e) => list.setFilter("status", e.target.value)}
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
        onRowClick={(r) => setOpen({ report: r })}
        empty="Chưa có nhật ký công trường."
      />
      <ListFooter data={list.data} setPage={list.setPage} />
      {open && (
        <ReportModal
          projectId={projectId}
          report={open.report}
          onClose={() => setOpen(null)}
          onSaved={() => void list.reload()}
        />
      )}
    </Card>
  );
}
