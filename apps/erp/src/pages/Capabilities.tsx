import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";

import { Attachments } from "@/components/Attachments";
import { DataTable, ListFooter, Toolbar, type Column } from "@/components/DataTable";
import { clean, useForm } from "@/components/form";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Textarea,
  useAction,
  useUi,
} from "@/components/ui";
import { api, downloadExport } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useList } from "@/lib/hooks";
import { CAPABILITY_CATEGORY, labelOf } from "@/lib/labels";
import { useSession } from "@/lib/session";
import type { CapabilityDoc } from "@/lib/types";

function CapabilityModal({
  doc,
  onClose,
  onSaved,
}: {
  doc: CapabilityDoc | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { ws, can } = useSession();
  const { confirm } = useUi();
  const { run } = useAction();
  const [current, setCurrent] = useState(doc);
  const editable = current ? can("capability.update") : can("capability.create");
  const form = useForm({
    category: doc?.category ?? "certificate",
    title: doc?.title ?? "",
    number: doc?.number ?? "",
    issuer: doc?.issuer ?? "",
    issue_date: doc?.issue_date ?? "",
    expiry_date: doc?.expiry_date ?? "",
    notes: doc?.notes ?? "",
    is_active: doc?.is_active ?? true,
  });
  const { bind, errors } = form;
  const save = async () => {
    const res = await form.submit(
      (v) =>
        current
          ? api.patch<CapabilityDoc>(ws(`/capability-documents/${current.id}/`), clean(v))
          : api.post<CapabilityDoc>(ws("/capability-documents/"), clean(v)),
      "Đã lưu hồ sơ năng lực"
    );
    if (res) {
      setCurrent(res);
      onSaved();
    }
  };
  const remove = async () => {
    if (!current) return;
    const { ok } = await confirm({
      title: "Xóa hồ sơ năng lực?",
      message: `${current.title}${current.tender_count ? ` (đang dùng cho ${current.tender_count} gói thầu)` : ""}`,
      danger: true,
      confirmText: "Xóa",
    });
    if (ok && (await run(() => api.del(ws(`/capability-documents/${current.id}/`)), "Đã xóa")) !== undefined) {
      onSaved();
      onClose();
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={current ? current.title : "Thêm hồ sơ năng lực"}
      footer={
        <>
          {current && can("capability.delete") && (
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
          {editable && (
            <Button loading={form.saving} onClick={() => void save()}>
              Lưu
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Nhóm" error={errors.category}>
          <Select disabled={!editable} options={CAPABILITY_CATEGORY} {...bind("category")} />
        </Field>
        <Field label="Tên hồ sơ" required error={errors.title}>
          <Input disabled={!editable} {...bind("title")} placeholder="VD: Chứng chỉ năng lực hạng I" />
        </Field>
        <Field label="Số hiệu" error={errors.number}>
          <Input disabled={!editable} {...bind("number")} />
        </Field>
        <Field label="Cơ quan cấp / chủ đầu tư" error={errors.issuer}>
          <Input disabled={!editable} {...bind("issuer")} />
        </Field>
        <Field label="Ngày cấp" error={errors.issue_date}>
          <Input type="date" disabled={!editable} {...bind("issue_date")} />
        </Field>
        <Field label="Ngày hết hạn" error={errors.expiry_date} hint="Hệ thống nhắc trước 30 ngày">
          <Input type="date" disabled={!editable} {...bind("expiry_date")} />
        </Field>
        <Field label="Ghi chú" className="md:col-span-2">
          <Textarea disabled={!editable} {...bind("notes")} />
        </Field>
      </div>
      {current ? (
        <div className="mt-4">
          <div className="text-sm text-slate-700 mb-2 font-medium">Bản scan / tệp hồ sơ</div>
          <Attachments entityType="capability" entityId={current.id} canUpload={editable} onChange={onSaved} />
        </div>
      ) : (
        <p className="text-xs text-slate-500 mt-4">Lưu thông tin trước, sau đó tải bản scan lên.</p>
      )}
    </Modal>
  );
}

export function CapabilitiesPage() {
  const { ws, can } = useSession();
  const [params] = useSearchParams();
  const list = useList<CapabilityDoc>(ws("/capability-documents/"), { category: "", expiring: "" });
  const [open, setOpen] = useState<CapabilityDoc | null | undefined>(undefined);
  const openId = params.get("id");
  useEffect(() => {
    if (openId)
      void api
        .get<CapabilityDoc>(ws(`/capability-documents/${openId}/`))
        .then(setOpen)
        .catch(() => undefined);
  }, [openId, ws]);
  const columns: Column<CapabilityDoc>[] = [
    {
      key: "title",
      header: "Hồ sơ",
      render: (d) => (
        <div className="max-w-80">
          <div className="truncate font-medium">{d.title}</div>
          <div className="text-xs text-slate-500 truncate">{d.number}</div>
        </div>
      ),
    },
    { key: "category", header: "Nhóm", render: (d) => labelOf(CAPABILITY_CATEGORY, d.category) },
    { key: "issuer", header: "Cơ quan cấp", hideOnMobile: true, render: (d) => d.issuer || "—" },
    { key: "issue", header: "Ngày cấp", hideOnMobile: true, render: (d) => fmtDate(d.issue_date) },
    {
      key: "expiry",
      header: "Hết hạn",
      render: (d) =>
        !d.expiry_date ? (
          "Không thời hạn"
        ) : d.is_expired ? (
          <Badge tone="red">Đã hết hạn {fmtDate(d.expiry_date)}</Badge>
        ) : d.days_to_expiry !== null && d.days_to_expiry <= 30 ? (
          <Badge tone="amber">
            Còn {d.days_to_expiry} ngày ({fmtDate(d.expiry_date)})
          </Badge>
        ) : (
          fmtDate(d.expiry_date)
        ),
    },
    { key: "files", header: "Tệp", hideOnMobile: true, render: (d) => d.attachment_count },
    { key: "tenders", header: "Dùng cho gói thầu", hideOnMobile: true, render: (d) => d.tender_count },
  ];
  return (
    <div>
      <PageHeader
        title="Thư viện hồ sơ năng lực"
        subtitle="Giấy phép, chứng chỉ, báo cáo tài chính, hợp đồng tương tự, nhân sự, thiết bị... dùng chung cho mọi gói thầu và nhắc khi sắp hết hạn"
        actions={
          can("capability.create") && (
            <Button icon={<Plus className="size-4" />} onClick={() => setOpen(null)}>
              Thêm hồ sơ
            </Button>
          )
        }
      />
      <Card bodyClassName="p-0">
        <Toolbar
          q={list.q}
          onQ={list.setQ}
          placeholder="Tìm tên, số hiệu, cơ quan cấp..."
          onExport={() => downloadExport(ws("/capability-documents/"), list.query)}
        >
          <Select
            className="w-full sm:w-56"
            placeholder="Mọi nhóm"
            options={CAPABILITY_CATEGORY}
            value={String(list.filters.category ?? "")}
            onChange={(e) => list.setFilter("category", e.target.value)}
          />
          <label className="text-sm text-slate-600 flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={list.filters.expiring === "30"}
              onChange={(e) => list.setFilter("expiring", e.target.checked ? "30" : "")}
            />{" "}
            Sắp / đã hết hạn (30 ngày)
          </label>
        </Toolbar>
        <DataTable
          columns={columns}
          rows={list.data?.results}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          onRowClick={setOpen}
          empty="Chưa có hồ sơ năng lực."
        />
        <ListFooter data={list.data} setPage={list.setPage} />
        {open !== undefined && (
          <CapabilityModal doc={open} onClose={() => setOpen(undefined)} onSaved={() => void list.reload()} />
        )}
      </Card>
    </div>
  );
}
