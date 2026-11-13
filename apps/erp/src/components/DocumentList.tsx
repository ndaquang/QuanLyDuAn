import { CheckCircle2, Lock, Plus, Send, Trash2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { api, downloadExport } from "@/lib/api";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useList } from "@/lib/hooks";
import { DOCUMENT_CATEGORY, REVIEW_STATUS, labelOf, toneOf } from "@/lib/labels";
import { useSession } from "@/lib/session";
import type { DocumentItem } from "@/lib/types";

import { Attachments } from "./Attachments";
import { DataTable, ListFooter, Toolbar, type Column } from "./DataTable";
import { clean, useForm } from "./form";
import { ProjectSelect } from "./pickers";
import { Badge, Button, Card, Field, Input, Modal, Select, Textarea, useAction, useUi } from "./ui";

function DocumentModal({
  doc,
  projectId,
  tenderId,
  onClose,
  onSaved,
}: {
  doc: DocumentItem | null;
  projectId?: string;
  tenderId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { ws, can, user } = useSession();
  const { confirm } = useUi();
  const { run } = useAction();
  const [current, setCurrent] = useState(doc);
  const locked = current ? current.status === "submitted" || current.status === "approved" : false;
  const editable = !locked && (current ? can("document.update") : can("document.create"));
  const form = useForm({
    project: doc?.project ?? projectId ?? "",
    tender: doc?.tender ?? tenderId ?? "",
    category: doc?.category ?? (tenderId ? "bid" : "drawing"),
    code: doc?.code ?? "",
    title: doc?.title ?? "",
    version: doc?.version ?? "1",
    description: doc?.description ?? "",
  });
  const { bind, errors } = form;

  const save = async () => {
    const res = await form.submit(
      (v) =>
        current
          ? api.patch<DocumentItem>(ws(`/documents/${current.id}/`), clean(v))
          : api.post<DocumentItem>(ws("/documents/"), clean(v)),
      "Đã lưu hồ sơ"
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
        title: verb === "approve" ? "Duyệt / nghiệm thu hồ sơ" : "Trả lại hồ sơ",
        message: verb === "approve" ? "Hồ sơ đã duyệt sẽ bị khóa. Muốn thay đổi phải tạo phiên bản mới." : undefined,
        input: { label: verb === "approve" ? "Ý kiến" : "Lý do trả lại", required: verb === "reject" },
        confirmText: verb === "approve" ? "Duyệt" : "Trả lại",
        danger: verb === "reject",
      });
      if (!r.ok) return;
      comment = r.value;
    }
    const res = await run(
      () => api.post<DocumentItem>(ws(`/documents/${current.id}/${verb}/`), { comment }),
      "Đã cập nhật trạng thái hồ sơ"
    );
    if (res) {
      setCurrent(res);
      onSaved();
    }
  };
  const remove = async () => {
    if (!current) return;
    const { ok } = await confirm({ title: "Xóa hồ sơ?", message: current.title, danger: true, confirmText: "Xóa" });
    if (ok && (await run(() => api.del(ws(`/documents/${current.id}/`)), "Đã xóa hồ sơ")) !== undefined) {
      onSaved();
      onClose();
    }
  };
  const canReview =
    current?.status === "submitted" && can("document.approve") && current.created_by_detail?.id !== user?.id;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={current ? current.title : "Thêm hồ sơ / tài liệu"}
      footer={
        <>
          {current && editable && can("document.delete") && (
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
              Gửi duyệt / nghiệm thu
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
              <Lock className="size-3" /> Đã khóa
            </span>
          )}
          <span className="text-xs text-slate-500">
            Lập bởi {current.created_by_detail?.display_name} · {fmtDateTime(current.created_at)}
          </span>
          {current.reviewed_by_detail && (
            <span className="text-xs text-slate-500">
              · Duyệt: {current.reviewed_by_detail.display_name}
              {current.review_comment && ` — "${current.review_comment}"`}
            </span>
          )}
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Tên hồ sơ" required className="md:col-span-2" error={errors.title}>
          <Input disabled={!editable} {...bind("title")} />
        </Field>
        <Field label="Mã hồ sơ / số hiệu" error={errors.code}>
          <Input disabled={!editable} {...bind("code")} />
        </Field>
        <Field label="Phiên bản" error={errors.version}>
          <Input disabled={!editable} {...bind("version")} />
        </Field>
        <Field label="Loại hồ sơ" error={errors.category}>
          <Select disabled={!editable} options={DOCUMENT_CATEGORY} {...bind("category")} />
        </Field>
        {!tenderId && (
          <Field label="Dự án" error={errors.project}>
            <ProjectSelect
              disabled={!editable || Boolean(projectId)}
              placeholder="— Hồ sơ chung công ty —"
              {...bind("project")}
            />
          </Field>
        )}
        <Field label="Mô tả" className="md:col-span-2" error={errors.description}>
          <Textarea disabled={!editable} {...bind("description")} />
        </Field>
      </div>
      {current ? (
        <div className="mt-4">
          <div className="text-sm text-slate-700 mb-2 font-medium">Tệp hồ sơ</div>
          <Attachments entityType="document" entityId={current.id} canUpload={editable} onChange={onSaved} />
        </div>
      ) : (
        <p className="text-xs text-slate-500 mt-4">Lưu thông tin hồ sơ trước, sau đó tải tệp lên.</p>
      )}
    </Modal>
  );
}

