import { Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import { api, downloadExport } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useList } from "@/lib/hooks";
import { PRIORITY, TASK_STATUS, labelOf, toneOf } from "@/lib/labels";
import { useSession } from "@/lib/session";
import type { Task } from "@/lib/types";

import { DataTable, ListFooter, Toolbar, type Column } from "./DataTable";
import { useForm } from "./form";
import { ProjectSelect, useUsers } from "./pickers";
import { Badge, Button, Card, Field, Input, Modal, Select, Tabs, Textarea } from "./ui";

export function TaskForm({
  task,
  projectId,
  onClose,
  onSaved,
}: {
  task?: Task | null;
  projectId?: string;
  onClose: () => void;
  onSaved: (t: Task) => void;
}) {
  const { ws } = useSession();
  const form = useForm({
    project: task?.project ?? projectId ?? "",
    title: task?.title ?? "",
    description: task?.description ?? "",
    assignee_ids: (task?.assignees ?? []).map((a) => a.id) as string[],
    start_date: task?.start_date ?? "",
    due_date: task?.due_date ?? "",
    priority: task?.priority ?? "medium",
    status: task?.status ?? "todo",
  });
  const { values, bind, errors, set } = form;
  const members = useUsers(values.project || null);
  const save = () =>
    form
      .submit(
        (v) => {
          const body = { ...v, start_date: v.start_date || null, due_date: v.due_date || null };
          return task ? api.patch<Task>(ws(`/tasks/${task.id}/`), body) : api.post<Task>(ws("/tasks/"), body);
        },
        task ? "Đã cập nhật công việc" : "Đã giao việc"
      )
      .then((t) => t && onSaved(t));
  return (
    <Modal
      open
      onClose={onClose}
      title={task ? `Sửa công việc ${task.key}` : "Giao việc mới"}
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
        <Field label="Tiêu đề" required error={errors.title} className="md:col-span-2">
          <Input {...bind("title")} />
        </Field>
        <Field label="Dự án" required error={errors.project}>
          <ProjectSelect disabled={Boolean(task || projectId)} {...bind("project")} />
        </Field>
        <Field label="Độ ưu tiên" error={errors.priority}>
          <Select options={PRIORITY} {...bind("priority")} />
        </Field>
        <Field label="Ngày bắt đầu" error={errors.start_date}>
          <Input type="date" {...bind("start_date")} />
        </Field>
        <Field label="Hạn hoàn thành" error={errors.due_date}>
          <Input type="date" {...bind("due_date")} />
        </Field>
        <Field label="Trạng thái" error={errors.status}>
          <Select options={TASK_STATUS} {...bind("status")} />
        </Field>
        <Field label="Mô tả" className="md:col-span-2" error={errors.description}>
          <Textarea rows={4} {...bind("description")} />
        </Field>
        <Field
          group
          label="Người thực hiện"
          className="md:col-span-2"
          error={errors.assignee_ids}
          hint={values.project ? "Chỉ thành viên dự án" : "Chọn dự án trước"}
        >
          <div className="border-slate-200 grid max-h-40 gap-1 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">
            {(members.data ?? []).map((u) => (
              <label key={u.id} className="text-sm hover:bg-slate-50 flex items-center gap-2 rounded px-2 py-1">
                <input
                  type="checkbox"
                  checked={values.assignee_ids.includes(u.id)}
                  onChange={() =>
                    set(
                      "assignee_ids",
                      values.assignee_ids.includes(u.id)
                        ? values.assignee_ids.filter((x) => x !== u.id)
                        : [...values.assignee_ids, u.id]
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

const scopeFilters = (scope: string) => ({
  assignee: scope === "mine" ? "me" : "",
  created_by: scope === "created" ? "me" : "",
});

export function TaskList({
  projectId,
  initialScope = "mine",
  initialOverdue = false,
}: {
  projectId?: string;
  initialScope?: string;
  initialOverdue?: boolean;
}) {
  const { ws, can } = useSession();
  const navigate = useNavigate();
  const [scope, setScopeState] = useState(projectId ? "all" : initialScope);
  const list = useList<Task>(ws("/tasks/"), {
    project: projectId ?? "",
    status: "",
    priority: "",
    overdue: initialOverdue ? "true" : "",
    ...scopeFilters(projectId ? "all" : initialScope),
  });
  const setScope = (s: string) => {
    setScopeState(s);
    list.setFilters((f) => ({ ...f, ...scopeFilters(s) }));
  };
  const [creating, setCreating] = useState(false);

  const columns: Column<Task>[] = [
    {
      key: "key",
      header: "Mã",
      render: (t) => <span className="text-xs text-slate-500">{t.key}</span>,
      hideOnMobile: true,
    },
    {
      key: "title",
      header: "Công việc",
      render: (t) => (
        <div className="max-w-80">
          <div className="truncate font-medium">{t.title}</div>
          {!projectId && (
            <div className="text-xs text-slate-500 truncate">
              {t.project_code} · {t.project_name}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "assignees",
      header: "Người thực hiện",
      hideOnMobile: true,
      render: (t) => t.assignees.map((a) => a.display_name).join(", ") || "—",
    },
    { key: "assigner", header: "Người giao", hideOnMobile: true, render: (t) => t.assigner?.display_name ?? "—" },
    {
      key: "due",
      header: "Hạn",
      render: (t) => <span className={t.is_overdue ? "text-red-600 font-medium" : ""}>{fmtDate(t.due_date)}</span>,
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
      render: (t) => (
        <div className="flex flex-col gap-1">
          <Badge tone={toneOf(TASK_STATUS, t.status)}>{labelOf(TASK_STATUS, t.status)}</Badge>
          {t.is_overdue && <Badge tone="red">Quá hạn</Badge>}
        </div>
      ),
    },
  ];

  return (
    <Card bodyClassName="p-0">
      {!projectId && (
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
      )}
      <Toolbar
        q={list.q}
        onQ={list.setQ}
        placeholder="Tìm công việc..."
        onExport={() => downloadExport(ws("/tasks/"), list.query)}
        right={
          can("task.create") && (
            <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              Giao việc
            </Button>
          )
        }
      >
        {!projectId && (
          <ProjectSelect
            className="w-full sm:w-56"
            placeholder="Mọi dự án"
            value={String(list.filters.project ?? "")}
            onChange={(e) => list.setFilter("project", e.target.value)}
          />
        )}
        <Select
          className="w-full sm:w-36"
          placeholder="Mọi trạng thái"
          options={TASK_STATUS}
          value={String(list.filters.status ?? "")}
          onChange={(e) => list.setFilter("status", e.target.value)}
        />
        <Select
          className="w-full sm:w-36"
          placeholder="Mọi mức ưu tiên"
          options={PRIORITY}
          value={String(list.filters.priority ?? "")}
          onChange={(e) => list.setFilter("priority", e.target.value)}
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
        columns={columns}
        rows={list.data?.results}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        onRowClick={(t) => navigate(`/tasks/${t.id}`)}
        empty="Không có công việc phù hợp."
      />
      <ListFooter data={list.data} setPage={list.setPage} />
      {creating && (
        <TaskForm
          projectId={projectId}
          onClose={() => setCreating(false)}
          onSaved={(t) => navigate(`/tasks/${t.id}`)}
        />
      )}
    </Card>
  );
}
