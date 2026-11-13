import { ArrowLeft, Pencil, Plus, Trash2, UserMinus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import { DailyReports } from "@/components/DailyReports";
import { DocumentList } from "@/components/DocumentList";
import { ScheduleBoard } from "@/components/ScheduleBoard";
import { TaskList } from "@/components/TaskList";
import { useForm } from "@/components/form";
import { useUsers } from "@/components/pickers";
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
  Tabs,
  Textarea,
  useAction,
  useUi,
} from "@/components/ui";
import { api, type Page } from "@/lib/api";
import { fmtDate, fmtMoney } from "@/lib/format";
import { useFetch } from "@/lib/hooks";
import { PROJECT_STATUS, PROJECT_TYPE, labelOf, toneOf } from "@/lib/labels";
import { useSession } from "@/lib/session";
import type { Project } from "@/lib/types";

import { ProjectForm } from "./Projects";

interface Milestone {
  id: string;
  name: string;
  due_date: string;
  achieved_date: string | null;
  status: string;
  description: string;
}

const MILESTONE_STATUS = [
  { value: "pending", label: "Chưa đạt", tone: "gray" as const },
  { value: "achieved", label: "Đã đạt", tone: "green" as const },
  { value: "missed", label: "Trễ mốc", tone: "red" as const },
];

