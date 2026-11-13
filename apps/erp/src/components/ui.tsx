import { clsx } from "clsx";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Loader2, X, XCircle } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

import type { Option, Tone } from "@/lib/labels";

// ---------------------------------------------------------------- buttons
type Variant = "primary" | "secondary" | "danger" | "ghost" | "success";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-navy-700 text-white hover:bg-navy-800 focus-visible:ring-navy-600",
  secondary: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 focus-visible:ring-slate-400",
  danger: "bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500",
  success: "bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-500",
  ghost: "text-slate-600 hover:bg-slate-100 focus-visible:ring-slate-300",
};

export function Button({
  variant = "primary",
  size = "md",
  loading,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm" | "md";
  loading?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "text-xs h-8 px-2.5" : "text-sm h-9 px-3.5",
        VARIANTS[variant],
        className
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- form controls
/** Controls are full width unless the caller sets its own width (w-*). */
function widthOf(className?: string) {
  return className && /(^|\s)(\w+:)?w-/.test(className) ? "" : "w-full";
}

const control =
  "block rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-xs placeholder:text-slate-400 focus:border-brand-600 focus:ring-2 focus:ring-brand-100 focus:outline-none disabled:bg-slate-100";

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={clsx(control, widthOf(className), "h-9 py-0", className)} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...rest} className={clsx(control, widthOf(className), className)} />;
}

