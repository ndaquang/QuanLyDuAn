import { ArrowLeft, Camera, ImagePlus, KeyRound, Pencil, Plus, Trash2, UserPlus } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { DataTable, ListFooter, Toolbar, type Column } from "@/components/DataTable";
import { clean, useForm } from "@/components/form";
import { DepartmentSelect, RoleSelect, UserSelect } from "@/components/pickers";
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
import { fmtDate } from "@/lib/format";
import { useFetch, useList } from "@/lib/hooks";
import { EMPLOYEE_STATUS, labelOf, toneOf } from "@/lib/labels";
import { useSession } from "@/lib/session";
import type { Department, Employee } from "@/lib/types";

function EmployeeForm({
  employee,
  onClose,
  onSaved,
}: {
  employee?: Employee | null;
  onClose: () => void;
  onSaved: (e: Employee) => void;
}) {
  const { ws, can } = useSession();
  const form = useForm({
    code: employee?.code ?? "",
    full_name: employee?.full_name ?? "",
    email: employee?.email ?? "",
    phone: employee?.phone ?? "",
    position: employee?.position ?? "",
    department: employee?.department ?? "",
    role: employee?.role ?? "",
    status: employee?.status ?? "active",
    date_of_birth: employee?.date_of_birth ?? "",
    join_date: employee?.join_date ?? "",
    id_number: employee?.id_number ?? "",
    address: employee?.address ?? "",
    notes: employee?.notes ?? "",
  });
  const { bind, errors } = form;
  const save = () =>
    form
      .submit(
        (v) => {
          const body = clean(v);
          if (!can("role.update")) delete body.role;
          return employee
            ? api.patch<Employee>(ws(`/employees/${employee.id}/`), body)
            : api.post<Employee>(ws("/employees/"), body);
        },
        employee ? "Đã cập nhật hồ sơ" : "Đã thêm nhân sự"
      )
      .then((e) => e && onSaved(e));
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={employee ? `Sửa hồ sơ ${employee.full_name}` : "Thêm nhân sự"}
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
        <Field label="Mã nhân viên" required error={errors.code}>
          <Input {...bind("code")} />
        </Field>
        <Field label="Họ và tên" required error={errors.full_name}>
          <Input {...bind("full_name")} />
        </Field>
        <Field label="Chức vụ" error={errors.position}>
          <Input {...bind("position")} placeholder="VD: Kỹ sư giám sát" />
        </Field>
        <Field label="Phòng ban" error={errors.department}>
          <DepartmentSelect {...bind("department")} />
        </Field>
        <Field
          label="Vai trò hệ thống (phân quyền)"
          error={errors.role}
          hint={
            can("role.update")
              ? "Quyết định nhân sự được xem / sửa / duyệt những gì"
              : "Chỉ người có quyền phân quyền mới đổi được"
          }
        >
          <RoleSelect disabled={!can("role.update")} {...bind("role")} />
        </Field>
        <Field label="Trạng thái" error={errors.status}>
          <Select options={EMPLOYEE_STATUS} {...bind("status")} />
        </Field>
        <Field label="Điện thoại" error={errors.phone}>
          <Input type="tel" {...bind("phone")} />
        </Field>
        <Field label="Email" error={errors.email}>
          <Input type="email" {...bind("email")} />
        </Field>
        <Field label="Ngày sinh" error={errors.date_of_birth}>
          <Input type="date" {...bind("date_of_birth")} />
        </Field>
        <Field label="Ngày vào làm" error={errors.join_date}>
          <Input type="date" {...bind("join_date")} />
        </Field>
        <Field label="Số CCCD" error={errors.id_number}>
          <Input {...bind("id_number")} />
        </Field>
        <Field label="Địa chỉ" error={errors.address}>
          <Input {...bind("address")} />
        </Field>
        <Field label="Ghi chú" className="md:col-span-2">
          <Textarea {...bind("notes")} />
        </Field>
      </div>
    </Modal>
  );
}

