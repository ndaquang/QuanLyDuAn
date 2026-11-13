import { Plus, Send, Trash2, Wand2 } from "lucide-react";
import { useState } from "react";

import { api, downloadExport, type Page } from "@/lib/api";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useFetch, useList } from "@/lib/hooks";
import { PRIORITY, TENDER_ITEM_CATEGORY, TENDER_ITEM_STATUS, labelOf, toneOf } from "@/lib/labels";
import { useSession } from "@/lib/session";
import type { Tender, TenderComment, TenderItem } from "@/lib/types";

import { Attachments } from "./Attachments";
import { DataTable, ListFooter, Toolbar, type Column } from "./DataTable";
import { clean, useForm } from "./form";
import { UserSelect } from "./pickers";
import { Badge, Button, Card, Field, Input, Modal, ProgressBar, Select, Tabs, Textarea, useAction, useUi } from "./ui";

const PRIORITIES = PRIORITY.filter((p) => p.value !== "none");

/** Create / view / update one tender task: assignee, due date, priority, status, comments, files. */
export function TenderTaskModal({
  item,
  tender,
  onClose,
  onSaved,
}: {
  item: TenderItem | null;
  tender: Pick<Tender, "id" | "code" | "name" | "is_locked" | "submission_deadline">;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { ws, can, user } = useSession();
  const { confirm } = useUi();
  const { run, busy } = useAction();
  const [current, setCurrent] = useState(item);
  const [tab, setTab] = useState("info");
  const [comment, setComment] = useState("");
  const comments = useFetch<TenderComment[]>(current ? ws(`/tender-items/${current.id}/comments/`) : null);

  const isAssignee = current?.assignee === user?.id;
  const canEdit = !tender.is_locked && (current ? can("tender.update") : can("tender.create"));
  const canReport = !tender.is_locked && (canEdit || isAssignee);
  const form = useForm({
    tender: tender.id,
    name: item?.name ?? "",
    description: item?.description ?? "",
    category: item?.category ?? "technical",
    priority: item?.priority ?? "medium",
    assignee: item?.assignee ?? "",
    due_date: item?.due_date ?? "",
    status: item?.status ?? "todo",
    note: item?.note ?? "",
  });
  const { bind, errors } = form;

  const save = async () => {
    const payload = canEdit ? clean(form.values) : { status: form.values.status, note: form.values.note };
    const res = await form.submit(
      () =>
        current
          ? api.patch<TenderItem>(ws(`/tender-items/${current.id}/`), payload)
          : api.post<TenderItem>(ws("/tender-items/"), payload),
      current ? "Đã cập nhật công việc" : "Đã giao việc"
    );
    if (res) {
      setCurrent(res);
      onSaved();
      if (!item) onClose();
    }
  };
  const remove = async () => {
    if (!current) return;
    const { ok } = await confirm({
      title: "Xóa công việc?",
      message: current.name,
      danger: true,
      confirmText: "Xóa",
    });
    if (ok && (await run(() => api.del(ws(`/tender-items/${current.id}/`)), "Đã xóa công việc")) !== undefined) {
      onSaved();
      onClose();
    }
  };
  const send = async () => {
    if (!current || !comment.trim()) return;
    const res = await run(() =>
      api.post<TenderComment[]>(ws(`/tender-items/${current.id}/comments/`), { text: comment })
    );
    if (res) {
      comments.setData(res);
      setComment("");
      onSaved();
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={current ? `${tender.code} · ${current.name}` : `Giao việc cho gói thầu ${tender.code}`}
      footer={
        <>
          {current && canEdit && can("tender.delete") && (
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
          {(canEdit || canReport) && (
            <Button loading={form.saving} onClick={() => void save()}>
              {current ? "Lưu" : "Giao việc"}
            </Button>
          )}
        </>
      }
    >
      {current && (
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "info", label: "Thông tin" },
            { value: "comments", label: `Bình luận (${comments.data?.length ?? current.comment_count})` },
            { value: "files", label: `Tệp (${current.attachment_count})` },
          ]}
        />
      )}
      {tender.is_locked && (
        <p className="bg-slate-100 text-sm text-slate-600 mb-3 rounded-md p-2">
          Gói thầu đã đóng, công việc chỉ để xem.
        </p>
      )}
      {tab === "info" && (
        <div className="grid gap-4 md:grid-cols-2">
          {!canEdit && canReport && (
            <p className="bg-brand-50 text-sm text-brand-700 rounded-md p-2 md:col-span-2">
              Bạn là người thực hiện: được cập nhật trạng thái và ghi chú.
            </p>
          )}
          <Field label="Tên công việc" required className="md:col-span-2" error={errors.name}>
            <Input disabled={!canEdit} {...bind("name")} placeholder="VD: Lập biện pháp thi công" />
          </Field>
          <Field label="Người thực hiện" error={errors.assignee}>
            <UserSelect disabled={!canEdit} {...bind("assignee")} />
          </Field>
          <Field
            label="Hạn hoàn thành"
            error={errors.due_date}
            hint={`Không sau hạn nộp thầu (${fmtDateTime(tender.submission_deadline)})`}
          >
            <Input type="date" disabled={!canEdit} {...bind("due_date")} />
          </Field>
          <Field label="Nhóm hồ sơ" error={errors.category}>
            <Select disabled={!canEdit} options={TENDER_ITEM_CATEGORY} {...bind("category")} />
          </Field>
          <Field label="Mức ưu tiên" error={errors.priority}>
            <Select disabled={!canEdit} options={PRIORITIES} {...bind("priority")} />
          </Field>
          <Field label="Trạng thái" error={errors.status}>
            <Select disabled={!canReport} options={TENDER_ITEM_STATUS} {...bind("status")} />
          </Field>
          <Field label="Ghi chú tiến độ" error={errors.note}>
            <Input disabled={!canReport} {...bind("note")} />
          </Field>
          <Field label="Mô tả yêu cầu" className="md:col-span-2" error={errors.description}>
            <Textarea rows={4} disabled={!canEdit} {...bind("description")} />
          </Field>
          {current && (
            <p className="text-xs text-slate-500 md:col-span-2">
              Giao bởi {current.created_by_detail?.display_name ?? "—"} · {fmtDateTime(current.created_at)}
              {current.completed_at && ` · Hoàn thành ${fmtDateTime(current.completed_at)}`}
            </p>
          )}
        </div>
      )}
      {tab === "comments" && current && (
        <div className="space-y-3">
          <ul className="space-y-2">
            {(comments.data ?? []).map((c) => (
              <li key={c.id} className="bg-slate-50 rounded-md p-3">
                <div className="text-xs text-slate-500 mb-1">
                  <strong className="text-slate-700">{c.author?.display_name}</strong> · {fmtDateTime(c.created_at)}
                </div>
                <div className="text-sm whitespace-pre-line">{c.text}</div>
              </li>
            ))}
            {comments.data?.length === 0 && <li className="text-sm text-slate-500">Chưa có bình luận.</li>}
          </ul>
          {!tender.is_locked && (canEdit || isAssignee) && (
            <div className="flex gap-2">
              <Textarea
                rows={2}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Báo cáo tình hình, hỏi lại yêu cầu..."
              />
              <Button
                className="self-end"
                loading={busy}
                disabled={!comment.trim()}
                icon={<Send className="size-4" />}
                onClick={() => void send()}
              >
                Gửi
              </Button>
            </div>
          )}
        </div>
      )}
      {tab === "files" && current && (
        <Attachments entityType="tender_item" entityId={current.id} canUpload={canReport} onChange={onSaved} />
      )}
    </Modal>
  );
}

function columns(showTender: boolean): Column<TenderItem>[] {
  return [
    {
      key: "name",
      header: "Công việc",
      render: (t) => (
        <div className="max-w-80">
          <div className="truncate font-medium">{t.name}</div>
          {showTender && (
            <div className="text-xs text-slate-500 truncate">
              {t.tender_code} · {t.tender_name}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "category",
      header: "Nhóm",
      hideOnMobile: true,
      render: (t) => labelOf(TENDER_ITEM_CATEGORY, t.category),
    },
    {
      key: "assignee",
      header: "Người thực hiện",
      render: (t) => t.assignee_detail?.display_name ?? <span className="text-amber-700">Chưa giao</span>,
    },
    {
      key: "due",
      header: "Hạn",
      render: (t) => (
        <span className={t.is_overdue ? "text-red-600 font-medium" : ""}>
          {fmtDate(t.due_date)}
          {t.is_overdue && " (quá hạn)"}
        </span>
      ),
    },
    {
      key: "priority",
      header: "Ưu tiên",
      hideOnMobile: true,
      render: (t) => <Badge tone={toneOf(PRIORITY, t.priority)}>{labelOf(PRIORITY, t.priority)}</Badge>,
    },
    {
      key: "status",
      header: "Trạng thái",
      render: (t) => <Badge tone={toneOf(TENDER_ITEM_STATUS, t.status)}>{labelOf(TENDER_ITEM_STATUS, t.status)}</Badge>,
    },
    {
      key: "extra",
      header: "",
      hideOnMobile: true,
      render: (t) => (
        <span className="text-xs text-slate-400">
          {t.comment_count > 0 && `💬 ${t.comment_count} `}
          {t.attachment_count > 0 && `📎 ${t.attachment_count}`}
        </span>
      ),
    },
  ];
}

/** Tasks of one tender: assign, track, apply the standard dossier template. */
export function TenderTasksPanel({
  tender,
  onChanged,
  focusItem,
}: {
  tender: Tender;
  onChanged: () => void;
  focusItem?: string | null;
}) {
  const { ws, can } = useSession();
  const { run, busy } = useAction();
  const list = useList<TenderItem>(
    ws("/tender-items/"),
    { tender: tender.id, status: "", priority: "", assignee: "" },
    50
  );
  const [open, setOpen] = useState<{ item: TenderItem | null } | null>(null);
  const focus = useFetch<TenderItem>(focusItem ? ws(`/tender-items/${focusItem}/`) : null);
  const [focusDone, setFocusDone] = useState(false);
  const refresh = () => {
    void list.reload();
    onChanged();
  };
  const canManage = !tender.is_locked && can("tender.update");

  return (
    <Card bodyClassName="p-0">
      <Toolbar
        q={list.q}
        onQ={list.setQ}
        placeholder="Tìm công việc..."
        onExport={() => downloadExport(ws("/tender-items/"), { tender: tender.id })}
        right={
          <>
            {canManage && (
              <Button
                variant="secondary"
                loading={busy}
                icon={<Wand2 className="size-4" />}
                onClick={async () => {
                  const res = await run(() => api.post<TenderItem[]>(ws(`/tenders/${tender.id}/apply-template/`)));
                  if (res) {
                    refresh();
                  }
                }}
              >
                Tạo danh sách việc mẫu
              </Button>
            )}
            {!tender.is_locked && can("tender.create") && (
              <Button icon={<Plus className="size-4" />} onClick={() => setOpen({ item: null })}>
                Giao việc
              </Button>
            )}
          </>
        }
      >
        <Select
          className="w-full sm:w-40"
          placeholder="Mọi trạng thái"
          options={TENDER_ITEM_STATUS}
          value={String(list.filters.status ?? "")}
          onChange={(e) => list.setFilter("status", e.target.value)}
        />
        <Select
          className="w-full sm:w-36"
          placeholder="Mọi ưu tiên"
          options={PRIORITIES}
          value={String(list.filters.priority ?? "")}
          onChange={(e) => list.setFilter("priority", e.target.value)}
        />
        <UserSelect
          className="w-full sm:w-48"
          placeholder="Mọi người thực hiện"
          value={String(list.filters.assignee ?? "")}
          onChange={(e) => list.setFilter("assignee", e.target.value)}
        />
      </Toolbar>
      <div className="border-slate-100 border-b px-4 py-3">
        <div className="text-sm mb-1 flex justify-between">
          <span>
            Hoàn thành <strong>{tender.checklist.done}</strong>/{tender.checklist.total} công việc
          </span>
          {tender.checklist.overdue > 0 && (
            <span className="text-red-600 font-medium">{tender.checklist.overdue} việc quá hạn</span>
          )}
        </div>
        <ProgressBar value={tender.checklist.percent} />
      </div>
      <DataTable
        columns={columns(false)}
        rows={list.data?.results}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        onRowClick={(t) => setOpen({ item: t })}
        empty="Chưa có công việc. Bấm 'Tạo danh sách việc mẫu' để lập sẵn các đầu việc chuẩn của một HSDT rồi giao cho từng người."
      />
      <ListFooter data={list.data} setPage={list.setPage} />
      {open && <TenderTaskModal tender={tender} item={open.item} onClose={() => setOpen(null)} onSaved={refresh} />}
      {focus.data && !focusDone && !open && (
        <TenderTaskModal tender={tender} item={focus.data} onClose={() => setFocusDone(true)} onSaved={refresh} />
      )}
    </Card>
  );
}

const scopeFilters = (s: string) => ({
  assignee: s === "mine" ? "me" : "",
  created_by: s === "created" ? "me" : "",
});

/** Tasks across all open tenders (my tasks / assigned by me / all). */
export function TenderTaskBoard() {
  const { ws } = useSession();
  const [scope, setScopeState] = useState("mine");
  const list = useList<TenderItem>(
    ws("/tender-items/"),
    { status: "", priority: "", tender: "", overdue: "", open_tenders: "true", ...scopeFilters("mine") },
    25
  );
  const tenders = useFetch<Page<Tender>>(ws("/tenders/"), { open: "true", page_size: 200 });
  const [open, setOpen] = useState<TenderItem | null>(null);
  const tender = open ? tenders.data?.results.find((t) => t.id === open.tender) : null;
  const detail = useFetch<Tender>(open && !tender ? ws(`/tenders/${open.tender}/`) : null);
  const setScope = (s: string) => {
    setScopeState(s);
    list.setFilters((f) => ({ ...f, ...scopeFilters(s) }));
  };
  const active = tender ?? detail.data;
  return (
    <Card bodyClassName="p-0">
      <div className="px-3 pt-2">
        <Tabs
          value={scope}
          onChange={setScope}
          tabs={[
            { value: "mine", label: "Việc của tôi" },
            { value: "created", label: "Tôi đã giao" },
            { value: "all", label: "Tất cả" },
          ]}
        />
      </div>
      <Toolbar
        q={list.q}
        onQ={list.setQ}
        placeholder="Tìm công việc, gói thầu..."
        onExport={() => downloadExport(ws("/tender-items/"), list.query)}
      >
        <Select
          className="w-full sm:w-56"
          placeholder="Mọi gói thầu đang mở"
          options={(tenders.data?.results ?? []).map((t) => ({ value: t.id, label: `${t.code} - ${t.name}` }))}
          value={String(list.filters.tender ?? "")}
          onChange={(e) => list.setFilter("tender", e.target.value)}
        />
        <Select
          className="w-full sm:w-40"
          placeholder="Mọi trạng thái"
          options={TENDER_ITEM_STATUS}
          value={String(list.filters.status ?? "")}
          onChange={(e) => list.setFilter("status", e.target.value)}
        />
        <label className="text-sm text-slate-600 flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={list.filters.overdue === "true"}
            onChange={(e) => list.setFilter("overdue", e.target.checked ? "true" : "")}
          />{" "}
          Chỉ quá hạn
        </label>
      </Toolbar>
      <DataTable
        columns={columns(true)}
        rows={list.data?.results}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        onRowClick={setOpen}
        empty={scope === "mine" ? "Bạn chưa được giao việc đấu thầu nào." : "Không có công việc phù hợp."}
      />
      <ListFooter data={list.data} setPage={list.setPage} />
      {open && active && (
        <TenderTaskModal tender={active} item={open} onClose={() => setOpen(null)} onSaved={() => void list.reload()} />
      )}
    </Card>
  );
}
