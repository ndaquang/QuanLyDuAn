import { clsx } from "clsx";
import { ArrowLeft, Ban, CheckCircle2, Lock, Plus, Send, Trash2, XCircle } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import { Attachments } from "@/components/Attachments";
import { DataTable, ListFooter, Toolbar, type Column } from "@/components/DataTable";
import { clean, useForm } from "@/components/form";
import { ProjectSelect } from "@/components/pickers";
import {
  Badge,
  Button,
  Card,
  ErrorBox,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Tabs,
  Textarea,
  useAction,
  useUi,
} from "@/components/ui";
import { api, downloadExport } from "@/lib/api";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import { useFetch, useList } from "@/lib/hooks";
import { REQUEST_STATUS, REQUEST_TYPE, toneOf } from "@/lib/labels";
import { useSession } from "@/lib/session";
import type { ApprovalRequest } from "@/lib/types";

type Line = { id: string; name: string; unit: string; quantity: string; unit_price: string };

const newId = () => crypto.randomUUID();

function RequestForm({
  request,
  onClose,
  onSaved,
}: {
  request?: ApprovalRequest | null;
  onClose: () => void;
  onSaved: (r: ApprovalRequest) => void;
}) {
  const { ws } = useSession();
  const form = useForm({
    request_type: request?.request_type ?? "purchase",
    project: request?.project ?? "",
    title: request?.title ?? "",
    description: request?.description ?? "",
    amount: request?.amount ?? "",
  });
  const [lines, setLines] = useState<Line[]>(
    (request?.details.lines ?? []).map((l) => ({
      id: newId(),
      name: l.name,
      unit: l.unit ?? "",
      quantity: String(l.quantity),
      unit_price: String(l.unit_price),
    }))
  );
  const [leave, setLeave] = useState({
    from: String(request?.details.from ?? ""),
    to: String(request?.details.to ?? ""),
  });
  const type = form.values.request_type;
  const total = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unit_price || 0), 0);

  const save = (submit: boolean) =>
    form
      .submit(
        (v) => {
          const details: Record<string, unknown> = {};
          if (type === "purchase" && lines.length)
            details.lines = lines.map(({ id: _id, ...l }) => ({
              ...l,
              quantity: Number(l.quantity || 0),
              unit_price: Number(l.unit_price || 0),
            }));
          if (type === "leave") Object.assign(details, leave);
          const body = {
            ...clean(v),
            amount: type === "leave" ? 0 : type === "purchase" && lines.length ? total : v.amount || 0,
            details,
          };
          if (request)
            return api
              .patch<ApprovalRequest>(ws(`/approval-requests/${request.id}/`), body)
              .then((r) => (submit ? api.post<ApprovalRequest>(ws(`/approval-requests/${r.id}/submit/`)) : r));
          return api.post<ApprovalRequest>(ws("/approval-requests/"), { ...body, submit });
        },
        submit ? "Đã gửi yêu cầu phê duyệt" : "Đã lưu nháp"
      )
      .then((r) => r && onSaved(r));

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={request ? `Sửa yêu cầu ${request.code}` : "Tạo yêu cầu phê duyệt"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="secondary" loading={form.saving} onClick={() => void save(false)}>
            Lưu nháp
          </Button>
          <Button loading={form.saving} icon={<Send className="size-4" />} onClick={() => void save(true)}>
            Gửi duyệt
          </Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Loại yêu cầu" required error={form.errors.request_type}>
          <Select disabled={Boolean(request)} options={REQUEST_TYPE} {...form.bind("request_type")} />
        </Field>
        <Field label="Dự án" error={form.errors.project}>
          <ProjectSelect placeholder="— Không gắn dự án —" {...form.bind("project")} />
        </Field>
        <Field label="Tiêu đề" required className="md:col-span-2" error={form.errors.title}>
          <Input {...form.bind("title")} />
        </Field>
        <Field label="Nội dung / lý do" className="md:col-span-2" error={form.errors.description}>
          <Textarea {...form.bind("description")} />
        </Field>
        {type === "leave" ? (
          <>
            <Field label="Nghỉ từ ngày" required>
              <Input
                type="date"
                value={leave.from}
                onChange={(e) => setLeave((l) => ({ ...l, from: e.target.value }))}
              />
            </Field>
            <Field label="Đến ngày" required>
              <Input type="date" value={leave.to} onChange={(e) => setLeave((l) => ({ ...l, to: e.target.value }))} />
            </Field>
          </>
        ) : type === "purchase" ? (
          <div className="md:col-span-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm text-slate-700 font-medium">Danh sách vật tư đề xuất</span>
              <Button
                size="sm"
                variant="secondary"
                icon={<Plus className="size-4" />}
                onClick={() =>
                  setLines((l) => [...l, { id: newId(), name: "", unit: "", quantity: "", unit_price: "" }])
                }
              >
                Thêm dòng
              </Button>
            </div>
            <div className="border-slate-200 overflow-x-auto rounded-md border">
              <table className="cx-table w-full">
                <thead>
                  <tr>
                    <th>Vật tư</th>
                    <th>ĐVT</th>
                    <th>Số lượng</th>
                    <th>Đơn giá</th>
                    <th className="text-right">Thành tiền</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => {
                    const upd = (k: keyof Line, v: string) =>
                      setLines((ls) => ls.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
                    return (
                      <tr key={l.id}>
                        <td>
                          <Input value={l.name} onChange={(e) => upd("name", e.target.value)} className="min-w-40" />
                        </td>
                        <td>
                          <Input value={l.unit} onChange={(e) => upd("unit", e.target.value)} className="w-20" />
                        </td>
                        <td>
                          <Input
                            type="number"
                            min={0}
                            value={l.quantity}
                            onChange={(e) => upd("quantity", e.target.value)}
                            className="w-24"
                          />
                        </td>
                        <td>
                          <Input
                            type="number"
                            min={0}
                            value={l.unit_price}
                            onChange={(e) => upd("unit_price", e.target.value)}
                            className="w-32"
                          />
                        </td>
                        <td className="text-right tabular-nums">
                          {fmtMoney(Number(l.quantity || 0) * Number(l.unit_price || 0))}
                        </td>
                        <td>
                          <button
                            type="button"
                            aria-label="Xóa dòng"
                            className="text-slate-400 hover:text-red-600"
                            onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {lines.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-slate-500 text-center">
                        Thêm dòng vật tư, hoặc nhập tổng tiền bên dưới.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {lines.length > 0 ? (
              <p className="text-sm mt-2 text-right">
                Tổng cộng: <strong>{fmtMoney(total)}</strong>
              </p>
            ) : (
              <Field label="Số tiền đề nghị (VNĐ)" required className="mt-3" error={form.errors.amount}>
                <Input type="number" min={0} {...form.bind("amount")} />
              </Field>
            )}
          </div>
        ) : (
          <Field label="Số tiền (VNĐ)" required error={form.errors.amount}>
            <Input type="number" min={0} {...form.bind("amount")} />
          </Field>
        )}
      </div>
      <p className="bg-amber-50 text-xs text-amber-800 mt-4 rounded-md p-2">
        Yêu cầu tài chính đi qua đủ các bước: Trưởng bộ phận → Trưởng dự án → Kế toán (kiểm tra ngân sách) → Giám đốc
        (theo hạn mức). Không có giao dịch nào được duyệt tự động; người đề nghị không thể tự duyệt.
      </p>
    </Modal>
  );
}

export function ApprovalsPage() {
  const { ws, can } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [scope, setScopeState] = useState(params.get("scope") ?? "to_approve");
  const list = useList<ApprovalRequest>(ws("/approval-requests/"), { scope, status: "", request_type: "" });
  const setScope = (s: string) => {
    setScopeState(s);
    list.setFilter("scope", s === "all" ? "" : s);
  };
  const [creating, setCreating] = useState(false);
  const columns: Column<ApprovalRequest>[] = [
    { key: "code", header: "Số phiếu", render: (r) => <span className="text-navy-700 font-medium">{r.code}</span> },
    {
      key: "title",
      header: "Nội dung",
      render: (r) => (
        <div className="max-w-80">
          <div className="truncate font-medium">{r.title}</div>
          <div className="text-xs text-slate-500 truncate">
            {r.request_type_label}
            {r.project_name && ` · ${r.project_name}`}
          </div>
        </div>
      ),
    },
    {
      key: "amount",
      header: "Số tiền",
      className: "text-right",
      render: (r) => (Number(r.amount) ? fmtMoney(r.amount) : "—"),
    },
    { key: "requester", header: "Người đề nghị", hideOnMobile: true, render: (r) => r.requester_detail.display_name },
    { key: "step", header: "Bước hiện tại", hideOnMobile: true, render: (r) => r.current_step_name ?? "—" },
    { key: "date", header: "Ngày gửi", hideOnMobile: true, render: (r) => fmtDate(r.submitted_at?.slice(0, 10)) },
    {
      key: "status",
      header: "Trạng thái",
      render: (r) => (
        <div className="flex flex-col gap-1">
          <Badge tone={toneOf(REQUEST_STATUS, r.status)}>{r.status_label}</Badge>
          {r.can_act && <Badge tone="violet">Chờ bạn duyệt</Badge>}
        </div>
      ),
    },
  ];
  return (
    <div>
      <PageHeader
        title="Phê duyệt"
        subtitle="Mua vật tư, thanh toán, tạm ứng, phát sinh, điều chỉnh ngân sách, hợp đồng, nghỉ phép"
        actions={
          can("approval.create") && (
            <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              Tạo yêu cầu
            </Button>
          )
        }
      />
      <Card bodyClassName="p-0">
        <div className="px-3 pt-2">
          <Tabs
            value={scope}
            onChange={setScope}
            tabs={[
              { value: "to_approve", label: "Chờ tôi duyệt" },
              { value: "mine", label: "Yêu cầu của tôi" },
              { value: "all", label: can("approval_config.view") ? "Tất cả" : "Tôi liên quan" },
            ]}
          />
        </div>
        <Toolbar
          q={list.q}
          onQ={list.setQ}
          placeholder="Tìm số phiếu, tiêu đề..."
          onExport={() => downloadExport(ws("/approval-requests/"), list.query)}
        >
          <Select
            className="w-full sm:w-44"
            placeholder="Mọi loại"
            options={REQUEST_TYPE}
            value={String(list.filters.request_type ?? "")}
            onChange={(e) => list.setFilter("request_type", e.target.value)}
          />
          <Select
            className="w-full sm:w-40"
            placeholder="Mọi trạng thái"
            options={REQUEST_STATUS}
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
          onRowClick={(r) => navigate(`/approvals/${r.id}`)}
          empty={scope === "to_approve" ? "Không có yêu cầu nào chờ bạn duyệt." : "Chưa có yêu cầu."}
        />
        <ListFooter data={list.data} setPage={list.setPage} />
      </Card>
      {creating && <RequestForm onClose={() => setCreating(false)} onSaved={(r) => navigate(`/approvals/${r.id}`)} />}
    </div>
  );
}

const ACTION_TONE: Record<string, string> = {
  submit: "bg-blue-500",
  approve: "bg-emerald-500",
  reject: "bg-red-500",
  cancel: "bg-slate-400",
  skip: "bg-slate-300",
  comment: "bg-slate-400",
};

export function ApprovalDetailPage() {
  const { id } = useParams();
  const { ws, user } = useSession();
  const navigate = useNavigate();
  const { confirm } = useUi();
  const { run } = useAction();
  const { data: req, error, loading, reload, setData } = useFetch<ApprovalRequest>(ws(`/approval-requests/${id}/`));
  const [editing, setEditing] = useState(false);

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading || !req) return <Spinner />;

  const mine = req.requester === user?.id;
  const editable = mine && (req.status === "draft" || req.status === "rejected");
  const act = async (verb: "approve" | "reject" | "cancel" | "submit") => {
    let comment = "";
    if (verb !== "submit") {
      const budget = req.current_step_name?.toLowerCase().includes("ngân sách");
      const r = await confirm({
        title: { approve: "Phê duyệt yêu cầu", reject: "Từ chối yêu cầu", cancel: "Hủy yêu cầu" }[verb],
        message: verb === "approve" ? `Bước: ${req.current_step_name}` : undefined,
        input: {
          label:
            verb === "approve"
              ? budget
                ? "Ý kiến kiểm tra ngân sách (bắt buộc)"
                : "Ý kiến (không bắt buộc)"
              : "Lý do",
          required: verb === "reject" || (verb === "approve" && budget),
        },
        confirmText: { approve: "Phê duyệt", reject: "Từ chối", cancel: "Hủy yêu cầu" }[verb],
        danger: verb !== "approve",
      });
      if (!r.ok) return;
      comment = r.value;
    }
    const res = await run(
      () => api.post<ApprovalRequest>(ws(`/approval-requests/${req.id}/${verb}/`), { comment }),
      { approve: "Đã phê duyệt", reject: "Đã từ chối", cancel: "Đã hủy yêu cầu", submit: "Đã gửi duyệt" }[verb]
    );
    if (res) setData(res);
  };

  return (
    <div className="space-y-4">
      <Link
        to="/approvals"
        className="no-print text-sm text-slate-500 hover:text-brand-700 inline-flex items-center gap-1"
      >
        <ArrowLeft className="size-4" /> Danh sách phê duyệt
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {req.code} · {req.title} <Badge tone={toneOf(REQUEST_STATUS, req.status)}>{req.status_label}</Badge>
            {req.status === "approved" && <Lock className="text-slate-400 size-4" />}
          </span>
        }
        subtitle={`${req.request_type_label} · ${req.requester_detail.display_name} · ${fmtDateTime(req.created_at)}`}
        actions={
          <>
            {req.can_act && (
              <Button variant="danger" icon={<XCircle className="size-4" />} onClick={() => void act("reject")}>
                Từ chối
              </Button>
            )}
            {req.can_act && (
              <Button variant="success" icon={<CheckCircle2 className="size-4" />} onClick={() => void act("approve")}>
                Phê duyệt
              </Button>
            )}
            {editable && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Sửa
              </Button>
            )}
            {editable && (
              <Button icon={<Send className="size-4" />} onClick={() => void act("submit")}>
                Gửi duyệt
              </Button>
            )}
            {mine && ["draft", "pending", "rejected"].includes(req.status) && (
              <Button variant="ghost" icon={<Ban className="size-4" />} onClick={() => void act("cancel")}>
                Hủy yêu cầu
              </Button>
            )}
            {mine && req.status === "draft" && (
              <Button
                variant="ghost"
                icon={<Trash2 className="size-4" />}
                onClick={async () => {
                  const { ok } = await confirm({ title: "Xóa bản nháp?", danger: true, confirmText: "Xóa" });
                  if (ok && (await run(() => api.del(ws(`/approval-requests/${req.id}/`)), "Đã xóa")) !== undefined)
                    navigate("/approvals");
                }}
              >
                Xóa
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Nội dung đề nghị">
            <dl className="text-sm grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-slate-500">Dự án</dt>
                <dd className="font-medium">
                  {req.project ? (
                    <Link className="text-brand-700 hover:underline" to={`/projects/${req.project}`}>
                      {req.project_name}
                    </Link>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Số tiền</dt>
                <dd className="text-lg text-navy-800 font-semibold">
                  {Number(req.amount) ? fmtMoney(req.amount) : "—"}
                </dd>
              </div>
              {req.details.from && (
                <div>
                  <dt className="text-xs text-slate-500">Thời gian nghỉ</dt>
                  <dd className="font-medium">
                    {fmtDate(String(req.details.from))} → {fmtDate(String(req.details.to))}
                  </dd>
                </div>
              )}
            </dl>
            {req.description && <p className="text-sm text-slate-700 mt-3 whitespace-pre-line">{req.description}</p>}
            {req.details.lines && req.details.lines.length > 0 && (
              <div className="border-slate-200 mt-4 overflow-x-auto rounded-md border">
                <table className="cx-table w-full">
                  <thead>
                    <tr>
                      <th>Vật tư</th>
                      <th>ĐVT</th>
                      <th className="text-right">Số lượng</th>
                      <th className="text-right">Đơn giá</th>
                      <th className="text-right">Thành tiền</th>
                    </tr>
                  </thead>
                  <tbody>
                    {req.details.lines.map((l, i) => (
                      // oxlint-disable-next-line react/no-array-index-key -- read-only, never reordered
                      <tr key={i}>
                        <td>{l.name}</td>
                        <td>{l.unit}</td>
                        <td className="text-right">{Number(l.quantity).toLocaleString("vi-VN")}</td>
                        <td className="text-right">{fmtMoney(l.unit_price)}</td>
                        <td className="text-right">{fmtMoney(l.quantity * l.unit_price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Card title="Chứng từ đính kèm">
            <Attachments entityType="approval_request" entityId={req.id} canUpload={editable} />
          </Card>
        </div>
        <Card title="Quy trình duyệt">
          {req.status === "pending" && (
            <div className="bg-amber-50 text-sm mb-4 rounded-md p-3">
              <div className="text-amber-900 font-medium">Đang chờ: {req.current_step_name}</div>
              <div className="text-xs text-amber-800">
                Người duyệt: {req.current_approvers.map((a) => a.display_name).join(", ") || "—"}
              </div>
            </div>
          )}
          <ol className="border-slate-200 relative space-y-4 border-l pl-4">
            {(req.history ?? []).map((h) => (
              <li key={h.id} className="relative">
                <span
                  className={clsx(
                    "absolute top-1.5 -left-[21px] size-2.5 rounded-full ring-4 ring-white",
                    ACTION_TONE[h.action] ?? "bg-slate-400"
                  )}
                />
                <div className="text-sm">
                  <strong>{h.action_label}</strong>
                  {h.step_name && <span className="text-slate-500"> · {h.step_name}</span>}
                </div>
                <div className="text-xs text-slate-500">
                  {h.actor_detail?.display_name ?? "Hệ thống"} · {fmtDateTime(h.created_at)}
                </div>
                {h.comment && (
                  <div className="bg-slate-50 text-sm text-slate-700 mt-1 rounded px-2 py-1">“{h.comment}”</div>
                )}
              </li>
            ))}
            {(req.history ?? []).length === 0 && <li className="text-sm text-slate-500">Chưa gửi duyệt.</li>}
          </ol>
        </Card>
      </div>
      {editing && (
        <RequestForm
          request={req}
          onClose={() => setEditing(false)}
          onSaved={(r) => {
            setEditing(false);
            setData(r);
            void reload();
          }}
        />
      )}
    </div>
  );
}