function DepartmentModal({
  dept,
  onClose,
  onSaved,
}: {
  dept: Department | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { ws } = useSession();
  const form = useForm({
    code: dept?.code ?? "",
    name: dept?.name ?? "",
    head: dept?.head ?? "",
    description: dept?.description ?? "",
  });
  const save = () =>
    form
      .submit(
        (v) => (dept ? api.patch(ws(`/departments/${dept.id}/`), clean(v)) : api.post(ws("/departments/"), clean(v))),
        "Đã lưu phòng ban"
      )
      .then((r) => r && onSaved());
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={dept ? "Sửa phòng ban" : "Thêm phòng ban"}
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
        <Field label="Mã" required error={form.errors.code}>
          <Input {...form.bind("code")} />
        </Field>
        <Field label="Tên phòng ban" required error={form.errors.name}>
          <Input {...form.bind("name")} />
        </Field>
        <Field
          label="Trưởng phòng"
          error={form.errors.head}
          hint="Người duyệt bước 'Trưởng bộ phận' trong luồng phê duyệt"
        >
          <UserSelect {...form.bind("head")} />
        </Field>
        <Field label="Mô tả">
          <Textarea {...form.bind("description")} />
        </Field>
      </div>
    </Modal>
  );
}

function Departments() {
  const { ws, can } = useSession();
  const list = useList<Department>(ws("/departments/"), {}, 100);
  const [editing, setEditing] = useState<Department | null | undefined>(undefined);
  const { confirm } = useUi();
  const { run } = useAction();
  const columns: Column<Department>[] = [
    { key: "code", header: "Mã" },
    { key: "name", header: "Tên phòng ban", render: (d) => <span className="font-medium">{d.name}</span> },
    { key: "head", header: "Trưởng phòng", render: (d) => d.head_detail?.display_name ?? "—" },
    { key: "count", header: "Số nhân sự", render: (d) => d.employee_count },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (d) => (
        <div className="flex justify-end gap-1">
          {can("department.update") && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Pencil className="size-4" />}
              onClick={(e) => {
                e.stopPropagation();
                setEditing(d);
              }}
              aria-label="Sửa"
            />
          )}
          {can("department.delete") && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 className="text-red-600 size-4" />}
              aria-label="Xóa"
              onClick={async (e) => {
                e.stopPropagation();
                const { ok } = await confirm({
                  title: "Xóa phòng ban?",
                  message: d.name,
                  danger: true,
                  confirmText: "Xóa",
                });
                if (ok) {
                  await run(() => api.del(ws(`/departments/${d.id}/`)), "Đã xóa phòng ban");
                  void list.reload();
                }
              }}
            />
          )}
        </div>
      ),
    },
  ];
  return (
    <Card bodyClassName="p-0">
      <Toolbar
        q={list.q}
        onQ={list.setQ}
        onExport={() => downloadExport(ws("/departments/"), list.query)}
        right={
          can("department.create") && (
            <Button icon={<Plus className="size-4" />} onClick={() => setEditing(null)}>
              Thêm phòng ban
            </Button>
          )
        }
      />
      <DataTable
        columns={columns}
        rows={list.data?.results}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
      />
      {editing !== undefined && (
        <DepartmentModal
          dept={editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            void list.reload();
          }}
        />
      )}
    </Card>
  );
}

