import { clsx } from "clsx";
import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, GanttChartSquare, Link2, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api, downloadExport, type Page } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { PRIORITY, SCHEDULE_LEVEL, SCHEDULE_STATUS, labelOf, toneOf } from "@/lib/labels";
import { useSession } from "@/lib/session";
import type { ScheduleItem } from "@/lib/types";

import { Attachments } from "./Attachments";
import { Toolbar } from "./DataTable";
import { clean, useForm } from "./form";
import { UserSelect } from "./pickers";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorBox,
  Field,
  Input,
  Modal,
  ProgressBar,
  Select,
  Spinner,
  Tabs,
  Textarea,
  useAction,
  useUi,
} from "./ui";

interface Dependency {
  id: string;
  predecessor: string;
  successor: string;
  dependency_type: string;
  lag_days: number;
  predecessor_detail: { id: string; code: string; name: string };
  successor_detail: { id: string; code: string; name: string };
}

const CHILD_LEVEL: Record<string, ScheduleItem["level"] | null> = {
  category: "task",
  task: "activity",
  activity: null,
};

async function fetchAll(path: string, query: Record<string, string>) {
  const out: ScheduleItem[] = [];
  for (let page = 1; page < 50; page++) {
    // Pages are fetched one after another on purpose: we stop at the last page.
    // oxlint-disable-next-line no-await-in-loop
    const res = await api.get<Page<ScheduleItem>>(path, { ...query, page, page_size: 200 });
    out.push(...res.results);
    if (page >= res.total_pages) break;
  }
  return out;
}

const byOrder = (a: ScheduleItem, b: ScheduleItem) =>
  a.sort_order - b.sort_order || a.code.localeCompare(b.code, "vi", { numeric: true });