export function Select({
  options,
  placeholder,
  className,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { options: Option[]; placeholder?: string }) {
  return (
    <select {...rest} className={clsx(control, widthOf(className), "h-9 py-0 pr-8", className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Field({
  label,
  error,
  required,
  hint,
  children,
  className,
  group,
}: {
  label: string;
  error?: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
  className?: string;
  /** Wraps several controls (checkbox list): rendered as a div, since labels cannot nest. */
  group?: boolean;
}) {
  const Tag = group ? "div" : "label";
  return (
    <Tag className={clsx("block", className)} role={group ? "group" : undefined} aria-label={group ? label : undefined}>
      <span className="text-sm text-slate-700 mb-1 block font-medium">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </span>
      {children}
      {hint && !error && <span className="text-xs text-slate-500 mt-1 block">{hint}</span>}
      {error && <span className="text-xs text-red-600 mt-1 block">{error}</span>}
    </Tag>
  );
}

// ---------------------------------------------------------------- display
const TONES: Record<Tone, string> = {
  gray: "bg-slate-100 text-slate-700 ring-slate-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  navy: "bg-navy-50 text-navy-700 ring-navy-100",
  sky: "bg-brand-50 text-brand-700 ring-brand-100",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
};

export function Badge({
  tone = "gray",
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "text-xs inline-flex items-center rounded-full px-2 py-0.5 font-medium whitespace-nowrap ring-1 ring-inset",
        TONES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

export function Card({
  title,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={clsx("border-slate-200 shadow-xs rounded-lg border bg-white", className)}>
      {(title || actions) && (
        <header className="border-slate-100 flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <h3 className="text-sm text-slate-800 font-semibold">{title}</h3>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={clsx("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl text-navy-800 font-semibold">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function ProgressBar({ value, planned, className }: { value: number; planned?: number; className?: string }) {
  const v = Math.max(0, Math.min(100, value));
  const behind = planned !== undefined && planned - value > 10;
  return (
    <div className={clsx("flex items-center gap-2", className)}>
      <div className="bg-slate-200 relative h-2 w-full min-w-16 overflow-hidden rounded-full">
        <div
          className={clsx("h-full rounded-full", behind ? "bg-red-500" : v >= 100 ? "bg-emerald-500" : "bg-brand-600")}
          style={{ width: `${v}%` }}
        />
        {planned !== undefined && (
          <div
            className="bg-navy-800 absolute top-0 h-full w-0.5"
            style={{ left: `${Math.max(0, Math.min(100, planned))}%` }}
            title={`Kế hoạch ${planned.toFixed(1)}%`}
          />
        )}
      </div>
      <span className="text-xs text-slate-600 w-12 shrink-0 text-right tabular-nums">{v.toFixed(0)}%</span>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <div className={clsx("text-slate-400 flex items-center justify-center py-10", className)}>
      <Loader2 className="size-6 animate-spin" />
    </div>
  );
}

export function Empty({ children = "Chưa có dữ liệu", action }: { children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="text-sm text-slate-500 flex flex-col items-center gap-3 py-10 text-center">
      <div>{children}</div>
      {action}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="border-red-200 bg-red-50 text-sm text-red-700 flex items-center justify-between gap-3 rounded-md border px-4 py-3">
      <span className="flex items-center gap-2">
        <AlertTriangle className="size-4" /> {message}
      </span>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Thử lại
        </Button>
      )}
    </div>
  );
}

export function Tabs({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: string; label: ReactNode }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="no-print border-slate-200 -mx-1 mb-4 flex gap-1 overflow-x-auto border-b px-1">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          className={clsx(
            "text-sm -mb-px border-b-2 px-3 py-2 font-medium whitespace-nowrap transition",
            value === t.value
              ? "border-brand-600 text-navy-800"
              : "text-slate-500 hover:text-slate-800 border-transparent"
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  count,
  onChange,
}: {
  page: number;
  totalPages: number;
  count: number;
  onChange: (p: number) => void;
}) {
  return (
    <div className="no-print border-slate-100 text-sm text-slate-600 flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
      <span>
        Tổng <strong>{count.toLocaleString("vi-VN")}</strong> bản ghi
      </span>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          aria-label="Trang trước"
          icon={<ChevronLeft className="size-4" />}
        />
        <span className="px-2 tabular-nums">
          {page} / {totalPages}
        </span>
        <Button
          size="sm"
          variant="ghost"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
          aria-label="Trang sau"
          icon={<ChevronRight className="size-4" />}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- overlays
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  const width = { sm: "max-w-md", md: "max-w-2xl", lg: "max-w-4xl", xl: "max-w-6xl" }[size];
  return (
    <div
      className="bg-slate-900/50 fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className={clsx("shadow-xl flex max-h-[95vh] w-full flex-col rounded-t-xl bg-white sm:rounded-xl", width)}>
        <header className="border-slate-200 flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-base text-navy-800 font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:bg-slate-100 hover:text-slate-700 rounded p-1"
            aria-label="Đóng"
          >
            <X className="size-5" />
          </button>
        </header>
        <div className="overflow-y-auto px-4 py-4">{children}</div>
        {footer && (
          <footer className="border-slate-200 flex flex-wrap justify-end gap-2 border-t px-4 py-3">{footer}</footer>
        )}
      </div>
    </div>
  );
}

interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmText?: string;
  danger?: boolean;
  /** Ask for a comment (approve / reject). Required when `requireInput` is true. */
  input?: { label: string; required?: boolean; placeholder?: string };
}

interface UiApi {
  toast: (message: string, tone?: "success" | "error" | "info") => void;
  confirm: (opts: ConfirmOptions) => Promise<{ ok: boolean; value: string }>;
}

const UiContext = createContext<UiApi | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; message: string; tone: string }[]>([]);
  const [dialog, setDialog] = useState<
    (ConfirmOptions & { resolve: (r: { ok: boolean; value: string }) => void }) | null
  >(null);
  const [value, setValue] = useState("");
  const idRef = useRef(0);

  const toast = useCallback((message: string, tone: "success" | "error" | "info" = "success") => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 6000 : 3500);
  }, []);

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<{ ok: boolean; value: string }>((resolve) => {
        setValue("");
        setDialog({ ...opts, resolve });
      }),
    []
  );

  const uiApi = useMemo(() => ({ toast, confirm }), [toast, confirm]);

  const close = (ok: boolean) => {
    if (!dialog) return;
    if (ok && dialog.input?.required && !value.trim()) return;
    dialog.resolve({ ok, value });
    setDialog(null);
  };

  return (
    <UiContext.Provider value={uiApi}>
      {children}
      <div className="no-print fixed right-4 bottom-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={clsx(
              "text-sm shadow-lg flex items-start gap-2 rounded-lg px-4 py-3 text-white",
              t.tone === "error" ? "bg-red-600" : t.tone === "info" ? "bg-navy-700" : "bg-emerald-600"
            )}
          >
            {t.tone === "error" ? (
              <XCircle className="mt-0.5 size-4 shrink-0" />
            ) : (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            )}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
      <Modal
        open={Boolean(dialog)}
        title={dialog?.title ?? ""}
        onClose={() => close(false)}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => close(false)}>
              Hủy bỏ
            </Button>
            <Button
              variant={dialog?.danger ? "danger" : "primary"}
              onClick={() => close(true)}
              disabled={Boolean(dialog?.input?.required && !value.trim())}
            >
              {dialog?.confirmText ?? "Đồng ý"}
            </Button>
          </>
        }
      >
        {dialog?.message && <div className="text-sm text-slate-600">{dialog.message}</div>}
        {dialog?.input && (
          <Field label={dialog.input.label} required={dialog.input.required} className="mt-3">
            <Textarea value={value} onChange={(e) => setValue(e.target.value)} placeholder={dialog.input.placeholder} />
          </Field>
        )}
      </Modal>
    </UiContext.Provider>
  );
}

export function useUi() {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error("useUi must be used inside UiProvider");
  return ctx;
}

/** Run an API call with a toast on success and a readable error toast on failure. */
export function useAction() {
  const { toast } = useUi();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      setBusy(true);
      try {
        const res = await fn();
        if (success) toast(success);
        return res;
      } catch (e) {
        toast(e instanceof Error ? e.message : "Có lỗi xảy ra", "error");
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast]
  );
  return { run, busy };
}
