import { ArrowLeft, ExternalLink, Pencil, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import { Attachments } from "@/components/Attachments";
import { TaskForm, TaskList } from "@/components/TaskList";
import {
  Badge,
  Button,
  Card,
  ErrorBox,
  PageHeader,
  Select,
  Spinner,
  Textarea,
  useAction,
  useUi,
} from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useFetch } from "@/lib/hooks";
import { PRIORITY, TASK_STATUS, labelOf, toneOf } from "@/lib/labels";
import { useSession } from "@/lib/session";
import type { Task } from "@/lib/types";

export function TasksPage() {
  const [params] = useSearchParams();
  return (
    <div>
      <PageHeader
        title="Công việc & giao việc"
        subtitle="Giao việc, theo dõi hạn hoàn thành, trao đổi và đính kèm tệp"
      />
      <TaskList
        initialScope={params.get("overdue") ? "all" : "mine"}
        initialOverdue={params.get("overdue") === "true"}
      />
    </div>
  );
}

export function TaskDetailPage() {
  const { id } = useParams();
  const { ws, can, user, slug } = useSession();
  const navigate = useNavigate();
  const { confirm } = useUi();
  const { run, busy } = useAction();
  const { data: task, error, loading, reload, setData } = useFetch<Task>(ws(`/tasks/${id}/`));
  const [comment, setComment] = useState("");
  const [editing, setEditing] = useState(false);

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading || !task) return <Spinner />;

  const isAssignee = task.assignees.some((a) => a.id === user?.id);
  const canStatus = can("task.update") || isAssignee;

  const changeStatus = async (status: string) => {
    const res = await run(() => api.patch<Task>(ws(`/tasks/${task.id}/`), { status }), "Đã cập nhật trạng thái");
    if (res) setData(res);
  };
  const send = async () => {
    if (!comment.trim()) return;
    const res = await run(() => api.post<Task["comments"]>(ws(`/tasks/${task.id}/comments/`), { text: comment }));
    if (res) {
      setData({ ...task, comments: res });
      setComment("");
    }
  };
  const remove = async () => {
    const { ok } = await confirm({ title: "Xóa công việc?", message: task.title, danger: true, confirmText: "Xóa" });
    if (ok && (await run(() => api.del(ws(`/tasks/${task.id}/`)), "Đã xóa công việc")) !== undefined)
      navigate("/tasks");
  };

  return (
    <div className="space-y-4">
      <Link to="/tasks" className="no-print text-sm text-slate-500 hover:text-brand-700 inline-flex items-center gap-1">
        <ArrowLeft className="size-4" /> Danh sách công việc
      </Link>
      <PageHeader
        title={task.title}
        subtitle={
          <>
            {task.key} ·{" "}
            <Link className="text-brand-700 hover:underline" to={`/projects/${task.project}`}>
              {task.project_code} - {task.project_name}
            </Link>
          </>
        }
        actions={
          <>
            <a
              href={`/${slug}/browse/${task.key}/`}
              className="text-sm text-slate-600 hover:bg-slate-100 inline-flex h-9 items-center gap-1 rounded-md px-3"
            >
              <ExternalLink className="size-4" /> Mở trong Plane
            </a>
            {can("task.update") && (
              <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
                Sửa
              </Button>
            )}
            {can("task.delete") && (
              <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => void remove()}>
                Xóa
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Mô tả">
            <p className="text-sm text-slate-700 whitespace-pre-line">{task.description || "Không có mô tả."}</p>
          </Card>
          <Card title={`Bình luận (${task.comments?.length ?? 0})`}>
            <ul className="space-y-3">
              {(task.comments ?? []).map((c) => (
                <li key={c.id} className="bg-slate-50 rounded-md p-3">
                  <div className="text-xs text-slate-500 mb-1">
                    <strong className="text-slate-700">{c.author?.display_name}</strong> · {fmtDateTime(c.created_at)}
                  </div>
                  <div className="text-sm whitespace-pre-line">{c.text}</div>
                </li>
              ))}
            </ul>
            <div className="no-print mt-3 flex gap-2">
              <Textarea
                rows={2}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Viết bình luận, báo cáo tình hình..."
              />
              <Button
                onClick={() => void send()}
                loading={busy}
                disabled={!comment.trim()}
                icon={<Send className="size-4" />}
                className="self-end"
              >
                Gửi
              </Button>
            </div>
          </Card>
          <Card title="Tệp đính kèm">
            <Attachments entityType="task" entityId={task.id} canUpload={canStatus} />
          </Card>
        </div>
        <Card title="Thông tin">
          <dl className="text-sm space-y-3">
            <div>
              <dt className="text-xs text-slate-500">Trạng thái</dt>
              <dd className="mt-1">
                {canStatus ? (
                  <Select
                    options={TASK_STATUS}
                    value={task.status}
                    onChange={(e) => void changeStatus(e.target.value)}
                  />
                ) : (
                  <Badge tone={toneOf(TASK_STATUS, task.status)}>{labelOf(TASK_STATUS, task.status)}</Badge>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Độ ưu tiên</dt>
              <dd>
                <Badge tone={toneOf(PRIORITY, task.priority)}>{labelOf(PRIORITY, task.priority)}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Người giao việc</dt>
              <dd>{task.assigner?.display_name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Người thực hiện</dt>
              <dd>{task.assignees.map((a) => a.display_name).join(", ") || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Ngày bắt đầu</dt>
              <dd>{fmtDate(task.start_date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Hạn hoàn thành</dt>
              <dd className={task.is_overdue ? "text-red-600 font-semibold" : ""}>
                {fmtDate(task.due_date)}
                {task.is_overdue && " (quá hạn)"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Ngày tạo</dt>
              <dd>{fmtDateTime(task.created_at)}</dd>
            </div>
          </dl>
        </Card>
      </div>
      {editing && (
        <TaskForm
          task={task}
          onClose={() => setEditing(false)}
          onSaved={(t) => {
            setEditing(false);
            setData(t);
          }}
        />
      )}
    </div>
  );
}
