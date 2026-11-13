import { Plus } from "lucide-react";
import { useState } from "react";

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
  Tabs,
  Textarea,
  useAction,
  useUi,
} from "@/components/ui";
import { api, downloadExport, type Page } from "@/lib/api";
import { fmtMoney } from "@/lib/format";
import { useFetch, useList } from "@/lib/hooks";
import { SUPPLIER_STATUS, labelOf, toneOf } from "@/lib/labels";
import { useSession } from "@/lib/session";
import type { Material, Supplier } from "@/lib/types";

function SupplierModal({
  supplier,
  onClose,
  onSaved,
}: {
  supplier: Supplier | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { ws, can } = useSession();
  const { confirm } = useUi();
  const { run } = useAction();
  const form = useForm({
    code: supplier?.code ?? "",
    name: supplier?.name ?? "",
    tax_code: supplier?.tax_code ?? "",
    category: supplier?.category ?? "",
    contact_person: supplier?.contact_person ?? "",
    phone: supplier?.phone ?? "",
    email: supplier?.email ?? "",
    address: supplier?.address ?? "",
    status: supplier?.status ?? "active",
    notes: supplier?.notes ?? "",
  });
  const { bind, errors } = form;
  const editable = supplier ? can("supplier.update") : can("supplier.create");
  const save = () =>
    form
      .submit(
        (v) => (supplier ? api.patch(ws(`/suppliers/${supplier.id}/`), v) : api.post(ws("/suppliers/"), v)),
        "Đã lưu nhà cung cấp"
      )
      .then((r) => r && onSaved());
  const remove = async () => {
    if (!supplier) return;
    const { ok } = await confirm({
      title: "Xóa nhà cung cấp?",
      message: supplier.name,
      danger: true,
      confirmText: "Xóa",
    });
    if (ok && (await run(() => api.del(ws(`/suppliers/${supplier.id}/`)), "Đã xóa")) !== undefined) onSaved();
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={supplier ? supplier.name : "Thêm nhà cung cấp"}
      footer={
        <>
          {supplier && can("supplier.delete") && (
            <Button variant="danger" className="mr-auto" onClick={() => void remove()}>
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
        <Field label="Mã NCC" required error={errors.code}>
          <Input disabled={!editable} {...bind("code")} />
        </Field>
        <Field label="Tên nhà cung cấp" required error={errors.name}>
          <Input disabled={!editable} {...bind("name")} />
        </Field>
        <Field label="Mã số thuế" error={errors.tax_code}>
          <Input disabled={!editable} {...bind("tax_code")} />
        </Field>
        <Field label="Nhóm cung cấp" error={errors.category}>
          <Input disabled={!editable} {...bind("category")} placeholder="VD: Thép, bê tông, MEP" />
        </Field>
        <Field label="Người liên hệ">
          <Input disabled={!editable} {...bind("contact_person")} />
        </Field>
        <Field label="Điện thoại">
          <Input disabled={!editable} type="tel" {...bind("phone")} />
        </Field>
        <Field label="Email" error={errors.email}>
          <Input disabled={!editable} type="email" {...bind("email")} />
        </Field>
        <Field label="Trạng thái">
          <Select disabled={!editable} options={SUPPLIER_STATUS} {...bind("status")} />
        </Field>
        <Field label="Địa chỉ" className="md:col-span-2">
          <Input disabled={!editable} {...bind("address")} />
        </Field>
        <Field label="Ghi chú" className="md:col-span-2">
          <Textarea disabled={!editable} {...bind("notes")} />
        </Field>
      </div>
    </Modal>
  );
}

function MaterialModal({
  material,
  onClose,
  onSaved,
}: {
  material: Material | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { ws, can } = useSession();
  const { confirm } = useUi();
  const { run } = useAction();
  const suppliers = useFetch<Page<Supplier>>(ws("/suppliers/"), { page_size: 200, status: "active" });
  const form = useForm({
    code: material?.code ?? "",
    name: material?.name ?? "",
    unit: material?.unit ?? "",
    category: material?.category ?? "",
    specification: material?.specification ?? "",
    supplier: material?.supplier ?? "",
    reference_price: material?.reference_price ?? "0",
  });
  const { bind, errors } = form;
  const editable = material ? can("material.update") : can("material.create");
  const save = () =>
    form
      .submit(
        (v) =>
          material ? api.patch(ws(`/materials/${material.id}/`), clean(v)) : api.post(ws("/materials/"), clean(v)),
        "Đã lưu vật tư"
      )
      .then((r) => r && onSaved());
  const remove = async () => {
    if (!material) return;
    const { ok } = await confirm({ title: "Xóa vật tư?", message: material.name, danger: true, confirmText: "Xóa" });
    if (ok && (await run(() => api.del(ws(`/materials/${material.id}/`)), "Đã xóa")) !== undefined) onSaved();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={material ? material.name : "Thêm vật tư"}
      footer={
        <>
          {material && can("material.delete") && (
            <Button variant="danger" className="mr-auto" onClick={() => void remove()}>
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
        <Field label="Mã vật tư" required error={errors.code}>
          <Input disabled={!editable} {...bind("code")} />
        </Field>
        <Field label="Tên vật tư" required error={errors.name}>
          <Input disabled={!editable} {...bind("name")} />
        </Field>
        <Field label="Đơn vị tính" required error={errors.unit}>
          <Input disabled={!editable} {...bind("unit")} placeholder="kg, m3, m, bộ..." />
        </Field>
        <Field label="Nhóm vật tư" error={errors.category}>
          <Input disabled={!editable} {...bind("category")} />
        </Field>
        <Field label="Nhà cung cấp" error={errors.supplier}>
          <Select
            disabled={!editable}
            placeholder="— Chọn NCC —"
            options={(suppliers.data?.results ?? []).map((s) => ({ value: s.id, label: s.name }))}
            {...bind("supplier")}
          />
        </Field>
        <Field label="Đơn giá tham khảo (VNĐ)" error={errors.reference_price}>
          <Input disabled={!editable} type="number" min={0} {...bind("reference_price")} />
        </Field>
        <Field label="Quy cách / thông số" className="md:col-span-2">
          <Textarea disabled={!editable} {...bind("specification")} />
        </Field>
      </div>
    </Modal>
  );
}

function Suppliers() {
  const { ws, can } = useSession();
  const list = useList<Supplier>(ws("/suppliers/"), { status: "" });
  const [open, setOpen] = useState<Supplier | null | undefined>(undefined);
  const columns: Column<Supplier>[] = [
    { key: "code", header: "Mã" },
    { key: "name", header: "Nhà cung cấp", render: (s) => <span className="font-medium">{s.name}</span> },
    { key: "category", header: "Nhóm", hideOnMobile: true, render: (s) => s.category || "—" },
    { key: "tax", header: "MST", hideOnMobile: true, render: (s) => s.tax_code || "—" },
    {
      key: "contact",
      header: "Liên hệ",
      render: (s) => (
        <div className="text-xs">
          {s.contact_person}
          <br />
          {s.phone}
        </div>
      ),
    },
    { key: "materials", header: "Số vật tư", hideOnMobile: true, render: (s) => s.material_count },
    {
      key: "status",
      header: "Trạng thái",
      render: (s) => <Badge tone={toneOf(SUPPLIER_STATUS, s.status)}>{labelOf(SUPPLIER_STATUS, s.status)}</Badge>,
    },
  ];
  return (
    <Card bodyClassName="p-0">
      <Toolbar
        q={list.q}
        onQ={list.setQ}
        placeholder="Tìm tên, MST, SĐT..."
        onExport={() => downloadExport(ws("/suppliers/"), list.query)}
        right={
          can("supplier.create") && (
            <Button icon={<Plus className="size-4" />} onClick={() => setOpen(null)}>
              Thêm NCC
            </Button>
          )
        }
      >
        <Select
          className="w-full sm:w-44"
          placeholder="Mọi trạng thái"
          options={SUPPLIER_STATUS}
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
        onRowClick={setOpen}
      />
      <ListFooter data={list.data} setPage={list.setPage} />
      {open !== undefined && (
        <SupplierModal
          supplier={open}
          onClose={() => setOpen(undefined)}
          onSaved={() => {
            setOpen(undefined);
            void list.reload();
          }}
        />
      )}
    </Card>
  );
}

function Materials() {
  const { ws, can } = useSession();
  const list = useList<Material>(ws("/materials/"), {});
  const [open, setOpen] = useState<Material | null | undefined>(undefined);
  const columns: Column<Material>[] = [
    { key: "code", header: "Mã" },
    { key: "name", header: "Tên vật tư", render: (m) => <span className="font-medium">{m.name}</span> },
    { key: "unit", header: "ĐVT" },
    { key: "category", header: "Nhóm", hideOnMobile: true, render: (m) => m.category || "—" },
    { key: "supplier", header: "Nhà cung cấp", render: (m) => m.supplier_name ?? "—" },
    { key: "price", header: "Đơn giá tham khảo", className: "text-right", render: (m) => fmtMoney(m.reference_price) },
  ];
  return (
    <Card bodyClassName="p-0">
      <Toolbar
        q={list.q}
        onQ={list.setQ}
        placeholder="Tìm mã, tên vật tư..."
        onExport={() => downloadExport(ws("/materials/"), list.query)}
        right={
          can("material.create") && (
            <Button icon={<Plus className="size-4" />} onClick={() => setOpen(null)}>
              Thêm vật tư
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
        onRowClick={setOpen}
      />
      <ListFooter data={list.data} setPage={list.setPage} />
      {open !== undefined && (
        <MaterialModal
          material={open}
          onClose={() => setOpen(undefined)}
          onSaved={() => {
            setOpen(undefined);
            void list.reload();
          }}
        />
      )}
    </Card>
  );
}

export function MaterialsPage() {
  const { can } = useSession();
  const [tab, setTab] = useState(can("material.view") ? "materials" : "suppliers");
  const tabs = [
    ...(can("material.view") ? [{ value: "materials", label: "Danh mục vật tư" }] : []),
    ...(can("supplier.view") ? [{ value: "suppliers", label: "Nhà cung cấp" }] : []),
  ];
  return (
    <div>
      <PageHeader title="Vật tư & nhà cung cấp" subtitle="Danh mục dùng chung cho đề xuất mua hàng và dự toán" />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === "materials" ? <Materials /> : <Suppliers />}
    </div>
  );
}
