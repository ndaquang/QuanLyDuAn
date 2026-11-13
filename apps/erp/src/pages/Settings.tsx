import { clsx } from "clsx";
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useRoles } from "@/components/pickers";
import {
  Badge,
  Button,
  Card,
  Empty,
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
import { api } from "@/lib/api";
import { useFetch } from "@/lib/hooks";
import { ACTION_LABEL, APPROVER_KIND, MODULE_LABEL, REQUEST_TYPE, labelOf } from "@/lib/labels";
import { useSession } from "@/lib/session";
import type { ApprovalStep, Role, Workflow } from "@/lib/types";

interface Perm {
  code: string;
  module: string;
  action: string;
  name: string;
}

const ACTIONS = ["view", "create", "update", "delete", "approve"];

function RoleMatrix() {
  const { ws, can } = useSession();
  const roles = useRoles();
  const catalogue = useFetch<Perm[]>(ws("/permissions/"));
  const [selected, setSelected] = useState<string>("");
  const [codes, setCodes] = useState<Set<string>>(new Set());
  const [meta, setMeta] = useState({ name: "", description: "", see_all_projects: false });
  const [creating, setCreating] = useState(false);
  const [newRole, setNewRole] = useState({ code: "", name: "" });
  const { run, busy } = useAction();
  const { confirm } = useUi();
  const editable = can("role.update");

  const role = roles.data?.find((r) => r.id === selected) ?? null;
  useEffect(() => {
    if (!selected && roles.data?.length) setSelected(roles.data[0].id);
  }, [roles.data, selected]);
  useEffect(() => {
    if (role) {
      setCodes(new Set(role.permissions));
      setMeta({ name: role.name, description: role.description, see_all_projects: role.see_all_projects });
    }
  }, [role]);

  const modules = useMemo(() => {
    const m = new Map<string, Perm[]>();
    for (const p of catalogue.data ?? []) m.set(p.module, [...(m.get(p.module) ?? []), p]);
    return [...m.entries()];
  }, [catalogue.data]);

  if (!roles.data || !catalogue.data) return <Spinner />;

  const toggle = (code: string) =>
    setCodes((s) => {
      const n = new Set(s);
      if (n.has(code)) n.delete(code);
      else n.add(code);
      return n;
    });
  const save = async () => {
    if (!role) return;
    const res = await run(
      () => api.patch<Role>(ws(`/roles/${role.id}/`), { ...meta, permission_codes: [...codes] }),
      "Đã lưu phân quyền. Có hiệu lực ngay."
    );
    if (res) void roles.reload();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-4">
      <Card
        title="Vai trò"
        bodyClassName="p-2"
        actions={
          editable && (
            <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              Thêm
            </Button>
          )
        }
      >
        <ul className="space-y-0.5">
          {roles.data.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setSelected(r.id)}
                className={clsx(
                  "text-sm flex w-full items-center justify-between rounded-md px-3 py-2 text-left",
                  r.id === selected ? "bg-navy-700 text-white" : "hover:bg-slate-100"
                )}
              >
                <span className="truncate">{r.name}</span>
                <span
                  className={clsx(
                    "text-xs shrink-0 whitespace-nowrap",
                    r.id === selected ? "text-navy-100" : "text-slate-400"
                  )}
                >
                  {r.employee_count} người
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      {role && (
        <Card
          className="lg:col-span-3"
          title={
            <span className="flex items-center gap-2">
              {role.name}
              {role.is_system && <Badge tone="navy">Mặc định</Badge>}
            </span>
          }
          actions={
            editable && (
              <>
                {!role.is_system && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Trash2 className="text-red-600 size-4" />}
                    onClick={async () => {
                      const { ok } = await confirm({
                        title: "Xóa vai trò?",
                        message: role.name,
                        danger: true,
                        confirmText: "Xóa",
                      });
                      if (ok && (await run(() => api.del(ws(`/roles/${role.id}/`)), "Đã xóa vai trò")) !== undefined) {
                        setSelected("");
                        void roles.reload();
                      }
                    }}
                  >
                    Xóa
                  </Button>
                )}
                <Button size="sm" loading={busy} icon={<Save className="size-4" />} onClick={() => void save()}>
                  Lưu phân quyền
                </Button>
              </>
            )
          }
        >
          <div className="mb-4 grid gap-3 md:grid-cols-2">
            <Field label="Tên vai trò">
              <Input
                disabled={!editable}
                value={meta.name}
                onChange={(e) => setMeta((m) => ({ ...m, name: e.target.value }))}
              />
            </Field>
            <Field group label="Phạm vi dự án">
              <label className="text-sm flex h-9 items-center gap-2">
                <input
                  type="checkbox"
                  disabled={!editable}
                  checked={meta.see_all_projects}
                  onChange={(e) => setMeta((m) => ({ ...m, see_all_projects: e.target.checked }))}
                />
                Xem được tất cả dự án (không cần là thành viên)
              </label>
            </Field>
            <Field label="Mô tả" className="md:col-span-2">
              <Textarea
                rows={2}
                disabled={!editable}
                value={meta.description}
                onChange={(e) => setMeta((m) => ({ ...m, description: e.target.value }))}
              />
            </Field>
          </div>
          <div className="overflow-x-auto">
            <table className="cx-table w-full">
              <thead>
                <tr>
                  <th>Phân hệ</th>
                  {ACTIONS.map((a) => (
                    <th key={a} className="text-center">
                      {ACTION_LABEL[a]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {modules.map(([module, perms]) => (
                  <tr key={module}>
                    <td className="font-medium">{MODULE_LABEL[module] ?? module}</td>
                    {ACTIONS.map((a) => {
                      const p = perms.find((x) => x.action === a);
                      return (
                        <td key={a} className="text-center">
                          {p ? (
                            <input
                              type="checkbox"
                              aria-label={p.name}
                              disabled={!editable}
                              checked={codes.has(p.code)}
                              onChange={() => toggle(p.code)}
                              className="accent-navy-700 size-4"
                            />
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500 mt-3">
            Quyền được kiểm tra ở máy chủ cho mọi thao tác. Quản trị viên công ty (admin Plane) luôn có toàn quyền.
            Ngoài quyền theo vai trò, nhân sự chỉ thấy dữ liệu của dự án mình là thành viên (trừ vai trò được xem tất cả
            dự án).
          </p>
        </Card>
      )}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        size="sm"
        title="Thêm vai trò"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              Hủy
            </Button>
            <Button
              loading={busy}
              onClick={async () => {
                const r = await run(
                  () =>
                    api.post<Role>(ws("/roles/"), { ...newRole, permission_codes: ["dashboard.view", "project.view"] }),
                  "Đã tạo vai trò"
                );
                if (r) {
                  setCreating(false);
                  setNewRole({ code: "", name: "" });
                  await roles.reload();
                  setSelected(r.id);
                }
              }}
            >
              Tạo
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Mã (không dấu, gạch dưới)" required>
            <Input
              value={newRole.code}
              onChange={(e) =>
                setNewRole((r) => ({ ...r, code: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") }))
              }
              placeholder="vd: site_manager"
            />
          </Field>
          <Field label="Tên vai trò" required>
            <Input
              value={newRole.name}
              onChange={(e) => setNewRole((r) => ({ ...r, name: e.target.value }))}
              placeholder="vd: Chỉ huy trưởng công trường"
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

function WorkflowEditor({ workflow, roles, onSaved }: { workflow: Workflow; roles: Role[]; onSaved: () => void }) {
  const { ws, can } = useSession();
  type EditableStep = ApprovalStep & { key: string };
  const [steps, setSteps] = useState<EditableStep[]>(() =>
    workflow.steps.map((st) => ({ ...st, key: st.id ?? crypto.randomUUID() }))
  );
  const [active, setActive] = useState(workflow.is_active);
  const { run, busy } = useAction();
  const editable = can("approval_config.update");
  const upd = (i: number, patch: Partial<EditableStep>) =>
    setSteps((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: number) =>
    setSteps((s) => {
      const n = [...s];
      const [x] = n.splice(i, 1);
      n.splice(i + d, 0, x);
      return n;
    });
  const save = async () => {
    const body = {
      is_active: active,
      steps: steps.map((s, i) => ({
        ...s,
        order: i + 1,
        min_amount: s.min_amount === "" ? null : s.min_amount,
        approver_role: s.approver_kind === "role" ? s.approver_role : null,
      })),
    };
    if (await run(() => api.patch(ws(`/approval-workflows/${workflow.id}/`), body), "Đã lưu luồng phê duyệt"))
      onSaved();
  };
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {workflow.name}{" "}
          <span className="text-xs font-normal text-slate-500">({labelOf(REQUEST_TYPE, workflow.request_type)})</span>
          {workflow.is_financial && <Badge tone="amber">Tài chính</Badge>}
        </span>
      }
      actions={
        editable && (
          <>
            <label className="text-sm flex items-center gap-1.5">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Đang áp dụng
            </label>
            <Button size="sm" loading={busy} icon={<Save className="size-4" />} onClick={() => void save()}>
              Lưu
            </Button>
          </>
        )
      }
      bodyClassName="p-0"
    >
      <div className="overflow-x-auto">
        <table className="cx-table w-full">
          <thead>
            <tr>
              <th>#</th>
              <th>Tên bước</th>
              <th>Người duyệt</th>
              <th>Vai trò</th>
              <th>Áp dụng khi số tiền ≥</th>
              <th>Kiểm tra ngân sách</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {steps.map((s, i) => (
              <tr key={s.id ?? s.key}>
                <td>{i + 1}</td>
                <td>
                  <Input
                    disabled={!editable}
                    value={s.name}
                    onChange={(e) => upd(i, { name: e.target.value })}
                    className="min-w-44"
                  />
                </td>
                <td>
                  <Select
                    disabled={!editable}
                    options={APPROVER_KIND}
                    value={s.approver_kind}
                    onChange={(e) => upd(i, { approver_kind: e.target.value })}
                    className="min-w-52"
                  />
                </td>
                <td>
                  {s.approver_kind === "role" ? (
                    <Select
                      disabled={!editable}
                      placeholder="— Vai trò —"
                      options={roles.map((r) => ({ value: r.id, label: r.name }))}
                      value={s.approver_role ?? ""}
                      onChange={(e) => upd(i, { approver_role: e.target.value })}
                      className="min-w-40"
                    />
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td>
                  <Input
                    disabled={!editable}
                    type="number"
                    min={0}
                    placeholder="Luôn áp dụng"
                    value={s.min_amount ?? ""}
                    onChange={(e) => upd(i, { min_amount: e.target.value })}
                    className="w-40"
                  />
                </td>
                <td className="text-center">
                  <input
                    type="checkbox"
                    disabled={!editable}
                    checked={s.requires_budget_check}
                    onChange={(e) => upd(i, { requires_budget_check: e.target.checked })}
                  />
                </td>
                <td>
                  {editable && (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        aria-label="Lên"
                        disabled={i === 0}
                        className="text-slate-400 hover:text-navy-700 disabled:opacity-30"
                        onClick={() => move(i, -1)}
                      >
                        <ArrowUp className="size-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="Xuống"
                        disabled={i === steps.length - 1}
                        className="text-slate-400 hover:text-navy-700 disabled:opacity-30"
                        onClick={() => move(i, 1)}
                      >
                        <ArrowDown className="size-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="Xóa bước"
                        className="text-slate-400 hover:text-red-600"
                        onClick={() => setSteps((x) => x.filter((_, j) => j !== i))}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editable && (
        <div className="p-3">
          <Button
            size="sm"
            variant="secondary"
            icon={<Plus className="size-4" />}
            onClick={() =>
              setSteps((s) => [
                ...s,
                {
                  key: crypto.randomUUID(),
                  order: s.length + 1,
                  name: "",
                  approver_kind: "role",
                  approver_role: null,
                  min_amount: null,
                  requires_budget_check: false,
                },
              ])
            }
          >
            Thêm bước
          </Button>
        </div>
      )}
    </Card>
  );
}

function Workflows() {
  const { ws } = useSession();
  const { data, reload } = useFetch<Workflow[]>(ws("/approval-workflows/"));
  const roles = useRoles();
  if (!data || !roles.data) return <Spinner />;
  if (data.length === 0) return <Empty>Chưa có luồng phê duyệt.</Empty>;
  return (
    <div className="space-y-4">
      <p className="bg-brand-50 text-sm text-brand-700 rounded-md p-3">
        Các bước chạy theo thứ tự. Bước có "số tiền ≥" chỉ áp dụng khi yêu cầu đạt hạn mức (vd. Giám đốc duyệt từ 50
        triệu). Yêu cầu tài chính không bao giờ được duyệt tự động: thiếu người duyệt ở bất kỳ bước nào thì không gửi
        được.
      </p>
      {data.map((w) => (
        <WorkflowEditor key={w.id} workflow={w} roles={roles.data!} onSaved={() => void reload()} />
      ))}
    </div>
  );
}

export function SettingsPage() {
  const { can } = useSession();
  const tabs = [
    ...(can("role.view") ? [{ value: "roles", label: "Vai trò & phân quyền" }] : []),
    ...(can("approval_config.view") ? [{ value: "workflows", label: "Luồng phê duyệt" }] : []),
  ];
  const [tab, setTab] = useState(tabs[0]?.value ?? "roles");
  return (
    <div>
      <PageHeader
        title="Cài đặt & phân quyền"
        subtitle="Ma trận quyền Xem / Thêm / Sửa / Xóa / Duyệt theo vai trò; cấu hình luồng phê duyệt"
      />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === "roles" ? <RoleMatrix /> : <Workflows />}
    </div>
  );
}