export function DocumentList({
  projectId,
  tenderId,
  openId,
}: {
  projectId?: string;
  tenderId?: string;
  openId?: string | null;
}) {
  const { ws, can } = useSession();
  const list = useList<DocumentItem>(ws("/documents/"), {
    project: projectId ?? "",
    tender: tenderId ?? "",
    category: "",
    status: "",
  });
  const [open, setOpen] = useState<{ doc: DocumentItem | null } | null>(null);
  useEffect(() => {
    if (openId)
      void api
        .get<DocumentItem>(ws(`/documents/${openId}/`))
        .then((d) => setOpen({ doc: d }))
        .catch(() => undefined);
  }, [openId, ws]);
  const columns: Column<DocumentItem>[] = [
    { key: "code", header: "Số hiệu", hideOnMobile: true, render: (d) => d.code || "—" },
    {
      key: "title",
      header: "Tên hồ sơ",
      render: (d) => (
        <div className="max-w-80">
          <div className="truncate font-medium">{d.title}</div>
          {!projectId && !tenderId && (
            <div className="text-xs text-slate-500 truncate">{d.project_name ?? d.tender_name ?? "Hồ sơ chung"}</div>
          )}
        </div>
      ),
    },
    { key: "category", header: "Loại", render: (d) => labelOf(DOCUMENT_CATEGORY, d.category) },
    { key: "version", header: "Phiên bản", hideOnMobile: true, render: (d) => `v${d.version}` },
    { key: "files", header: "Tệp", hideOnMobile: true, render: (d) => d.attachment_count },
    { key: "date", header: "Ngày lập", hideOnMobile: true, render: (d) => fmtDate(d.created_at.slice(0, 10)) },
    {
      key: "status",
      header: "Trạng thái",
      render: (d) => <Badge tone={toneOf(REVIEW_STATUS, d.status)}>{labelOf(REVIEW_STATUS, d.status)}</Badge>,
    },
  ];
  return (
    <Card bodyClassName="p-0">
      <Toolbar
        q={list.q}
        onQ={list.setQ}
        placeholder="Tìm hồ sơ..."
        onExport={() => downloadExport(ws("/documents/"), list.query)}
        right={
          can("document.create") && (
            <Button icon={<Plus className="size-4" />} onClick={() => setOpen({ doc: null })}>
              Thêm hồ sơ
            </Button>
          )
        }
      >
        {!projectId && !tenderId && (
          <ProjectSelect
            className="w-full sm:w-56"
            placeholder="Mọi dự án"
            value={String(list.filters.project ?? "")}
            onChange={(e) => list.setFilter("project", e.target.value)}
          />
        )}
        <Select
          className="w-full sm:w-44"
          placeholder="Mọi loại hồ sơ"
          options={DOCUMENT_CATEGORY}
          value={String(list.filters.category ?? "")}
          onChange={(e) => list.setFilter("category", e.target.value)}
        />
        <Select
          className="w-full sm:w-36"
          placeholder="Mọi trạng thái"
          options={REVIEW_STATUS}
          value={String(list.filters.status ?? "")}
          onChange={(e) => list.setFilter("status", e.target.value)}
        />
      </Toolbar>
      <DataTable
        columns={columns}
        rows={list.data?.results}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        onRowClick={(d) => setOpen({ doc: d })}
        empty="Chưa có hồ sơ."
      />
      <ListFooter data={list.data} setPage={list.setPage} />
      {open && (
        <DocumentModal
          doc={open.doc}
          projectId={projectId}
          tenderId={tenderId}
          onClose={() => setOpen(null)}
          onSaved={() => void list.reload()}
        />
      )}
    </Card>
  );
}