export function EmployeesPage() {
  const { ws, can } = useSession();
  const navigate = useNavigate();
  const [tab, setTab] = useState("employees");
  const list = useList<Employee>(ws("/employees/"), { department: "", role: "", status: "active" });
  const [creating, setCreating] = useState(false);
  const columns: Column<Employee>[] = [
    {
      key: "name",
      header: "Nhân sự",
      render: (e) => (
        <div className="flex items-center gap-3">
          {e.photo_url ? (
            <img src={e.photo_url} alt="" className="size-9 rounded-full object-cover" />
          ) : (
            <span className="bg-navy-100 text-xs text-navy-700 flex size-9 items-center justify-center rounded-full font-semibold">
              {e.full_name.split(" ").slice(-1)[0]?.[0]}
            </span>
          )}
          <div>
            <div className="font-medium">{e.full_name}</div>
            <div className="text-xs text-slate-500">{e.code}</div>
          </div>
        </div>
      ),
    },
    { key: "position", header: "Chức vụ", hideOnMobile: true, render: (e) => e.position || "—" },
    { key: "department", header: "Phòng ban", render: (e) => e.department_name ?? "—" },
    {
      key: "role",
      header: "Vai trò hệ thống",
      hideOnMobile: true,
      render: (e) => e.role_name ?? <span className="text-amber-700">Chưa phân quyền</span>,
    },
    {
      key: "projects",
      header: "Dự án đang tham gia",
      hideOnMobile: true,
      render: (e) => <span className="text-xs">{e.projects.map((p) => p.code).join(", ") || "—"}</span>,
    },
    { key: "phone", header: "Điện thoại", hideOnMobile: true, render: (e) => e.phone || "—" },
    {
      key: "status",
      header: "Trạng thái",
      render: (e) => (
        <div className="flex flex-col gap-1">
          <Badge tone={toneOf(EMPLOYEE_STATUS, e.status)}>{labelOf(EMPLOYEE_STATUS, e.status)}</Badge>
          {!e.user && <Badge tone="gray">Chưa có tài khoản</Badge>}
        </div>
      ),
    },
  ];
  return (
    <div>
      <PageHeader
        title="Nhân sự & phòng ban"
        subtitle="Hồ sơ nhân sự, chức vụ, phòng ban, dự án đang tham gia"
        actions={
          tab === "employees" &&
          can("employee.create") && (
            <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              Thêm nhân sự
            </Button>
          )
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "employees", label: "Danh sách nhân sự" },
          { value: "departments", label: "Phòng ban" },
        ]}
      />
      {tab === "employees" ? (
        <Card bodyClassName="p-0">
          <Toolbar
            q={list.q}
            onQ={list.setQ}
            placeholder="Tìm tên, mã, SĐT, email..."
            onExport={() => downloadExport(ws("/employees/"), list.query)}
          >
            <DepartmentSelect
              className="w-full sm:w-48"
              placeholder="Mọi phòng ban"
              value={String(list.filters.department ?? "")}
              onChange={(e) => list.setFilter("department", e.target.value)}
            />
            <RoleSelect
              className="w-full sm:w-48"
              placeholder="Mọi vai trò"
              value={String(list.filters.role ?? "")}
              onChange={(e) => list.setFilter("role", e.target.value)}
            />
            <Select
              className="w-full sm:w-40"
              placeholder="Mọi trạng thái"
              options={EMPLOYEE_STATUS}
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
            onRowClick={(e) => navigate(`/employees/${e.id}`)}
          />
          <ListFooter data={list.data} setPage={list.setPage} />
        </Card>
      ) : (
        <Departments />
      )}
      {creating && <EmployeeForm onClose={() => setCreating(false)} onSaved={(e) => navigate(`/employees/${e.id}`)} />}
    </div>
  );
}