/** Depth-first order of the WBS tree with depth for indentation. */
function flatten(items: ScheduleItem[]) {
  const byParent = new Map<string | null, ScheduleItem[]>();
  for (const i of items) {
    const key = i.parent && items.some((x) => x.id === i.parent) ? i.parent : null;
    byParent.set(key, [...(byParent.get(key) ?? []), i]);
  }
  const out: { item: ScheduleItem; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const i of (byParent.get(parent) ?? []).toSorted(byOrder)) {
      out.push({ item: i, depth });
      walk(i.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

function ItemForm({
  projectId,
  item,
  parent,
  level,
  all,
  onClose,
  onSaved,
}: {
  projectId: string;
  item?: ScheduleItem | null;
  parent?: ScheduleItem | null;
  level: ScheduleItem["level"];
  all: ScheduleItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { ws, can, user } = useSession();
  const { confirm } = useUi();
  const { run } = useAction();
  const canEdit = can("schedule.update") || (!item && can("schedule.create"));
  const isAssignee = item?.assignee === user?.id;
  const [tab, setTab] = useState("info");
  const form = useForm({
    project: projectId,
    parent: item?.parent ?? parent?.id ?? "",
    level: item?.level ?? level,
    code: item?.code ?? "",
    name: item?.name ?? "",
    assignee: item?.assignee ?? "",
    start_date: item?.start_date ?? parent?.start_date ?? "",
    end_date: item?.end_date ?? parent?.end_date ?? "",
    progress: item?.progress ?? "0",
    weight: item?.weight ?? "1",
    priority: item?.priority ?? "medium",
    status: item?.status ?? "not_started",
    note: item?.note ?? "",
  });
  const { bind, errors } = form;
  const [deps, setDeps] = useState<Dependency[]>([]);
  const [newDep, setNewDep] = useState("");

  const loadDeps = useCallback(async () => {
    if (!item) return;
    const res = await api.get<Page<Dependency>>(ws("/dependencies/"), { project: projectId, page_size: 200 });
    setDeps(res.results.filter((d) => d.successor === item.id || d.predecessor === item.id));
  }, [item, projectId, ws]);
  useEffect(() => {
    void loadDeps();
  }, [loadDeps]);

  const save = async () => {
    const payload = canEdit
      ? clean(form.values)
      : { progress: form.values.progress, status: form.values.status, note: form.values.note };
    const res = await form.submit(
      () => (item ? api.patch(ws(`/schedule-items/${item.id}/`), payload) : api.post(ws("/schedule-items/"), payload)),
      item ? "Đã cập nhật" : "Đã thêm vào kế hoạch"
    );
    if (res) onSaved();
  };

  const remove = async () => {
    if (!item) return;
    const { ok } = await confirm({
      title: "Xóa khỏi kế hoạch?",
      message: `${item.code} ${item.name} sẽ bị xóa (vẫn lưu trong nhật ký hoạt động).`,
      danger: true,
      confirmText: "Xóa",
    });
    if (ok && (await run(() => api.del(ws(`/schedule-items/${item.id}/`)), "Đã xóa")) !== undefined) onSaved();
  };

  const addDep = async () => {
    if (!item || !newDep) return;
    await run(
      () => api.post(ws("/dependencies/"), { predecessor: newDep, successor: item.id, dependency_type: "FS" }),
      "Đã thêm liên kết"
    );
    setNewDep("");
    void loadDeps();
  };

  const levelLabel = labelOf(SCHEDULE_LEVEL, form.values.level);
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={
        item ? `${item.code} ${item.name}` : `Thêm ${levelLabel.toLowerCase()}${parent ? ` vào ${parent.code}` : ""}`
      }
      footer={
        <>
          {item && can("schedule.delete") && (
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
          {(canEdit || isAssignee) && (
            <Button loading={form.saving} onClick={() => void save()}>
              Lưu
            </Button>
          )}
        </>
      }
    >
      {item && (
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "info", label: "Thông tin" },
            { value: "deps", label: `Liên kết (${deps.length})` },
            { value: "files", label: "Tệp / ảnh hiện trường" },
          ]}
        />
      )}
      {tab === "info" && (
        <div className="grid gap-4 md:grid-cols-2">
          {!canEdit && isAssignee && (
            <p className="bg-brand-50 text-sm text-brand-700 rounded-md p-2 md:col-span-2">
              Bạn là người phụ trách: được cập nhật % hoàn thành, trạng thái và ghi chú.
            </p>
          )}
          <Field label="Mã công việc" required error={errors.code}>
            <Input disabled={!canEdit} {...bind("code")} placeholder="VD: HM01, CV03" />
          </Field>
          <Field label="Tên" required error={errors.name}>
            <Input disabled={!canEdit} {...bind("name")} />
          </Field>
          <Field label="Cấp" error={errors.level}>
            <Select disabled options={SCHEDULE_LEVEL} {...bind("level")} />
          </Field>
          <Field label="Người phụ trách" error={errors.assignee}>
            <UserSelect disabled={!canEdit} projectId={projectId} {...bind("assignee")} />
          </Field>
          <Field label="Ngày bắt đầu" required error={errors.start_date}>
            <Input type="date" disabled={!canEdit} {...bind("start_date")} />
          </Field>
          <Field label="Ngày kết thúc" required error={errors.end_date}>
            <Input type="date" disabled={!canEdit} {...bind("end_date")} />
          </Field>
          <Field
            label="Tỷ lệ hoàn thành (%)"
            error={errors.progress}
            hint={item?.has_children ? "Tự tính từ các công việc con" : undefined}
          >
            <Input type="number" min={0} max={100} step={1} disabled={item?.has_children} {...bind("progress")} />
          </Field>
          <Field label="Trọng số" error={errors.weight} hint="Dùng để tính % của cấp cha">
            <Input type="number" min={0} step={0.5} disabled={!canEdit} {...bind("weight")} />
          </Field>
          <Field label="Mức độ ưu tiên" error={errors.priority}>
            <Select disabled={!canEdit} options={PRIORITY.filter((p) => p.value !== "none")} {...bind("priority")} />
          </Field>
          <Field label="Trạng thái" error={errors.status}>
            <Select options={SCHEDULE_STATUS} {...bind("status")} />
          </Field>
          <Field label="Ghi chú" className="md:col-span-2" error={errors.note}>
            <Textarea {...bind("note")} />
          </Field>
          {item && (
            <p className="text-xs text-slate-500 md:col-span-2">
              Số ngày thực hiện: {item.duration_days} ngày
              {item.is_overdue && <span className="text-red-600 ml-2 font-medium">· Quá hạn</span>}
            </p>
          )}
        </div>
      )}
      {tab === "deps" && item && (
        <div className="space-y-3">
          <ul className="divide-slate-100 border-slate-200 divide-y rounded-md border">
            {deps.length === 0 && <li className="text-sm text-slate-500 p-3">Chưa có liên kết.</li>}
            {deps.map((d) => (
              <li key={d.id} className="text-sm flex items-center gap-2 p-2">
                <Link2 className="text-slate-400 size-4" />
                {d.successor === item.id ? (
                  <>
                    Bắt đầu sau khi xong{" "}
                    <strong>
                      {d.predecessor_detail.code} {d.predecessor_detail.name}
                    </strong>
                  </>
                ) : (
                  <>
                    Là điều kiện trước của{" "}
                    <strong>
                      {d.successor_detail.code} {d.successor_detail.name}
                    </strong>
                  </>
                )}
                {can("schedule.update") && (
                  <button
                    type="button"
                    className="text-slate-400 hover:text-red-600 ml-auto"
                    onClick={async () => {
                      await run(() => api.del(ws(`/dependencies/${d.id}/`)), "Đã gỡ liên kết");
                      void loadDeps();
                    }}
                    aria-label="Gỡ liên kết"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {can("schedule.create") && (
            <div className="flex gap-2">
              <Select
                className="flex-1"
                placeholder="— Công việc phải xong trước —"
                value={newDep}
                onChange={(e) => setNewDep(e.target.value)}
                options={all
                  .filter((i) => i.id !== item.id && i.level !== "category")
                  .map((i) => ({ value: i.id, label: `${i.code} ${i.name}` }))}
              />
              <Button onClick={() => void addDep()} disabled={!newDep}>
                Thêm
              </Button>
            </div>
          )}
        </div>
      )}
      {tab === "files" && item && (
        <Attachments entityType="schedule_item" entityId={item.id} canUpload={can("schedule.update") || isAssignee} />
      )}
    </Modal>
  );
}

function Gantt({ item, min, span }: { item: ScheduleItem; min: Date; span: number }) {
  const start = differenceInCalendarDays(parseISO(item.start_date), min);
  const len = differenceInCalendarDays(parseISO(item.end_date), parseISO(item.start_date)) + 1;
  const left = (start / span) * 100;
  const width = Math.max((len / span) * 100, 0.8);
  const pct = Number(item.progress);
  return (
    <div className="relative h-4 w-full min-w-48">
      <div
        className={clsx(
          "absolute top-0.5 h-3 overflow-hidden rounded-sm",
          item.level === "category" ? "bg-slate-300" : item.is_overdue ? "bg-red-200" : "bg-brand-100"
        )}
        style={{ left: `${left}%`, width: `${width}%` }}
        title={`${fmtDate(item.start_date)} → ${fmtDate(item.end_date)} · ${pct}%`}
      >
        <div
          className={clsx(
            "h-full",
            item.level === "category" ? "bg-navy-700" : item.is_overdue ? "bg-red-500" : "bg-brand-600"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function CalendarView({ items, onOpen }: { items: ScheduleItem[]; onOpen: (i: ScheduleItem) => void }) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const days: Date[] = [];
  for (
    let d = startOfWeek(month, { weekStartsOn: 1 });
    d <= endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
    d = addDays(d, 1)
  )
    days.push(d);
  const leaves = items.filter((i) => !i.has_children);
  const today = format(new Date(), "yyyy-MM-dd");
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          icon={<ChevronLeft className="size-4" />}
          onClick={() => setMonth((m) => addMonths(m, -1))}
          aria-label="Tháng trước"
        />
        <div className="text-sm font-semibold capitalize">Tháng {format(month, "MM/yyyy")}</div>
        <Button
          variant="ghost"
          size="sm"
          icon={<ChevronRight className="size-4" />}
          onClick={() => setMonth((m) => addMonths(m, 1))}
          aria-label="Tháng sau"
        />
      </div>
      <div className="border-slate-200 text-xs grid grid-cols-7 overflow-hidden rounded-md border">
        {["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map((d) => (
          <div key={d} className="bg-slate-50 text-slate-500 py-1 text-center font-semibold">
            {d}
          </div>
        ))}
        {days.map((d) => {
          const iso = format(d, "yyyy-MM-dd");
          const active = leaves.filter((i) => i.start_date <= iso && i.end_date >= iso);
          return (
            <div
              key={iso}
              className={clsx(
                "border-slate-100 min-h-20 border-t border-l p-1",
                !isSameMonth(d, month) && "bg-slate-50/70 text-slate-400",
                iso === today && "bg-brand-50"
              )}
            >
              <div className={clsx("mb-0.5 text-right", iso === today && "text-brand-700 font-bold")}>
                {format(d, "d")}
              </div>
              {active.slice(0, 3).map((i) => (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => onOpen(i)}
                  className={clsx(
                    "mb-0.5 block w-full truncate rounded px-1 text-left",
                    i.is_overdue
                      ? "bg-red-100 text-red-800"
                      : i.status === "completed"
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-brand-100 text-brand-700"
                  )}
                  title={`${i.code} ${i.name}`}
                >
                  {i.code} {i.name}
                </button>
              ))}
              {active.length > 3 && <div className="text-slate-500 px-1">+{active.length - 3} việc</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** WBS table with Gantt bars and a calendar view for one project. */
export function ScheduleBoard({ projectId, focusItem }: { projectId: string; focusItem?: string | null }) {
  const { ws, can, user } = useSession();
  const [items, setItems] = useState<ScheduleItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"table" | "calendar">("table");
  const [filter, setFilter] = useState<"all" | "overdue" | "mine">("all");
  const [editing, setEditing] = useState<{
    item?: ScheduleItem | null;
    parent?: ScheduleItem | null;
    level: ScheduleItem["level"];
  } | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await fetchAll(ws("/schedule-items/"), { project: projectId }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi tải tiến độ");
    }
  }, [projectId, ws]);
  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);

  useEffect(() => {
    if (focusItem && items) {
      const it = items.find((i) => i.id === focusItem);
      if (it) setEditing({ item: it, level: it.level });
    }
  }, [focusItem, items]);

  const rows = useMemo(() => {
    const flat = flatten(items ?? []);
    if (filter === "all") return flat;
    return flat.filter(({ item }) => (filter === "overdue" ? item.is_overdue : item.assignee === user?.id));
  }, [items, filter, user]);

  const [min, span] = useMemo(() => {
    if (!items?.length) return [new Date(), 1];
    const s = items.reduce((m, i) => (i.start_date < m ? i.start_date : m), items[0].start_date);
    const e = items.reduce((m, i) => (i.end_date > m ? i.end_date : m), items[0].end_date);
    return [parseISO(s), differenceInCalendarDays(parseISO(e), parseISO(s)) + 1];
  }, [items]);
  const todayPos = items?.length ? (differenceInCalendarDays(new Date(), min) / span) * 100 : -1;

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!items) return <Spinner />;

  return (
    <Card bodyClassName="p-0">
      <Toolbar
        onExport={() => downloadExport(ws("/schedule-items/"), { project: projectId })}
        right={
          can("schedule.create") && (
            <Button icon={<Plus className="size-4" />} onClick={() => setEditing({ level: "category" })}>
              Thêm hạng mục
            </Button>
          )
        }
      >
        <div className="border-slate-300 flex rounded-md border p-0.5">
          <button
            type="button"
            onClick={() => setView("table")}
            className={clsx(
              "text-sm flex items-center gap-1 rounded px-2 py-1",
              view === "table" && "bg-navy-700 text-white"
            )}
          >
            <GanttChartSquare className="size-4" /> Bảng & Gantt
          </button>
          <button
            type="button"
            onClick={() => setView("calendar")}
            className={clsx(
              "text-sm flex items-center gap-1 rounded px-2 py-1",
              view === "calendar" && "bg-navy-700 text-white"
            )}
          >
            <CalendarDays className="size-4" /> Lịch
          </button>
        </div>
        <Select
          className="w-44"
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
          options={[
            { value: "all", label: "Tất cả" },
            { value: "overdue", label: "Chỉ việc quá hạn" },
            { value: "mine", label: "Việc tôi phụ trách" },
          ]}
        />
      </Toolbar>
      {items.length === 0 ? (
        <Empty
          action={
            can("schedule.create") && (
              <Button icon={<Plus className="size-4" />} onClick={() => setEditing({ level: "category" })}>
                Lập kế hoạch: thêm hạng mục đầu tiên
              </Button>
            )
          }
        >
          Dự án chưa có kế hoạch tiến độ. Cấu trúc: Hạng mục → Công việc → Công tác chi tiết.
        </Empty>
      ) : view === "calendar" ? (
        <div className="p-3">
          <CalendarView items={items} onOpen={(i) => setEditing({ item: i, level: i.level })} />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="cx-table w-full">
            <thead>
              <tr>
                <th>Mã</th>
                <th>Tên công việc</th>
                <th className="hidden md:table-cell">Phụ trách</th>
                <th className="hidden md:table-cell">Bắt đầu</th>
                <th className="hidden md:table-cell">Kết thúc</th>
                <th className="hidden lg:table-cell">Ngày</th>
                <th>Hoàn thành</th>
                <th className="hidden lg:table-cell">Ưu tiên</th>
                <th className="hidden md:table-cell">Trạng thái</th>
                <th className="hidden min-w-64 xl:table-cell">
                  <div className="font-normal flex justify-between normal-case">
                    <span>{format(min, "dd/MM/yy")}</span>
                    <span>{format(addDays(min, span - 1), "dd/MM/yy")}</span>
                  </div>
                </th>
                <th className="no-print" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ item, depth }) => (
                <tr
                  key={item.id}
                  className={clsx(
                    "hover:bg-brand-50/60 cursor-pointer",
                    item.level === "category" && "bg-slate-50 font-semibold"
                  )}
                  onClick={() => setEditing({ item, level: item.level })}
                >
                  <td className="whitespace-nowrap">{item.code}</td>
                  <td>
                    <div className="flex items-center gap-2" style={{ paddingLeft: depth * 16 }}>
                      <span className="max-w-72 truncate">{item.name}</span>
                      {item.is_overdue && <Badge tone="red">Quá hạn</Badge>}
                    </div>
                  </td>
                  <td className="hidden whitespace-nowrap md:table-cell">
                    {item.assignee_detail?.display_name ?? "—"}
                  </td>
                  <td className="hidden whitespace-nowrap md:table-cell">{fmtDate(item.start_date)}</td>
                  <td className="hidden whitespace-nowrap md:table-cell">{fmtDate(item.end_date)}</td>
                  <td className="hidden text-right tabular-nums lg:table-cell">{item.duration_days}</td>
                  <td>
                    <ProgressBar value={Number(item.progress)} className="w-32" />
                  </td>
                  <td className="hidden lg:table-cell">
                    <Badge tone={toneOf(PRIORITY, item.priority)}>{labelOf(PRIORITY, item.priority)}</Badge>
                  </td>
                  <td className="hidden md:table-cell">
                    <Badge tone={toneOf(SCHEDULE_STATUS, item.status)}>{labelOf(SCHEDULE_STATUS, item.status)}</Badge>
                  </td>
                  <td className="relative hidden xl:table-cell">
                    {todayPos >= 0 && todayPos <= 100 && (
                      <div
                        className="bg-red-400 absolute top-0 bottom-0 w-px"
                        style={{ left: `calc(0.75rem + (100% - 1.5rem) * ${todayPos / 100})` }}
                      />
                    )}
                    <Gantt item={item} min={min} span={span} />
                  </td>
                  <td className="no-print">
                    {can("schedule.create") && CHILD_LEVEL[item.level] && (
                      <button
                        type="button"
                        title={`Thêm ${labelOf(SCHEDULE_LEVEL, CHILD_LEVEL[item.level]).toLowerCase()}`}
                        className="text-slate-400 hover:bg-brand-100 hover:text-brand-700 rounded p-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditing({ parent: item, level: CHILD_LEVEL[item.level]! });
                        }}
                      >
                        <Plus className="size-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <ItemForm
          projectId={projectId}
          item={editing.item}
          parent={editing.parent}
          level={editing.level}
          all={items}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </Card>
  );
}
