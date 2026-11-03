import { Camera, FileText, Paperclip, Trash2, Upload } from "lucide-react";
import { useRef } from "react";

import { api } from "@/lib/api";
import { fmtDateTime, fmtSize } from "@/lib/format";
import { useFetch } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import type { Attachment } from "@/lib/types";

import { Button, Empty, Spinner, useAction, useUi } from "./ui";

/** File list for any record, with upload from computer or phone camera. */
export function Attachments({
  entityType,
  entityId,
  canUpload,
  onChange,
}: {
  entityType: string;
  entityId: string;
  canUpload: boolean;
  onChange?: () => void;
}) {
  const { ws } = useSession();
  const { data, loading, reload } = useFetch<Attachment[]>(ws("/attachments/"), {
    entity_type: entityType,
    entity_id: entityId,
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const { run, busy } = useAction();
  const { confirm } = useUi();

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const form = new FormData();
    form.set("entity_type", entityType);
    form.set("entity_id", entityId);
    Array.from(files).forEach((f) => form.append("file", f));
    const res = await run(() => api.upload(ws("/attachments/"), form), `Đã tải lên ${files.length} tệp`);
    if (fileRef.current) fileRef.current.value = "";
    if (cameraRef.current) cameraRef.current.value = "";
    if (res) {
      void reload();
      onChange?.();
    }
  };

  const remove = async (a: Attachment) => {
    const { ok } = await confirm({
      title: "Xóa tệp đính kèm?",
      message: `Tệp "${a.file_name}" sẽ bị gỡ khỏi hồ sơ.`,
      danger: true,
      confirmText: "Xóa",
    });
    if (!ok) return;
    await run(() => api.del(ws(`/attachments/${a.id}/`)), "Đã xóa tệp");
    void reload();
    onChange?.();
  };

  const images = (data ?? []).filter((a) => a.content_type.startsWith("image/"));
  const others = (data ?? []).filter((a) => !a.content_type.startsWith("image/"));

  return (
    <div className="space-y-3">
      {canUpload && (
        <div className="no-print flex flex-wrap gap-2">
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => void upload(e.target.files)} />
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => void upload(e.target.files)}
          />
          <Button
            variant="secondary"
            icon={<Upload className="size-4" />}
            loading={busy}
            onClick={() => fileRef.current?.click()}
          >
            Tải tệp lên
          </Button>
          <Button
            variant="secondary"
            icon={<Camera className="size-4" />}
            disabled={busy}
            onClick={() => cameraRef.current?.click()}
          >
            Chụp ảnh
          </Button>
        </div>
      )}
      {loading && !data ? (
        <Spinner />
      ) : !data?.length ? (
        <Empty>
          <span className="inline-flex items-center gap-1">
            <Paperclip className="size-4" /> Chưa có tệp đính kèm
          </span>
        </Empty>
      ) : (
        <>
          {images.length > 0 && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {images.map((a) => (
                <div key={a.id} className="group border-slate-200 relative overflow-hidden rounded-md border">
                  <a href={a.url} target="_blank" rel="noreferrer">
                    <img src={a.url} alt={a.file_name} className="aspect-square w-full object-cover" loading="lazy" />
                  </a>
                  {canUpload && (
                    <button
                      type="button"
                      onClick={() => void remove(a)}
                      className="no-print text-red-600 shadow absolute top-1 right-1 rounded bg-white/90 p-1 opacity-0 group-hover:opacity-100"
                      aria-label="Xóa ảnh"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {others.length > 0 && (
            <ul className="divide-slate-100 border-slate-200 divide-y rounded-md border">
              {others.map((a) => (
                <li key={a.id} className="text-sm flex items-center gap-3 px-3 py-2">
                  <FileText className="text-slate-400 size-4 shrink-0" />
                  <a href={`${a.url}?download=1`} className="text-brand-700 min-w-0 flex-1 truncate hover:underline">
                    {a.file_name}
                  </a>
                  <span className="text-xs text-slate-500 hidden sm:inline">
                    {fmtSize(a.size)} · {a.uploaded_by?.display_name} · {fmtDateTime(a.created_at)}
                  </span>
                  {canUpload && (
                    <button
                      type="button"
                      onClick={() => void remove(a)}
                      className="no-print text-slate-400 hover:text-red-600 rounded p-1"
                      aria-label="Xóa tệp"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
