import { clsx } from "clsx";
import { useNavigate } from "react-router";

import { ListFooter } from "@/components/DataTable";
import { Button, Card, Empty, PageHeader, Select, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useList } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import type { NotificationItem } from "@/lib/types";

const TYPES = [
  { value: "task_new", label: "Công việc mới" },
  { value: "task_due_soon", label: "Sắp đến hạn" },
  { value: "task_overdue", label: "Quá hạn" },
  { value: "approval_request", label: "Yêu cầu phê duyệt" },
  { value: "purchase_request", label: "Đề xuất mua hàng" },
  { value: "acceptance_required", label: "Hồ sơ cần nghiệm thu" },
  { value: "approval_result", label: "Kết quả phê duyệt" },
  { value: "schedule_delayed", label: "Chậm tiến độ" },
  { value: "tender_deadline", label: "Hạn đấu thầu" },
  { value: "document_expiry", label: "Hồ sơ năng lực sắp hết hạn" },
];

export function NotificationsPage() {
  const { ws } = useSession();
  const navigate = useNavigate();
  const list = useList<NotificationItem>(ws("/notifications/"), { unread: "", type: "" }, 30);
  return (
    <div>
      <PageHeader
        title="Thông báo"
        actions={
          <Button
            variant="secondary"
            onClick={async () => {
              await api.post(ws("/notifications/read-all/"));
              void list.reload();
            }}
          >
            Đánh dấu đã đọc tất cả
          </Button>
        }
      />
      <Card bodyClassName="p-0">
        <div className="border-slate-100 flex flex-wrap gap-2 border-b p-3">
          <Select
            className="w-44"
            options={[
              { value: "", label: "Tất cả" },
              { value: "true", label: "Chưa đọc" },
            ]}
            value={String(list.filters.unread ?? "")}
            onChange={(e) => list.setFilter("unread", e.target.value)}
          />
          <Select
            className="w-52"
            placeholder="Mọi loại thông báo"
            options={TYPES}
            value={String(list.filters.type ?? "")}
            onChange={(e) => list.setFilter("type", e.target.value)}
          />
        </div>
        {!list.data ? (
          <Spinner />
        ) : list.data.results.length === 0 ? (
          <Empty>Không có thông báo.</Empty>
        ) : (
          <ul className="divide-slate-100 divide-y">
            {list.data.results.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className={clsx("hover:bg-slate-50 block w-full px-4 py-3 text-left", !n.read_at && "bg-brand-50/50")}
                  onClick={async () => {
                    if (!n.read_at) await api.post(ws(`/notifications/${n.id}/read/`)).catch(() => undefined);
                    if (n.link) navigate(n.link);
                    else void list.reload();
                  }}
                >
                  <div className="text-xs text-brand-700">
                    {n.type_label} · {fmtDateTime(n.created_at)}
                  </div>
                  <div className="text-sm font-medium">{n.title}</div>
                  {n.message && <div className="text-sm text-slate-500">{n.message}</div>}
                </button>
              </li>
            ))}
          </ul>
        )}
        <ListFooter data={list.data} setPage={list.setPage} />
      </Card>
    </div>
  );
}