function Milestones({ projectId }: { projectId: string }) {
  const { ws, can } = useSession();
  const { data, reload } = useFetch<Page<Milestone>>(ws("/milestones/"), { project: projectId, page_size: 100 });
  const [editing, setEditing] = useState<Milestone | null | undefined>(undefined);
  const { confirm } = useUi();
  const { run } = useAction();
  return (
    <Card
      title="Mốc quan trọng"
      actions={
        can("schedule.create") && (
          <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setEditing(null)}>
            Thêm mốc
          </Button>
        )
      }
    >
      {!data?.results.length ? (
        <p className="text-sm text-slate-500">Chưa có mốc.</p>
      ) : (
        <ul className="divide-slate-100 divide-y">
          {data.results.map((m) => (
            <li key={m.id} className="text-sm flex items-center gap-3 py-2">
              <span className="text-slate-500 w-24 shrink-0">{fmtDate(m.due_date)}</span>
              <button
                type="button"
                className="hover:text-brand-700 min-w-0 flex-1 truncate text-left"
                onClick={() => can("schedule.update") && setEditing(m)}
              >
                {m.name}
              </button>
              <Badge tone={MILESTONE_STATUS.find((s) => s.value === m.status)?.tone}>
                {MILESTONE_STATUS.find((s) => s.value === m.status)?.label}
              </Badge>
              {can("schedule.delete") && (
                <button
                  type="button"
                  aria-label="Xóa mốc"
                  className="text-slate-400 hover:text-red-600"
                  onClick={async () => {
                    const { ok } = await confirm({
                      title: "Xóa mốc?",
                      message: m.name,
                      danger: true,
                      confirmText: "Xóa",
                    });
                    if (ok) {
                      await run(() => api.del(ws(`/milestones/${m.id}/`)), "Đã xóa");
                      void reload();
                    }
                  }}
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing !== undefined && (
        <MilestoneModal
          projectId={projectId}
          milestone={editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            void reload();
          }}
        />
      )}
    </Card>
  );
}

function MilestoneModal({
  projectId,
  milestone,
  onClose,
  onSaved,
}: {
  projectId: string;
  milestone: Milestone | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { ws } = useSession();
  const form = useForm({
    project: projectId,
    name: milestone?.name ?? "",
    due_date: milestone?.due_date ?? "",
    achieved_date: milestone?.achieved_date ?? "",
    status: milestone?.status ?? "pending",
    description: milestone?.description ?? "",
  });
  const save = () =>
    form
      .submit((v) => {
        const body = { ...v, achieved_date: v.achieved_date || null };
        return milestone ? api.patch(ws(`/milestones/${milestone.id}/`), body) : api.post(ws("/milestones/"), body);
      }, "Đã lưu mốc")
      .then((r) => r && onSaved());
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={milestone ? "Sửa mốc" : "Thêm mốc"}
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
        <Field label="Tên mốc" required error={form.errors.name}>
          <Input {...form.bind("name")} />
        </Field>
        <Field label="Ngày dự kiến" required error={form.errors.due_date}>
          <Input type="date" {...form.bind("due_date")} />
        </Field>
        <Field label="Trạng thái">
          <Select options={MILESTONE_STATUS} {...form.bind("status")} />
        </Field>
        <Field label="Ngày đạt thực tế" error={form.errors.achieved_date}>
          <Input type="date" {...form.bind("achieved_date")} />
        </Field>
        <Field label="Ghi chú">
          <Textarea {...form.bind("description")} />
        </Field>
      </div>
    </Modal>
  );
}

function Members({ project, onChanged }: { project: Project; onChanged: () => void }) {
  const { ws, can } = useSession();
  const users = useUsers();
  const { confirm } = useUi();
  const { run, busy } = useAction();
  const [adding, setAdding] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const memberIds = new Set((project.members ?? []).map((m) => m.id));
  return (
    <Card
      title={`Nhân sự dự án (${project.members?.length ?? 0})`}
      actions={
        can("project.update") && (
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
            Thêm nhân sự
          </Button>
        )
      }
      bodyClassName="p-0"
    >
      <table className="cx-table w-full">
        <thead>
          <tr>
            <th>Họ tên</th>
            <th>Vai trò</th>
            <th className="hidden md:table-cell">Chức vụ</th>
            <th className="hidden md:table-cell">Email</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(project.members ?? []).map((m) => (
            <tr key={m.id}>
              <td className="font-medium">
                {m.employee_id ? (
                  <Link className="hover:text-brand-700" to={`/employees/${m.employee_id}`}>
                    {m.display_name}
                  </Link>
                ) : (
                  m.display_name
                )}
                {m.id === project.manager && (
                  <Badge tone="navy" className="ml-2">
                    Phụ trách
                  </Badge>
                )}
              </td>
              <td>{m.business_role ?? "—"}</td>
              <td className="hidden md:table-cell">{m.position || "—"}</td>
              <td className="hidden md:table-cell">{m.email}</td>
              <td className="text-right">
                {can("project.update") && m.id !== project.manager && (
                  <button
                    type="button"
                    className="text-slate-400 hover:text-red-600"
                    aria-label="Gỡ khỏi dự án"
                    onClick={async () => {
                      const { ok } = await confirm({
                        title: "Gỡ nhân sự khỏi dự án?",
                        message: `${m.display_name} sẽ không còn xem được dữ liệu dự án.`,
                        danger: true,
                        confirmText: "Gỡ",
                      });
                      if (
                        ok &&
                        (await run(
                          () => api.post(ws(`/projects/${project.id}/members/remove/`), { user_id: m.id }),
                          "Đã gỡ nhân sự"
                        )) !== undefined
                      )
                        onChanged();
                    }}
                  >
                    <UserMinus className="size-4" />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Thêm nhân sự vào dự án"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Hủy
            </Button>
            <Button
              loading={busy}
              disabled={!adding.length}
              onClick={async () => {
                if (
                  await run(
                    () => api.post(ws(`/projects/${project.id}/members/add/`), { user_ids: adding }),
                    "Đã thêm nhân sự"
                  )
                ) {
                  setAdding([]);
                  setOpen(false);
                  onChanged();
                }
              }}
            >
              Thêm {adding.length || ""}
            </Button>
          </>
        }
      >
        <div className="grid gap-1 sm:grid-cols-2">
          {(users.data ?? [])
            .filter((u) => !memberIds.has(u.id))
            .map((u) => (
              <label key={u.id} className="text-sm hover:bg-slate-50 flex items-center gap-2 rounded px-2 py-1">
                <input
                  type="checkbox"
                  checked={adding.includes(u.id)}
                  onChange={() => setAdding((a) => (a.includes(u.id) ? a.filter((x) => x !== u.id) : [...a, u.id]))}
                />
                <span className="truncate">{u.full_name || u.display_name}</span>
                <span className="text-xs text-slate-400 truncate">{u.role}</span>
              </label>
            ))}
        </div>
      </Modal>
    </Card>
  );
}

export function ProjectDetailPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "overview";
  const { ws, can } = useSession();
  const navigate = useNavigate();
  const { confirm } = useUi();
  const { run } = useAction();
  const { data: project, error, loading, reload } = useFetch<Project>(ws(`/projects/${id}/`));
  const [editing, setEditing] = useState(false);

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !project) return <Spinner />;
  if (!project) return null;

  const remove = async () => {
    const { ok } = await confirm({
      title: `Xóa dự án ${project.code}?`,
      message:
        "Dự án sẽ được lưu trữ (ẩn khỏi danh sách), dữ liệu tiến độ, công việc và hồ sơ vẫn được giữ lại để tra cứu.",
      danger: true,
      confirmText: "Xóa dự án",
    });
    if (ok && (await run(() => api.del(ws(`/projects/${project.id}/`)), "Đã xóa dự án")) !== undefined)
      navigate("/projects");
  };

  const p = project.progress;
  return (
    <div>
      <Link
        to="/projects"
        className="no-print text-sm text-slate-500 hover:text-brand-700 mb-2 inline-flex items-center gap-1"
      >
        <ArrowLeft className="size-4" /> Danh sách dự án
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {project.code} · {project.name}{" "}
            <Badge tone={toneOf(PROJECT_STATUS, project.status)}>{labelOf(PROJECT_STATUS, project.status)}</Badge>
            {p?.is_behind && <Badge tone="red">Chậm tiến độ</Badge>}
          </span>
        }
        subtitle={`${project.investor} · ${project.location || "—"}`}
        actions={
          <>
            {can("project.update") && (
              <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
                Sửa
              </Button>
            )}
            {can("project.delete") && (
              <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => void remove()}>
                Xóa
              </Button>
            )}
          </>
        }
      />
      <Tabs
        value={tab}
        onChange={(t) => setParams({ tab: t })}
        tabs={[
          { value: "overview", label: "Tổng quan" },
          { value: "schedule", label: "Tiến độ" },
          { value: "tasks", label: "Công việc" },
          { value: "members", label: "Nhân sự" },
          { value: "documents", label: "Hồ sơ kỹ thuật" },
          { value: "reports", label: "Báo cáo / Nhật ký" },
        ]}
      />
      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Thông tin dự án" className="lg:col-span-2">
            <dl className="text-sm grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {[
                ["Mã dự án", project.code],
                ["Tên công trình", project.name],
                ["Chủ đầu tư", project.investor],
                ["Địa điểm xây dựng", project.location || "—"],
                ["Loại công trình", labelOf(PROJECT_TYPE, project.project_type)],
                ["Người phụ trách", project.manager_detail?.display_name ?? "—"],
                ["Phòng ban", project.department_name ?? "—"],
                ["Ngày bắt đầu", fmtDate(project.start_date)],
                ["Ngày kết thúc dự kiến", fmtDate(project.planned_end_date)],
                ["Ngày hoàn thành thực tế", fmtDate(project.actual_end_date)],
                ["Giá trị hợp đồng", fmtMoney(project.contract_value)],
                ["Số thành viên", String(project.members?.length ?? 0)],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-slate-500">{k}</dt>
                  <dd className="text-slate-800 font-medium">{v}</dd>
                </div>
              ))}
            </dl>
            {project.description && (
              <p className="border-slate-100 text-sm text-slate-600 mt-4 border-t pt-3 whitespace-pre-line">
                {project.description}
              </p>
            )}
          </Card>
          <div className="space-y-4">
            <Card title="Tiến độ tổng thể">
              {p && p.items > 0 ? (
                <div className="text-sm space-y-3">
                  <div>
                    <div className="mb-1 flex justify-between">
                      <span>Thực tế</span>
                      <strong>{p.actual.toFixed(1)}%</strong>
                    </div>
                    <ProgressBar value={p.actual} planned={p.planned} />
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Kế hoạch đến hôm nay</span>
                    <strong>{p.planned.toFixed(1)}%</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Chênh lệch</span>
                    <strong className={p.actual - p.planned < -10 ? "text-red-600" : "text-emerald-600"}>
                      {(p.actual - p.planned).toFixed(1)}%
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Hạng mục quá hạn</span>
                    <strong className={p.overdue ? "text-red-600" : ""}>
                      {p.overdue} / {p.items}
                    </strong>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-500">
                  Chưa có kế hoạch tiến độ.{" "}
                  <button
                    type="button"
                    className="text-brand-700 hover:underline"
                    onClick={() => setParams({ tab: "schedule" })}
                  >
                    Lập kế hoạch
                  </button>
                </p>
              )}
            </Card>
            <Milestones projectId={project.id} />
          </div>
        </div>
      )}
      {tab === "schedule" && <ScheduleBoard projectId={project.id} />}
      {tab === "tasks" && <TaskList projectId={project.id} />}
      {tab === "members" && <Members project={project} onChanged={() => void reload()} />}
      {tab === "documents" && <DocumentList projectId={project.id} />}
      {tab === "reports" && (
        <div className="space-y-3">
          <div className="no-print text-sm flex flex-wrap gap-2">
            <span className="text-slate-500">Báo cáo của dự án:</span>
            <Link
              className="text-brand-700 hover:underline"
              to={`/reports?report=project-summary&project=${project.id}`}
            >
              Tổng hợp dự án
            </Link>
            <Link className="text-brand-700 hover:underline" to={`/reports?report=progress&project=${project.id}`}>
              Báo cáo tiến độ
            </Link>
          </div>
          <DailyReports projectId={project.id} />
        </div>
      )}
      {editing && (
        <ProjectForm
          project={project}
          open
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void reload();
          }}
        />
      )}
    </div>
  );
}
