import { ArrowLeft, CheckCircle2, FilePlus2, Pencil, Plus, Trash2, XCircle } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import { DataTable, ListFooter, Toolbar, type Column } from "@/components/DataTable";
import { DocumentList } from "@/components/DocumentList";
import { clean, useForm } from "@/components/form";
import { UserSelect, useUsers } from "@/components/pickers";
import { TenderTaskBoard, TenderTasksPanel } from "@/components/TenderTasks";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorBox,
  Field,
  Input,
  Modal,
  PageHeader,
  ProgressBar,
  Select,
  Spinner,
  Tabs,
  Textarea,
  useAction,
  useUi,
} from "@/components/ui";
import { api, downloadExport, type Page } from "@/lib/api";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useFetch, useList } from "@/lib/hooks";
import {
  CAPABILITY_CATEGORY,
  LOST_REASON,
  PACKAGE_TYPE,
  SELECTION_METHOD,
  SUBMISSION_METHOD,
  TENDER_DECISION,
  TENDER_STATUS,
  labelOf,
  toneOf,
} from "@/lib/labels";
import { useSession } from "@/lib/session";
import type { CapabilityDoc, Tender, TenderClarification, TenderEvent, TenderStats } from "@/lib/types";

const pad = (n: number) => String(n).padStart(2, "0");