export function EmployeeDetailPage() {
  const { id } = useParams();
  const { ws, can } = useSession();
  const navigate = useNavigate();
  const { confirm, toast } = useUi();
  const { run, busy } = useAction();
  const { data: emp, error, loading, reload, setData } = useFetch<Employee>(ws(`/employees/${id}/`));
  const [editing, setEditing] = useState(false);
  const [account, setAccount] = useState<"create" | "reset" | null>(null);
  const [accountForm, setAccountForm] = useState({ email: "", password: "" });
  const camRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading || !emp) return <Spinner />;

  const uploadPhoto = async (files: FileList | null) => {
    if (!files?.[0]) return;
    const form = new FormData();
    form.set("file", files[0]);
    const res = await run(() => api.upload<Employee>(ws(`/employees/${emp.id}/photo/`), form), "Đã cập nhật ảnh");
    if (res) setData(res);
  };
  const remove = async () => {
    const { ok } = await confirm({
      title: "Xóa hồ sơ nhân sự?",
      message: `${emp.full_name} sẽ bị xóa khỏi danh sách (lịch sử vẫn được lưu). Nên chuyển trạng thái 'Đã nghỉ việc' thay vì xóa.`,
      danger: true,
      confirmText: "Xóa",
    });
    if (ok && (await run(() => api.del(ws(`/employees/${emp.id}/`)), "Đã xóa")) !== undefined) navigate("/employees");
  };
  const submitAccount = async () => {
    if (account === "create") {
      const res = await run(
        () => api.post<Employee>(ws(`/employees/${emp.id}/create-account/`), accountForm),
        "Đã tạo tài khoản đăng nhập"
      );
      if (res) {
        setData(res);
        setAccount(null);
      }
    } else {
      const res = await run(() =>
        api.post(ws(`/employees/${emp.id}/reset-password/`), { password: accountForm.password })
      );
      if (res !== undefined) {
        toast("Đã đặt lại mật khẩu");
        setAccount(null);
      }
    }
  };

  return (
    <div className="space-y-4">
      <Link
        to="/employees"
        className="no-print text-sm text-slate-500 hover:text-brand-700 inline-flex items-center gap-1"
      >
        <ArrowLeft className="size-4" /> Danh sách nhân sự
      </Link>
      <PageHeader
        title={emp.full_name}
        subtitle={`${emp.code} · ${emp.position || "—"} · ${emp.department_name ?? "Chưa có phòng ban"}`}
        actions={
          <>
            {!emp.user && can("account.create") && (
              <Button
                variant="secondary"
                icon={<UserPlus className="size-4" />}
                onClick={() => {
                  setAccountForm({ email: emp.email, password: "" });
                  setAccount("create");
                }}
              >
                Tạo tài khoản
              </Button>
            )}
            {emp.user && can("account.update") && (
              <Button
                variant="secondary"
                icon={<KeyRound className="size-4" />}
                onClick={() => {
                  setAccountForm({ email: "", password: "" });
                  setAccount("reset");
                }}
              >
                Đặt lại mật khẩu
              </Button>
            )}
            {can("employee.update") && (
              <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
                Sửa
              </Button>
            )}
            {can("employee.delete") && (
              <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => void remove()}>
                Xóa
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Ảnh nhân sự">
          <div className="flex flex-col items-center gap-3">
            {emp.photo_url ? (
              <img src={emp.photo_url} alt={emp.full_name} className="size-40 rounded-lg object-cover" />
            ) : (
              <div className="bg-navy-50 text-4xl text-navy-700 flex size-40 items-center justify-center rounded-lg font-semibold">
                {emp.full_name.split(" ").slice(-1)[0]?.[0]}
              </div>
            )}
            {can("employee.update") && (
              <div className="no-print flex gap-2">
                <input
                  ref={camRef}
                  type="file"
                  accept="image/*"
                  capture="user"
                  hidden
                  onChange={(e) => void uploadPhoto(e.target.files)}
                />
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => void uploadPhoto(e.target.files)}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  loading={busy}
                  icon={<Camera className="size-4" />}
                  onClick={() => camRef.current?.click()}
                >
                  Chụp ảnh
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  icon={<ImagePlus className="size-4" />}
                  onClick={() => fileRef.current?.click()}
                >
                  Chọn ảnh
                </Button>
              </div>
            )}
          </div>
        </Card>
        <Card title="Thông tin" className="lg:col-span-2">
          <dl className="text-sm grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {[
              ["Vai trò hệ thống", emp.role_name ?? "Chưa phân quyền"],
              ["Trạng thái", labelOf(EMPLOYEE_STATUS, emp.status)],
              ["Tài khoản đăng nhập", emp.user_detail?.email ?? "Chưa có"],
              ["Điện thoại", emp.phone || "—"],
              ["Email", emp.email || "—"],
              ["Ngày sinh", fmtDate(emp.date_of_birth)],
              ["Ngày vào làm", fmtDate(emp.join_date)],
              ["Số CCCD", emp.id_number || "—"],
              ["Địa chỉ", emp.address || "—"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-slate-500">{k}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          {emp.notes && <p className="border-slate-100 text-sm text-slate-600 mt-3 border-t pt-3">{emp.notes}</p>}
        </Card>
      </div>
      <Card title={`Dự án đang tham gia (${emp.projects.length})`}>
        {emp.projects.length === 0 ? (
          <p className="text-sm text-slate-500">Chưa tham gia dự án nào.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {emp.projects.map((p) => (
              <Link
                key={p.id}
                to={`/projects/${p.id}`}
                className="border-slate-200 text-sm hover:border-brand-500 hover:text-brand-700 rounded-md border px-3 py-1.5"
              >
                {p.code} · {p.name}
              </Link>
            ))}
          </div>
        )}
      </Card>
      {editing && (
        <EmployeeForm
          employee={emp}
          onClose={() => setEditing(false)}
          onSaved={(e) => {
            setEditing(false);
            setData(e);
          }}
        />
      )}
      <Modal
        open={account !== null}
        onClose={() => setAccount(null)}
        size="sm"
        title={account === "create" ? "Tạo tài khoản đăng nhập" : "Đặt lại mật khẩu"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAccount(null)}>
              Hủy
            </Button>
            <Button loading={busy} onClick={() => void submitAccount()}>
              Xác nhận
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {account === "create" && (
            <Field label="Email đăng nhập" required>
              <Input
                type="email"
                value={accountForm.email}
                onChange={(e) => setAccountForm((f) => ({ ...f, email: e.target.value }))}
              />
            </Field>
          )}
          <Field
            label={account === "create" ? "Mật khẩu ban đầu" : "Mật khẩu mới"}
            required
            hint="Tối thiểu 8 ký tự, không quá đơn giản. Gửi riêng cho nhân sự và yêu cầu đổi sau khi đăng nhập."
          >
            <Input
              type="text"
              autoComplete="new-password"
              value={accountForm.password}
              onChange={(e) => setAccountForm((f) => ({ ...f, password: e.target.value }))}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
