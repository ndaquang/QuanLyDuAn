import { Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { DataTable, ListFooter, Toolbar, type Column } from "@/components/DataTable";
import { clean, useForm } from "@/components/form";
import { DepartmentSelect, UserSelect, useUsers } from "@/components/pickers";
import { Badge, Button, Card, Field, Input, Modal, PageHeader, ProgressBar, Select, Textarea } from "@/components/ui";
import { api, downloadExport } from "@/lib/api";
import { fmtDate, fmtMoney } from "@/lib/format";
import { useList } from "@/lib/hooks";
import { PROJECT_STATUS, PROJECT_TYPE, labelOf, toneOf } from "@/lib/labels";
import { useSession } from "@/lib/session";
import type { Project } from "@/lib/types";

export function ProjectForm({
  project,
  open,
  onClose,
  onSaved,
}: {
  project?: Project | null;
  open: boolean;
  onClose: () => void;
  onSaved: (p: Project) => void;
}) {
  const { ws } = useSession();
  const users = useUsers();
  const form = useForm({
    code: project?.code ?? "",
    name: project?.name ?? "",
    investor: project?.investor ?? "",
    location: project?.location ?? "",
    project_type: project?.project_type ?? "civil",
    start_date: project?.start_date ?? "",
    planned_end_date: project?.planned_end_date ?? "",
    actual_end_date: project?.actual_end_date ?? "",
    manager: project?.manager ?? "",
    department: project?.department ?? "",
    status: project?.status ?? "in_progress",
    contract_value: project?.contract_value ?? "0",
    description: project?.description ?? "",
    member_ids: (project?.members ?? []).map((m) => m.id) as string[],
  });
  const { values, bind, errors, set } = form;
  const save = () =>
    form
      .submit(
        (v) =>
          project
            ? api.patch<Project>(ws(`/projects/${project.id}/`), clean(v))
            : api.post<Project>(ws("/projects/"), clean(v)),
        project ? "Đã cập nhật dự án" : "Đã tạo dự án"
      )
      .then((p) => p && onSaved(p));

  const toggleMember = (id: string) =>
    set(
      "member_ids",
      values.member_ids.includes(id) ? values.member_ids.filter((x) => x !== id) : [...values.member_ids, id]
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={project ? `Sửa dự án ${project.code}` : "Thêm dự án mới"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button loading={form.saving} onClick={() => void save()}>
            Lưu dự án
          </Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Mã dự án" required error={errors.code}>
          <Input {...bind("code")} placeholder="VD: DA-2601" />
        </Field>
        <Field label="Tên công trình" required error={errors.project || errors.name}>
          <Input {...bind("name")} />
        </Field>
        <Field label="Chủ đầu tư" required error={errors.investor}>
          <Input {...bind("investor")} />
        </Field>
        <Field label="Địa điểm xây dựng" error={errors.location}>
          <Input {...bind("location")} />
        </Field>
        <Field label="Loại công trình" error={errors.project_type}>
          <Select options={PROJECT_TYPE} {...bind("project_type")} />
        </Field>
        <Field label="Trạng thái" error={errors.status}>
          <Select options={PROJECT_STATUS} {...bind("status")} />
        </Field>
        <Field label="Ngày bắt đầu" required error={errors.start_date}>
          <Input type="date" {...bind("start_date")} />
        </Field>
        <Field label="Ngày kết thúc dự kiến" required error={errors.planned_end_date}>
          <Input type="date" {...bind("planned_end_date")} />
        </Field>
        {project && (
          <Field label="Ngày hoàn thành thực tế" error={errors.actual_end_date}>
            <Input type="date" {...bind("actual_end_date")} />
          </Field>
        )}
        <Field label="Người phụ trách" required error={errors.manager}>
          <UserSelect {...bind("manager")} />
        </Field>
        <Field label="Phòng ban phụ trách" error={errors.department}>
          <DepartmentSelect {...bind("department")} />
        </Field>
        <Field label="Giá trị hợp đồng (VNĐ)" error={errors.contract_value}>
          <Input type="number" min={0} step={1000} {...bind("contract_value")} />
        </Field>
        <Field label="Mô tả" className="md:col-span-2" error={errors.description}>
          <Textarea {...bind("description")} />
        </Field>
        <Field
          group
          label="Thành viên tham gia"
          className="md:col-span-2"
          error={errors.member_ids}
          hint="Chỉ thành viên mới xem được dữ liệu của dự án (trừ Giám đốc, Trưởng phòng dự án, Nhân sự, Kế toán)."
        >
          <div className="border-slate-200 grid max-h-48 gap-1 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">
            {(users.data ?? []).map((u) => (
              <label key={u.id} className="text-sm hover:bg-slate-50 flex items-center gap-2 rounded px-2 py-1">
                <input type="checkbox" checked={values.member_ids.includes(u.id)} onChange={() => toggleMember(u.id)} />
                <span className="truncate">{u.full_name || u.display_name}</span>
                <span className="text-xs text-slate-400 truncate">{u.role}</span>
              </label>
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  );
}

export function ProjectsPage() {
  const { ws, can } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const list = useList<Project>(ws("/projects/"), {
    status: params.get("status") ?? "",
    project_type: "",
    department: "",
  });
  const [creating, setCreating] = useState(false);

  const columns: Column<Project>[] = [
    { key: "code", header: "Mã", render: (p) => <span className="text-navy-700 font-medium">{p.code}</span> },
    {
      key: "name",
      header: "Tên công trình",
      render: (p) => (
        <div className="max-w-64">
          <div className="truncate font-medium">{p.name}</div>
          <div className="text-xs text-slate-500 truncate">{p.location}</div>
        </div>
      ),
    },
    { key: "investor", header: "Chủ đầu tư", hideOnMobile: true },
    {
      key: "status",
      header: "Trạng thái",
      render: (p) => (
        <div className="flex flex-col gap-1">
          <Badge tone={toneOf(PROJECT_STATUS, p.status)}>{labelOf(PROJECT_STATUS, p.status)}</Badge>
          {p.progress?.is_behind && p.status !== "delayed" && <Badge tone="red">Chậm so với KH</Badge>}
        </div>
      ),
    },
    {
      key: "progress",
      header: "Tiến độ (thực tế | KH)",
      render: (p) =>
        p.progress ? <ProgressBar value={p.progress.actual} planned={p.progress.planned} className="w-40" /> : "—",
    },
    { key: "manager", header: "Phụ trách", hideOnMobile: true, render: (p) => p.manager_detail?.display_name ?? "—" },
    {
      key: "dates",
      header: "Thời gian",
      hideOnMobile: true,
      render: (p) => (
        <span className="text-xs whitespace-nowrap">
          {fmtDate(p.start_date)} → {fmtDate(p.planned_end_date)}
        </span>
      ),
    },
    {
      key: "contract_value",
      header: "Giá trị HĐ",
      hideOnMobile: true,
      className: "text-right",
      render: (p) => <span className="tabular-nums">{fmtMoney(p.contract_value)}</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Dự án & công trình"
        subtitle="Mỗi dự án có hồ sơ riêng: tiến độ, công việc, nhân sự, hồ sơ kỹ thuật, báo cáo"
        actions={
          can("project.create") && (
            <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              Thêm dự án
            </Button>
          )
        }
      />
      <Card bodyClassName="p-0">
        <Toolbar
          q={list.q}
          onQ={list.setQ}
          placeholder="Tìm mã, tên, chủ đầu tư..."
          onExport={() => downloadExport(ws("/projects/"), list.query)}
        >
          <Select
            className="w-full sm:w-44"
            placeholder="Mọi trạng thái"
            options={PROJECT_STATUS}
            value={String(list.filters.status ?? "")}
            onChange={(e) => list.setFilter("status", e.target.value)}
          />
          <Select
            className="w-full sm:w-48"
            placeholder="Mọi loại công trình"
            options={PROJECT_TYPE}
            value={String(list.filters.project_type ?? "")}
            onChange={(e) => list.setFilter("project_type", e.target.value)}
          />
          <DepartmentSelect
            className="w-full sm:w-48"
            placeholder="Mọi phòng ban"
            value={String(list.filters.department ?? "")}
            onChange={(e) => list.setFilter("department", e.target.value)}
          />
        </Toolbar>
        <DataTable
          columns={columns}
          rows={list.data?.results}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          onRowClick={(p) => navigate(`/projects/${p.id}`)}
          empty="Chưa có dự án nào."
        />
        <ListFooter data={list.data} setPage={list.setPage} />
      </Card>
      {creating && (
        <ProjectForm open onClose={() => setCreating(false)} onSaved={(p) => navigate(`/projects/${p.id}`)} />
      )}
    </div>
  );
}