function toLocalInput(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const toIso = (local: string) => (local ? new Date(local).toISOString() : null);

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
    source: tender?.source ?? "",
    selection_method: tender?.selection_method ?? "open",
    package_type: tender?.package_type ?? "construction",
    owner: tender?.owner ?? "",
    release_date: tender?.release_date ?? "",
    site_visit_date: toLocalInput(tender?.site_visit_date),
    pre_bid_meeting_date: toLocalInput(tender?.pre_bid_meeting_date),
    clarification_deadline: tender?.clarification_deadline ?? "",
    submission_deadline: toLocalInput(tender?.submission_deadline),
    opening_date: toLocalInput(tender?.opening_date),
    submission_method: tender?.submission_method ?? "online",
    bid_validity_days: tender?.bid_validity_days ? String(tender.bid_validity_days) : "",
  });
  const { bind, errors } = form;
  const save = () =>
    form
      .submit((v) => {
        const body = clean({
          ...v,
          site_visit_date: toIso(v.site_visit_date),
          pre_bid_meeting_date: toIso(v.pre_bid_meeting_date),
          submission_deadline: toIso(v.submission_deadline),
          opening_date: toIso(v.opening_date),
          bid_validity_days: v.bid_validity_days || null,
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
        <Field label="Bên mời thầu / Chủ đầu tư" required error={errors.investor}>
          <Input {...bind("investor")} />
        </Field>
        <Field label="Địa điểm" error={errors.location}>
          <Input {...bind("location")} />
        </Field>
        <Field label="Hình thức lựa chọn nhà thầu" error={errors.selection_method}>
          <Select options={SELECTION_METHOD} {...bind("selection_method")} />
        </Field>
        <Field label="Loại gói thầu" error={errors.package_type}>
          <Select options={PACKAGE_TYPE} {...bind("package_type")} />
        </Field>
        <Field label="Người phụ trách gói thầu" error={errors.owner}>
          <UserSelect {...bind("owner")} />
        </Field>
        <Field label="Nguồn thông tin mời thầu" error={errors.source}>
          <Input {...bind("source")} placeholder="VD: muasamcong.mpi.gov.vn, thư mời" />
        </Field>
        <Field label="Ngày phát hành HSMT" error={errors.release_date}>
          <Input type="date" {...bind("release_date")} />
        </Field>
        <Field label="Khảo sát hiện trường" error={errors.site_visit_date}>
          <Input type="datetime-local" {...bind("site_visit_date")} />
        </Field>
        <Field label="Hội nghị tiền đấu thầu" error={errors.pre_bid_meeting_date}>
          <Input type="datetime-local" {...bind("pre_bid_meeting_date")} />
        </Field>
        <Field label="Hạn hỏi đáp, làm rõ HSMT" error={errors.clarification_deadline}>
          <Input type="date" {...bind("clarification_deadline")} />
        </Field>
        <Field label="Hạn nộp thầu" required error={errors.submission_deadline}>
          <Input type="datetime-local" {...bind("submission_deadline")} />
        </Field>
        <Field label="Thời điểm mở thầu" error={errors.opening_date}>
          <Input type="datetime-local" {...bind("opening_date")} />
        </Field>
        <Field label="Hình thức nộp" error={errors.submission_method}>
          <Select options={SUBMISSION_METHOD} {...bind("submission_method")} />
        </Field>
        <Field label="Hiệu lực HSDT (ngày)" error={errors.bid_validity_days}>
          <Input type="number" min={0} {...bind("bid_validity_days")} />
        </Field>
      </div>
    </Modal>
  );
}

function StatCard({ label, value, tone = "text-navy-800" }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="border-slate-200 shadow-xs rounded-lg border bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

function TenderCalendar() {
  const { ws } = useSession();
  const [mine, setMine] = useState(false);
  const { data, error, loading, reload } = useFetch<{ events: TenderEvent[] }>(ws("/tenders/calendar/"), {
    mine: mine ? "true" : "",
  });
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const KIND_TONE: Record<string, "red" | "blue" | "amber" | "violet" | "gray"> = {
    submission: "red",
    opening: "amber",
    clarification: "violet",
    site_visit: "blue",
    pre_bid: "blue",
    item: "gray",
  };
  const days = new Map<string, TenderEvent[]>();
  for (const e of data?.events ?? []) days.set(e.date, [...(days.get(e.date) ?? []), e]);
  return (
    <Card
      title="Lịch đấu thầu: các mốc quan trọng và hạn công việc"
      actions={
        <label className="text-sm flex items-center gap-1.5">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Chỉ việc của tôi
        </label>
      }
    >
      {error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : loading && !data ? (
        <Spinner />
      ) : days.size === 0 ? (
        <Empty>Không có mốc nào trong 6 tuần tới.</Empty>
      ) : (
        <ul className="space-y-4">
          {[...days.entries()].map(([day, events]) => (
            <li key={day} className="flex gap-4">
              <div
                className={`text-sm w-24 shrink-0 font-semibold ${day < today ? "text-red-600" : day === today ? "text-brand-700" : "text-slate-600"}`}
              >
                {fmtDate(day)}
                {day === today && <div className="text-xs font-normal">Hôm nay</div>}
              </div>
              <ul className="flex-1 space-y-1.5">
                {events.map((e) => (
                  <li key={`${e.tender_id}-${e.kind}-${e.name}`}>
                    <button
                      type="button"
                      onClick={() => navigate(`/tenders/${e.tender_id}${e.kind === "item" ? "?tab=tasks" : ""}`)}
                      className="border-slate-100 text-sm hover:bg-brand-50 flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left"
                    >
                      <Badge tone={KIND_TONE[e.kind]}>{e.label}</Badge>
                      <span className="min-w-0 flex-1 truncate">
                        <strong>{e.code}</strong> · {e.name}
                      </span>
                      {e.at && <span className="text-xs text-slate-500">{fmtDateTime(e.at).slice(-5)}</span>}
                      {e.owner && (
                        <span className="text-xs text-slate-500 hidden sm:inline">{e.owner.display_name}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function TendersPage() {
  const { ws, can } = useSession();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get("view") ?? "tenders";
  const stats = useFetch<TenderStats>(ws("/tenders/stats/"));
  const list = useList<Tender>(ws("/tenders/"), { status: "", package_type: "", mine: "", open: "true" });
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
        const days = Math.ceil((new Date(t.submission_deadline).getTime() - Date.now()) / 86_400_000);
        const open = t.status === "screening" || t.status === "preparing";
        return (
          <div className="whitespace-nowrap">
            <div className={open && days <= 3 ? "text-red-600 font-medium" : ""}>
              {fmtDateTime(t.submission_deadline)}
            </div>
            {open && (
              <div className="text-xs text-slate-500">{days >= 0 ? `còn ${days} ngày` : `trễ ${-days} ngày`}</div>
            )}
          </div>
        );
      },
    },
    {
      key: "tasks",
      header: "Công việc",
      render: (t) => (
        <div className="w-36">
          <ProgressBar value={t.checklist.percent} />
          <div className="text-xs text-slate-500">
            {t.checklist.done}/{t.checklist.total} xong
            {t.checklist.overdue > 0 && (
              <span className="text-red-600 ml-1 font-medium">· {t.checklist.overdue} quá hạn</span>
            )}
          </div>
        </div>
      ),
    },
    { key: "owner", header: "Phụ trách", hideOnMobile: true, render: (t) => t.owner_detail?.display_name ?? "—" },
    { key: "type", header: "Loại", hideOnMobile: true, render: (t) => labelOf(PACKAGE_TYPE, t.package_type) },
    {
      key: "status",
      header: "Trạng thái",
      render: (t) => (
        <div className="flex flex-col gap-1">
          <Badge tone={toneOf(TENDER_STATUS, t.status)}>{labelOf(TENDER_STATUS, t.status)}</Badge>
          {t.status === "screening" && <Badge tone="violet">Chờ quyết định</Badge>}
        </div>
      ),
    },
  ];
  const s = stats.data;
  return (
    <div>
      <PageHeader
        title="Quản lý đấu thầu"
        subtitle="Giao việc chuẩn bị hồ sơ dự thầu, theo dõi hạn và kết quả"
        actions={
          can("tender.create") && (
            <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              Thêm gói thầu
            </Button>
          )
        }
      />
      {s && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatCard label="Gói thầu đang theo dõi" value={s.open} />
          <StatCard
            label="Hạn nộp trong 7 ngày"
            value={s.due_7_days}
            tone={s.due_7_days ? "text-red-600" : undefined}
          />
          <StatCard label="Việc của tôi chưa xong" value={s.tasks.mine_open} />
          <StatCard
            label="Việc của tôi quá hạn"
            value={s.tasks.mine_overdue}
            tone={s.tasks.mine_overdue ? "text-red-600" : undefined}
          />
          <StatCard
            label="Việc quá hạn toàn bộ"
            value={s.tasks.overdue}
            tone={s.tasks.overdue ? "text-amber-700" : undefined}
          />
          <StatCard
            label="Tỷ lệ trúng thầu"
            value={s.win_rate === null ? "—" : `${s.win_rate}% (${s.won}/${s.won + s.lost})`}
          />
        </div>
      )}
      <Tabs
        value={tab}
        onChange={(v) => setParams({ view: v })}
        tabs={[
          { value: "tenders", label: "Gói thầu" },
          { value: "tasks", label: "Công việc đấu thầu" },
          { value: "calendar", label: "Lịch" },
        ]}
      />
      {tab === "tasks" && <TenderTaskBoard />}
      {tab === "calendar" && <TenderCalendar />}
      {tab === "tenders" && (
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
            <Select
              className="w-full sm:w-44"
              placeholder="Mọi loại gói thầu"
              options={PACKAGE_TYPE}
              value={String(list.filters.package_type ?? "")}
              onChange={(e) => list.setFilter("package_type", e.target.value)}
            />
            <label className="text-sm text-slate-600 flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={list.filters.mine === "true"}
                onChange={(e) => list.setFilter("mine", e.target.checked ? "true" : "")}
              />{" "}
              Tôi tham gia
            </label>
            <label className="text-sm text-slate-600 flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={list.filters.open === "true"}
                onChange={(e) => list.setFilter("open", e.target.checked ? "true" : "")}
              />{" "}
              Chỉ gói đang mở
            </label>
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
      )}
      {creating && <TenderForm onClose={() => setCreating(false)} onSaved={(t) => navigate(`/tenders/${t.id}`)} />}
    </div>
  );
}

function Clarifications({ tender, onChanged }: { tender: Tender; onChanged: () => void }) {
  const { ws, can } = useSession();
  const { data, reload } = useFetch<Page<TenderClarification>>(ws("/tender-clarifications/"), {
    tender: tender.id,
    page_size: 100,
  });
  const { confirm } = useUi();
  const { run } = useAction();
  const [editing, setEditing] = useState<TenderClarification | null | undefined>(undefined);
  const canEdit = !tender.is_locked && can("tender.update");
  const refresh = () => {
    void reload();
    onChanged();
  };
  return (
    <Card
      title="Hỏi đáp, làm rõ HSMT"
      actions={
        canEdit && (
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing(null)}>
            Thêm
          </Button>
        )
      }
    >
      {!data?.results.length ? (
        <Empty>Chưa có câu hỏi / văn bản làm rõ.</Empty>
      ) : (
        <ul className="divide-slate-100 divide-y">
          {data.results.map((c) => (
            <li key={c.id} className="py-3">
              <div className="flex items-start gap-2">
                <Badge tone={c.kind === "question" ? "blue" : "violet"}>
                  {c.kind === "question" ? "Câu hỏi" : "Văn bản bên mời thầu"}
                </Badge>
                {c.reference && <span className="text-xs text-slate-500">{c.reference}</span>}
                <Badge tone={c.is_answered ? "green" : "amber"}>
                  {c.is_answered ? "Đã có trả lời" : "Chờ trả lời"}
                </Badge>
                <span className="text-xs text-slate-400 ml-auto">{fmtDate(c.asked_date)}</span>
                {canEdit && (
                  <>
                    <button
                      type="button"
                      aria-label="Sửa"
                      className="text-slate-400 hover:text-navy-700"
                      onClick={() => setEditing(c)}
                    >
                      <Pencil className="size-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Xóa"
                      className="text-slate-400 hover:text-red-600"
                      onClick={async () => {
                        const { ok } = await confirm({ title: "Xóa mục này?", danger: true, confirmText: "Xóa" });
                        if (ok) {
                          await run(() => api.del(ws(`/tender-clarifications/${c.id}/`)), "Đã xóa");
                          refresh();
                        }
                      }}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </>
                )}
              </div>
              <p className="text-sm mt-1 whitespace-pre-line">{c.question}</p>
              {c.answer && (
                <p className="bg-slate-50 text-sm text-slate-700 mt-1 rounded-md p-2 whitespace-pre-line">
                  <strong>Trả lời ({fmtDate(c.answered_date)}):</strong> {c.answer}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing !== undefined && (
        <ClarificationModal
          tenderId={tender.id}
          item={editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            refresh();
          }}
        />
      )}
    </Card>
  );
}

function ClarificationModal({
  tenderId,
  item,
  onClose,
  onSaved,
}: {
  tenderId: string;
  item: TenderClarification | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { ws } = useSession();
  const form = useForm({
    tender: tenderId,
    kind: item?.kind ?? "question",
    reference: item?.reference ?? "",
    question: item?.question ?? "",
    asked_date: item?.asked_date ?? "",
    answer: item?.answer ?? "",
    answered_date: item?.answered_date ?? "",
  });
  const save = () =>
    form
      .submit(
        (v) =>
          item
            ? api.patch(ws(`/tender-clarifications/${item.id}/`), clean(v))
            : api.post(ws("/tender-clarifications/"), clean(v)),
        "Đã lưu"
      )
      .then((r) => r && onSaved());
  return (
    <Modal
      open
      onClose={onClose}
      title={item ? "Sửa hỏi đáp" : "Thêm hỏi đáp / văn bản làm rõ"}
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
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Loại">
          <Select
            options={[
              { value: "question", label: "Câu hỏi của nhà thầu" },
              { value: "addendum", label: "Văn bản của bên mời thầu" },
            ]}
            {...form.bind("kind")}
          />
        </Field>
        <Field label="Số văn bản">
          <Input {...form.bind("reference")} />
        </Field>
        <Field label="Nội dung" required className="md:col-span-2" error={form.errors.question}>
          <Textarea rows={3} {...form.bind("question")} />
        </Field>
        <Field label="Ngày hỏi / ngày ban hành">
          <Input type="date" {...form.bind("asked_date")} />
        </Field>
        <Field label="Ngày trả lời">
          <Input type="date" {...form.bind("answered_date")} />
        </Field>
        <Field label="Trả lời" className="md:col-span-2">
          <Textarea rows={3} {...form.bind("answer")} />
        </Field>
      </div>
    </Modal>
  );
}

function CapabilityPicker({ tender, onChanged }: { tender: Tender; onChanged: () => void }) {
  const { ws, can } = useSession();
  const { data } = useFetch<Page<CapabilityDoc>>(can("capability.view") ? ws("/capability-documents/") : null, {
    page_size: 200,
    is_active: "true",
  });
  const { run } = useAction();
  const selected = new Set(tender.capability_document_ids);
  const canEdit = !tender.is_locked && can("tender.update");
  const toggle = async (id: string) => {
    const next = selected.has(id) ? [...selected].filter((x) => x !== id) : [...selected, id];
    if (await run(() => api.patch(ws(`/tenders/${tender.id}/`), { capability_document_ids: next }))) onChanged();
  };
  if (!can("capability.view")) return null;
  return (
    <Card
      title="Hồ sơ năng lực dùng cho gói thầu này"
      actions={
        <Link to="/capabilities" className="text-sm text-brand-700 hover:underline">
          Mở thư viện hồ sơ năng lực
        </Link>
      }
    >
      {!data?.results.length ? (
        <Empty>Thư viện hồ sơ năng lực còn trống.</Empty>
      ) : (
        <ul className="grid gap-1 sm:grid-cols-2">
          {data.results.map((d) => (
            <li key={d.id}>
              <label className="text-sm hover:bg-slate-50 flex items-start gap-2 rounded px-2 py-1.5">
                <input
                  type="checkbox"
                  className="mt-1"
                  disabled={!canEdit}
                  checked={selected.has(d.id)}
                  onChange={() => void toggle(d.id)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{d.title}</span>
                  <span className="text-xs text-slate-500">{labelOf(CAPABILITY_CATEGORY, d.category)}</span>
                </span>
                {d.is_expired ? (
                  <Badge tone="red">Hết hạn</Badge>
                ) : d.days_to_expiry !== null && d.days_to_expiry <= 30 ? (
                  <Badge tone="amber">Còn {d.days_to_expiry} ngày</Badge>
                ) : null}
              </label>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ResultModal({
  tender,
  target,
  onClose,
  onDone,
}: {
  tender: Tender;
  target: string;
  onClose: () => void;
  onDone: (t: Tender) => void;
}) {
  const { ws, can } = useSession();
  const form = useForm({ lost_reason: "", winner_name: "", note: "", result_date: "", force: false });
  const stillOpen = tender.checklist.total - tender.checklist.done;
  const title = {
    submitted: "Xác nhận đã nộp HSDT",
    evaluating: "Chuyển sang chấm thầu",
    won: "Ghi nhận trúng thầu",
    lost: "Ghi nhận không trúng thầu",
    cancelled: "Bên mời thầu hủy gói thầu",
    declined: "Rút khỏi gói thầu",
  }[target];
  const save = () =>
    form
      .submit(
        (v) =>
          api.post<Tender>(ws(`/tenders/${tender.id}/transition/`), {
            status: target,
            ...clean({ ...v, force: undefined }),
            force: v.force,
          }),
        "Đã cập nhật trạng thái"
      )
      .then((t) => t && onDone(t));
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={title ?? "Chuyển trạng thái"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button loading={form.saving} onClick={() => void save()}>
            Xác nhận
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {target === "submitted" && stillOpen > 0 && (
          <div className="bg-amber-50 text-sm text-amber-900 rounded-md p-3">
            Còn <strong>{stillOpen}</strong> công việc chưa hoàn thành.
            {can("tender.approve") ? (
              <label className="mt-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.values.force}
                  onChange={(e) => form.set("force", e.target.checked)}
                />{" "}
                Vẫn nộp (tôi chịu trách nhiệm)
              </label>
            ) : (
              <div>Hoàn thành hết công việc trước khi nộp.</div>
            )}
            {form.errors.checklist && <div className="text-red-700 mt-1">{form.errors.checklist}</div>}
          </div>
        )}
        {target === "won" && (
          <Field label="Nhà thầu trúng (mặc định là công ty)">
            <Input {...form.bind("winner_name")} />
          </Field>
        )}
        {target === "lost" && (
          <>
            <Field label="Lý do không trúng" required error={form.errors.lost_reason}>
              <Select placeholder="— Chọn lý do —" options={LOST_REASON} {...form.bind("lost_reason")} />
            </Field>
            <Field label="Nhà thầu trúng">
              <Input {...form.bind("winner_name")} />
            </Field>
          </>
        )}
        {(target === "won" || target === "lost") && (
          <Field label="Ngày có kết quả">
            <Input type="date" {...form.bind("result_date")} />
          </Field>
        )}
        <Field label="Ghi chú" required={target === "cancelled" || target === "declined"} error={form.errors.note}>
          <Textarea {...form.bind("note")} />
        </Field>
      </div>
    </Modal>
  );
}

function CreateProjectModal({
  tender,
  onClose,
  onDone,
}: {
  tender: Tender;
  onClose: () => void;
  onDone: (projectId: string) => void;
}) {
  const { ws } = useSession();
  const users = useUsers();
  const form = useForm({
    code: "",
    name: tender.name,
    manager: "",
    start_date: "",
    planned_end_date: "",
    member_ids: [] as string[],
  });
  const save = () =>
    form
      .submit((v) => api.post<{ id: string }>(ws(`/tenders/${tender.id}/create-project/`), clean(v)), "Đã tạo dự án")
      .then((p) => p && onDone(p.id));
  return (
    <Modal
      open
      onClose={onClose}
      title="Tạo dự án từ gói thầu trúng"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button loading={form.saving} onClick={() => void save()}>
            Tạo dự án
          </Button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Mã dự án" required error={form.errors.code}>
          <Input {...form.bind("code")} />
        </Field>
        <Field label="Tên công trình" required error={form.errors.name || form.errors.project}>
          <Input {...form.bind("name")} />
        </Field>
        <Field label="Người phụ trách" required error={form.errors.manager}>
          <UserSelect {...form.bind("manager")} />
        </Field>
        <div />
        <Field label="Ngày bắt đầu" required error={form.errors.start_date}>
          <Input type="date" {...form.bind("start_date")} />
        </Field>
        <Field label="Ngày kết thúc dự kiến" required error={form.errors.planned_end_date}>
          <Input type="date" {...form.bind("planned_end_date")} />
        </Field>
        <Field group label="Thành viên" className="md:col-span-2">
          <div className="border-slate-200 grid max-h-40 gap-1 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">
            {(users.data ?? []).map((u) => (
              <label key={u.id} className="text-sm hover:bg-slate-50 flex items-center gap-2 rounded px-2 py-1">
                <input
                  type="checkbox"
                  checked={form.values.member_ids.includes(u.id)}
                  onChange={() =>
                    form.set(
                      "member_ids",
                      form.values.member_ids.includes(u.id)
                        ? form.values.member_ids.filter((x) => x !== u.id)
                        : [...form.values.member_ids, u.id]
                    )
                  }
                />
                <span className="truncate">{u.full_name || u.display_name}</span>
              </label>
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  );
}

export function TenderDetailPage() {
  const { id = "" } = useParams();
  const { ws, can } = useSession();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "overview";
  const { confirm } = useUi();
  const { run, busy } = useAction();
  const { data: tender, error, loading, reload, setData } = useFetch<Tender>(ws(`/tenders/${id}/`));
  const [editing, setEditing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [projectModal, setProjectModal] = useState(false);

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !tender) return <Spinner />;
  if (!tender) return null;

  const decide = async (decision: "go" | "no_go") => {
    const r = await confirm({
      title: decision === "go" ? "Quyết định THAM DỰ gói thầu?" : "Quyết định KHÔNG tham dự?",
      message:
        decision === "go"
          ? "Gói thầu chuyển sang giai đoạn lập hồ sơ; người phụ trách được thông báo."
          : "Gói thầu sẽ đóng lại.",
      input: { label: "Ý kiến / lý do", required: decision === "no_go" },
      confirmText: decision === "go" ? "Tham dự" : "Không tham dự",
      danger: decision === "no_go",
    });
    if (!r.ok) return;
    const res = await run(
      () => api.post<Tender>(ws(`/tenders/${tender.id}/decide/`), { decision, note: r.value }),
      "Đã ghi nhận quyết định"
    );
    if (res) setData(res);
  };
  const canTransition = !tender.is_locked && can("tender.update");
  const open = tender.status === "preparing";
  const tabs = [
    { value: "overview", label: "Tổng quan" },
    { value: "tasks", label: `Công việc (${tender.checklist.done}/${tender.checklist.total})` },
    {
      value: "clarifications",
      label: `Hỏi đáp${tender.counts?.clarifications_open ? ` (${tender.counts.clarifications_open} chờ)` : ""}`,
    },
    { value: "documents", label: `Hồ sơ nộp thầu (${tender.counts?.documents ?? 0})` },
  ];

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
            {tender.code} · {tender.name}
            <Badge tone={toneOf(TENDER_STATUS, tender.status)}>{labelOf(TENDER_STATUS, tender.status)}</Badge>
          </span>
        }
        subtitle={`${tender.investor} · Hạn nộp ${fmtDateTime(tender.submission_deadline)}`}
        actions={
          <>
            {canTransition && (
              <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
                Sửa
              </Button>
            )}
            {open && canTransition && (
              <Button icon={<CheckCircle2 className="size-4" />} onClick={() => setResult("submitted")}>
                Đã nộp HSDT
              </Button>
            )}
            {tender.status === "submitted" && canTransition && (
              <Button variant="secondary" onClick={() => setResult("evaluating")}>
                Chuyển chấm thầu
              </Button>
            )}
            {["submitted", "evaluating"].includes(tender.status) && canTransition && (
              <>
                <Button variant="success" onClick={() => setResult("won")}>
                  Trúng thầu
                </Button>
                <Button variant="danger" onClick={() => setResult("lost")}>
                  Không trúng
                </Button>
              </>
            )}
            {!tender.is_locked && can("tender.delete") && ["screening"].includes(tender.status) && (
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
      {tender.status === "screening" && (
        <div className="border-violet-200 bg-violet-50 flex flex-wrap items-center gap-3 rounded-lg border p-4">
          <div className="text-sm text-violet-900 min-w-0 flex-1">
            <strong>Chờ quyết định tham dự.</strong> Đánh giá năng lực, quy mô, rủi ro rồi quyết định tham dự hay không.
            {!can("tender.approve") && " (Chỉ người có quyền duyệt đấu thầu mới quyết định được.)"}
          </div>
          {can("tender.approve") && (
            <>
              <Button
                variant="success"
                loading={busy}
                icon={<CheckCircle2 className="size-4" />}
                onClick={() => void decide("go")}
              >
                Tham dự
              </Button>
              <Button
                variant="danger"
                loading={busy}
                icon={<XCircle className="size-4" />}
                onClick={() => void decide("no_go")}
              >
                Không tham dự
              </Button>
            </>
          )}
        </div>
      )}
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={tabs} />
      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Thông tin gói thầu" className="lg:col-span-2">
            <dl className="text-sm grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {[
                ["Bên mời thầu", tender.investor],
                ["Địa điểm", tender.location || "—"],
                ["Loại gói thầu", labelOf(PACKAGE_TYPE, tender.package_type)],
                ["Hình thức lựa chọn nhà thầu", labelOf(SELECTION_METHOD, tender.selection_method)],
                ["Người phụ trách", tender.owner_detail?.display_name ?? "—"],
                ["Nguồn thông tin", tender.source || "—"],
                ["Phát hành HSMT", fmtDate(tender.release_date)],
                ["Khảo sát hiện trường", fmtDateTime(tender.site_visit_date)],
                ["Hội nghị tiền đấu thầu", fmtDateTime(tender.pre_bid_meeting_date)],
                ["Hạn hỏi đáp, làm rõ", fmtDate(tender.clarification_deadline)],
                ["Hạn nộp thầu", fmtDateTime(tender.submission_deadline)],
                ["Mở thầu", fmtDateTime(tender.opening_date)],
                ["Hình thức nộp", labelOf(SUBMISSION_METHOD, tender.submission_method)],
                ["Hiệu lực HSDT", tender.bid_validity_days ? `${tender.bid_validity_days} ngày` : "—"],
                ["Đã nộp lúc", fmtDateTime(tender.submitted_at)],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-slate-500">{k}</dt>
                  <dd className="font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <div className="space-y-4">
            <Card title="Quyết định tham dự">
              <Badge tone={toneOf(TENDER_DECISION, tender.decision)}>{labelOf(TENDER_DECISION, tender.decision)}</Badge>
              {tender.decision_at && (
                <p className="text-sm text-slate-600 mt-2">
                  {tender.decision_by_detail?.display_name} · {fmtDateTime(tender.decision_at)}
                  {tender.decision_note && <span className="block italic">“{tender.decision_note}”</span>}
                </p>
              )}
            </Card>
            <Card title="Tiến độ chuẩn bị hồ sơ">
              <ProgressBar value={tender.checklist.percent} />
              <p className="text-sm text-slate-600 mt-2">
                {tender.checklist.done}/{tender.checklist.total} công việc xong
                {tender.checklist.overdue > 0 && (
                  <span className="text-red-600 font-medium"> · {tender.checklist.overdue} quá hạn</span>
                )}
              </p>
              <Button size="sm" variant="secondary" className="mt-2" onClick={() => setParams({ tab: "tasks" })}>
                Mở danh sách công việc
              </Button>
            </Card>
            {(tender.status === "won" || tender.status === "lost") && (
              <Card title="Kết quả">
                <dl className="text-sm space-y-1">
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Ngày có kết quả</dt>
                    <dd>{fmtDate(tender.result_date)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Nhà thầu trúng</dt>
                    <dd>{tender.winner_name || "—"}</dd>
                  </div>
                  {tender.status === "lost" && (
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Lý do</dt>
                      <dd>{labelOf(LOST_REASON, tender.lost_reason)}</dd>
                    </div>
                  )}
                </dl>
                {tender.status === "won" &&
                  (tender.project ? (
                    <Link
                      to={`/projects/${tender.project}`}
                      className="text-sm text-brand-700 mt-3 inline-block hover:underline"
                    >
                      Dự án: {tender.project_name}
                    </Link>
                  ) : (
                    can("project.create") && (
                      <Button
                        className="mt-3"
                        icon={<FilePlus2 className="size-4" />}
                        onClick={() => setProjectModal(true)}
                      >
                        Tạo dự án từ gói thầu
                      </Button>
                    )
                  ))}
              </Card>
            )}
            {tender.result_note && (
              <Card title="Ghi chú">
                <p className="text-sm whitespace-pre-line">{tender.result_note}</p>
              </Card>
            )}
          </div>
        </div>
      )}
      {tab === "tasks" && (
        <TenderTasksPanel tender={tender} onChanged={() => void reload()} focusItem={params.get("item")} />
      )}
      {tab === "clarifications" && <Clarifications tender={tender} onChanged={() => void reload()} />}
      {tab === "documents" && (
        <div className="space-y-4">
          <CapabilityPicker tender={tender} onChanged={() => void reload()} />
          <DocumentList tenderId={tender.id} />
        </div>
      )}
      {editing && (
        <TenderForm
          tender={tender}
          onClose={() => setEditing(false)}
          onSaved={(t) => {
            setEditing(false);
            setData({ ...tender, ...t });
            void reload();
          }}
        />
      )}
      {result && (
        <ResultModal
          tender={tender}
          target={result}
          onClose={() => setResult(null)}
          onDone={(t) => {
            setResult(null);
            setData(t);
          }}
        />
      )}
      {projectModal && (
        <CreateProjectModal
          tender={tender}
          onClose={() => setProjectModal(false)}
          onDone={(pid) => navigate(`/projects/${pid}`)}
        />
      )}
    </div>
  );
}
