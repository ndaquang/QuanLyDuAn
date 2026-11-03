import { ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { DataTable, ListFooter, Toolbar, type Column } from "@/components/DataTable";
import { DocumentList } from "@/components/DocumentList";
import { clean, useForm } from "@/components/form";
import { ProjectSelect, UserSelect } from "@/components/pickers";
import {
  Badge,
  Button,
  Card,
  ErrorBox,
  Field,
  Input,
  Modal,
  PageHeader,
  ProgressBar,
  Select,
  Spinner,
  Textarea,
  useAction,
  useUi,
} from "@/components/ui";
import { api, downloadExport, type Page } from "@/lib/api";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import { useFetch, useList } from "@/lib/hooks";
import { TENDER_ITEM_CATEGORY, TENDER_ITEM_STATUS, TENDER_STATUS, labelOf, toneOf } from "@/lib/labels";
import { useSession } from "@/lib/session";
import type { Tender, TenderItem } from "@/lib/types";

const pad = (n: number) => String(n).padStart(2, "0");

function toLocalInput(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function TenderForm({
  tender,
  onClose,
  onSaved,
}: {
  tender?: Tender | null;
  onClose: () => void;
  onSaved: (t: Tender) => void;
}) {
  const { ws } = useSession();
  const form = useForm({
    code: tender?.code ?? "",
    name: tender?.name ?? "",
    investor: tender?.investor ?? "",
    location: tender?.location ?? "",
    owner: tender?.owner ?? "",
    project: tender?.project ?? "",
    release_date: tender?.release_date ?? "",
    clarification_deadline: tender?.clarification_deadline ?? "",
    submission_deadline: toLocalInput(tender?.submission_deadline),
    bid_value: tender?.bid_value ?? "0",
    status: tender?.status ?? "preparing",
    result_note: tender?.result_note ?? "",
  });
  const { bind, errors } = form;
  const save = () =>
    form
      .submit((v) => {
        const body = clean({
          ...v,
          submission_deadline: v.submission_deadline ? new Date(v.submission_deadline).toISOString() : "",
        });
        return tender ? api.patch<Tender>(ws(`/tenders/${tender.id}/`), body) : api.post<Tender>(ws("/tenders/"), body);
      }, "Đã lưu gói thầu")
      .then((t) => t && onSaved(t));
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={tender ? `Sửa gói thầu ${tender.code}` : "Thêm gói thầu"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button loading={form.saving} onClick={() => void save()}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Mã gói thầu" required error={errors.code}>
          <Input {...bind("code")} />
        </Field>
        <Field label="Tên gói thầu" required error={errors.name}>
          <Input {...bind("name")} />
        </Field>
        <Field label="Chủ đầu tư / Bên mời thầu" required error={errors.investor}>
          <Input {...bind("investor")} />
        </Field>
        <Field label="Địa điểm" error={errors.location}>
          <Input {...bind("location")} />
        </Field>
        <Field label="Người phụ trách" error={errors.owner}>
          <UserSelect {...bind("owner")} />
        </Field>
        <Field label="Trạng thái" error={errors.status}>
          <Select options={TENDER_STATUS} {...bind("status")} />
        </Field>
        <Field label="Ngày phát hành HSMT" error={errors.release_date}>
          <Input type="date" {...bind("release_date")} />
        </Field>
        <Field label="Hạn hỏi đáp / làm rõ" error={errors.clarification_deadline}>
          <Input type="date" {...bind("clarification_deadline")} />
        </Field>
        <Field label="Hạn nộp thầu" required error={errors.submission_deadline}>
          <Input type="datetime-local" {...bind("submission_deadline")} />
        </Field>
        <Field label="Giá dự thầu (VNĐ)" error={errors.bid_value}>
          <Input type="number" min={0} {...bind("bid_value")} />
        </Field>
        <Field label="Dự án (khi trúng thầu)" error={errors.project}>
          <ProjectSelect placeholder="— Chưa gắn dự án —" {...bind("project")} />
        </Field>
        <Field label="Kết quả / ghi chú" className="md:col-span-2">
          <Textarea {...bind("result_note")} />
        </Field>
      </div>
    </Modal>
  );
}

export function TendersPage() {
  const { ws, can } = useSession();
  const navigate = useNavigate();
  const list = useList<Tender>(ws("/tenders/"), { status: "" });
  const [creating, setCreating] = useState(false);
  const columns: Column<Tender>[] = [
    { key: "code", header: "Mã", render: (t) => <span className="text-navy-700 font-medium">{t.code}</span> },
    {
      key: "name",
      header: "Gói thầu",
      render: (t) => (
        <div className="max-w-80">
          <div className="truncate font-medium">{t.name}</div>
          <div className="text-xs text-slate-500 truncate">{t.investor}</div>
        </div>
      ),
    },
    {
      key: "deadline",
      header: "Hạn nộp",
      render: (t) => {
        const late = new Date(t.submission_deadline) < new Date() && t.status === "preparing";
        return <span className={late ? "text-red-600 font-medium" : ""}>{fmtDateTime(t.submission_deadline)}</span>;
      },
    },
    {
      key: "checklist",
      header: "Hồ sơ",
      render: (t) => (
        <div className="w-36">
          <ProgressBar value={t.checklist.percent} />
          <div className="text-xs text-slate-500">
            {t.checklist.done}/{t.checklist.total} đầu mục
          </div>
        </div>
      ),
    },
    { key: "owner", header: "Phụ trách", hideOnMobile: true, render: (t) => t.owner_detail?.display_name ?? "—" },
    {
      key: "value",
      header: "Giá dự thầu",
      hideOnMobile: true,
      className: "text-right",
      render: (t) => fmtMoney(t.bid_value),
    },
    {
      key: "status",
      header: "Trạng thái",
      render: (t) => <Badge tone={toneOf(TENDER_STATUS, t.status)}>{labelOf(TENDER_STATUS, t.status)}</Badge>,
    },
  ];
  return (
    <div>
      <PageHeader
        title="Quản lý đấu thầu"
        subtitle="Theo dõi tiến độ chuẩn bị và nộp hồ sơ dự thầu"
        actions={
          can("tender.create") && (
            <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              Thêm gói thầu
            </Button>
          )
        }
      />
      <Card bodyClassName="p-0">
        <Toolbar
          q={list.q}
          onQ={list.setQ}
          placeholder="Tìm gói thầu, chủ đầu tư..."
          onExport={() => downloadExport(ws("/tenders/"), list.query)}
        >
          <Select
            className="w-full sm:w-44"
            placeholder="Mọi trạng thái"
            options={TENDER_STATUS}
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
          onRowClick={(t) => navigate(`/tenders/${t.id}`)}
          empty="Chưa có gói thầu."
        />
        <ListFooter data={list.data} setPage={list.setPage} />
      </Card>
      {creating && <TenderForm onClose={() => setCreating(false)} onSaved={(t) => navigate(`/tenders/${t.id}`)} />}
    </div>
  );
}

function ChecklistItemModal({
  tenderId,
  item,
  onClose,
  onSaved,
}: {
  tenderId: string;
  item: TenderItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { ws } = useSession();
  const form = useForm({
    tender: tenderId,
    name: item?.name ?? "",
    category: item?.category ?? "technical",
    assignee: item?.assignee ?? "",
    due_date: item?.due_date ?? "",
    status: item?.status ?? "todo",
    note: item?.note ?? "",
  });
  const save = () =>
    form
      .submit(
        (v) => (item ? api.patch(ws(`/tender-items/${item.id}/`), clean(v)) : api.post(ws("/tender-items/"), clean(v))),
        "Đã lưu"
      )
      .then((r) => r && onSaved());
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={item ? "Sửa đầu mục hồ sơ" : "Thêm đầu mục hồ sơ"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button loading={form.saving} onClick={() => void save()}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Tên đầu mục" required error={form.errors.name}>
          <Input {...form.bind("name")} />
        </Field>
        <Field label="Nhóm">
          <Select options={TENDER_ITEM_CATEGORY} {...form.bind("category")} />
        </Field>
        <Field label="Người phụ trách" error={form.errors.assignee}>
          <UserSelect {...form.bind("assignee")} />
        </Field>
        <Field label="Hạn hoàn thành">
          <Input type="date" {...form.bind("due_date")} />
        </Field>
        <Field label="Trạng thái">
          <Select options={TENDER_ITEM_STATUS} {...form.bind("status")} />
        </Field>
        <Field label="Ghi chú">
          <Textarea {...form.bind("note")} />
        </Field>
      </div>
    </Modal>
  );
}

export function TenderDetailPage() {
  const { id = "" } = useParams();
  const { ws, can } = useSession();
  const navigate = useNavigate();
  const { confirm } = useUi();
  const { run } = useAction();
  const { data: tender, error, loading, reload, setData } = useFetch<Tender>(ws(`/tenders/${id}/`));
  const items = useFetch<Page<TenderItem>>(ws("/tender-items/"), { tender: id, page_size: 200 });
  const [editing, setEditing] = useState(false);
  const [itemModal, setItemModal] = useState<TenderItem | null | undefined>(undefined);

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading || !tender) return <Spinner />;
  const refresh = () => {
    void items.reload();
    void reload();
  };
  return (
    <div className="space-y-4">
      <Link
        to="/tenders"
        className="no-print text-sm text-slate-500 hover:text-brand-700 inline-flex items-center gap-1"
      >
        <ArrowLeft className="size-4" /> Danh sách gói thầu
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {tender.code} · {tender.name}{" "}
            <Badge tone={toneOf(TENDER_STATUS, tender.status)}>{labelOf(TENDER_STATUS, tender.status)}</Badge>
          </span>
        }
        subtitle={`${tender.investor} · Hạn nộp ${fmtDateTime(tender.submission_deadline)}`}
        actions={
          <>
            {can("tender.update") && (
              <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
                Sửa
              </Button>
            )}
            {can("tender.delete") && (
              <Button
                variant="danger"
                icon={<Trash2 className="size-4" />}
                onClick={async () => {
                  const { ok } = await confirm({
                    title: "Xóa gói thầu?",
                    message: tender.name,
                    danger: true,
                    confirmText: "Xóa",
                  });
                  if (ok && (await run(() => api.del(ws(`/tenders/${tender.id}/`)), "Đã xóa")) !== undefined)
                    navigate("/tenders");
                }}
              >
                Xóa
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Thông tin">
          <dl className="text-sm space-y-2">
            {[
              ["Bên mời thầu", tender.investor],
              ["Địa điểm", tender.location || "—"],
              ["Phụ trách", tender.owner_detail?.display_name ?? "—"],
              ["Phát hành HSMT", fmtDate(tender.release_date)],
              ["Hạn làm rõ", fmtDate(tender.clarification_deadline)],
              ["Hạn nộp thầu", fmtDateTime(tender.submission_deadline)],
              ["Giá dự thầu", fmtMoney(tender.bid_value)],
              ["Dự án", tender.project_name ?? "—"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-slate-500">{k}</dt>
                <dd className="text-right font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          {tender.result_note && <p className="border-slate-100 text-sm mt-3 border-t pt-2">{tender.result_note}</p>}
        </Card>
        <Card
          title={`Tiến độ chuẩn bị hồ sơ (${tender.checklist.done}/${tender.checklist.total})`}
          className="lg:col-span-2"
          actions={
            can("tender.create") && (
              <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setItemModal(null)}>
                Thêm đầu mục
              </Button>
            )
          }
        >
          <ProgressBar value={tender.checklist.percent} className="mb-3" />
          <ul className="divide-slate-100 divide-y">
            {(items.data?.results ?? []).map((i) => {
              const late = i.due_date && i.status !== "done" && i.due_date < new Date().toISOString().slice(0, 10);
              return (
                <li key={i.id} className="text-sm flex flex-wrap items-center gap-3 py-2">
                  {can("tender.update") ? (
                    <Select
                      className="w-32"
                      options={TENDER_ITEM_STATUS}
                      value={i.status}
                      onChange={async (e) => {
                        await run(() => api.patch(ws(`/tender-items/${i.id}/`), { status: e.target.value }));
                        refresh();
                      }}
                    />
                  ) : (
                    <Badge tone={toneOf(TENDER_ITEM_STATUS, i.status)}>{labelOf(TENDER_ITEM_STATUS, i.status)}</Badge>
                  )}
                  <button
                    type="button"
                    className="hover:text-brand-700 min-w-0 flex-1 text-left"
                    onClick={() => can("tender.update") && setItemModal(i)}
                  >
                    <div className="truncate font-medium">{i.name}</div>
                    <div className="text-xs text-slate-500">
                      {labelOf(TENDER_ITEM_CATEGORY, i.category)} · {i.assignee_detail?.display_name ?? "Chưa giao"}
                    </div>
                  </button>
                  <span className={late ? "text-xs text-red-600 font-medium" : "text-xs text-slate-500"}>
                    {fmtDate(i.due_date)}
                  </span>
                  {can("tender.delete") && (
                    <button
                      type="button"
                      aria-label="Xóa"
                      className="text-slate-400 hover:text-red-600"
                      onClick={async () => {
                        const { ok } = await confirm({
                          title: "Xóa đầu mục?",
                          message: i.name,
                          danger: true,
                          confirmText: "Xóa",
                        });
                        if (ok) {
                          await run(() => api.del(ws(`/tender-items/${i.id}/`)), "Đã xóa");
                          refresh();
                        }
                      }}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </li>
              );
            })}
            {items.data?.results.length === 0 && (
              <li className="text-sm text-slate-500 py-4 text-center">
                Chưa có đầu mục hồ sơ. Thêm các đầu mục cần chuẩn bị (pháp lý, kỹ thuật, tài chính).
              </li>
            )}
          </ul>
        </Card>
      </div>
      <div>
        <h2 className="text-sm text-navy-800 mb-2 font-semibold">Hồ sơ, tài liệu nộp thầu</h2>
        <DocumentList tenderId={tender.id} />
      </div>
      {editing && (
        <TenderForm
          tender={tender}
          onClose={() => setEditing(false)}
          onSaved={(t) => {
            setEditing(false);
            setData(t);
          }}
        />
      )}
      {itemModal !== undefined && (
        <ChecklistItemModal
          tenderId={tender.id}
          item={itemModal}
          onClose={() => setItemModal(undefined)}
          onSaved={() => {
            setItemModal(undefined);
            refresh();
          }}
        />
      )}
    </div>
  );
}
