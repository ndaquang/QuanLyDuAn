const BASE = "/api/construction";

export class ApiError extends Error {
  status: number;
  data: unknown;
  fields: Record<string, string>;
  constructor(status: number, data: unknown) {
    super(extractMessage(data, status));
    this.status = status;
    this.data = data;
    this.fields = extractFields(data);
  }
}

function asText(value: unknown): string {
  if (Array.isArray(value)) return value.map(asText).join(" ");
  if (value && typeof value === "object") return Object.values(value).map(asText).join(" ");
  return value == null ? "" : String(value);
}

function extractFields(data: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (data && typeof data === "object" && !Array.isArray(data)) {
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (k !== "error" && k !== "detail" && k !== "code") out[k] = asText(v);
    }
  }
  return out;
}

function extractMessage(data: unknown, status: number): string {
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (d.error) return asText(d.error);
    if (d.detail) return asText(d.detail);
    const first = Object.values(d)[0];
    if (first) return asText(first);
  }
  if (status === 0) return "Không kết nối được máy chủ. Kiểm tra mạng và thử lại.";
  if (status === 403) return "Bạn không có quyền thực hiện thao tác này.";
  if (status === 404) return "Không tìm thấy dữ liệu.";
  if (status >= 500) return "Máy chủ gặp lỗi. Vui lòng thử lại sau.";
  return "Có lỗi xảy ra.";
}

export type Query = Record<string, string | number | boolean | null | undefined>;

export function qs(query?: Query): string {
  if (!query) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export async function request<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; query?: Query; form?: FormData } = {}
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}${qs(opts.query)}`, {
      method: opts.method || "GET",
      credentials: "include",
      headers,
      body,
    });
  } catch {
    throw new ApiError(0, null);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text.slice(0, 200) };
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>(path, { query }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: body ?? {} }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body }),
  del: (path: string) => request<void>(path, { method: "DELETE" }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: "POST", form }),
};

/** Absolute URL of an endpoint (used for file downloads / Excel exports through the browser). */
export function url(path: string, query?: Query) {
  return `${BASE}${path}${qs(query)}`;
}

export function downloadExport(path: string, query?: Query) {
  window.location.href = url(path, { ...query, export: "xlsx", page: undefined, page_size: undefined });
}

export interface Page<T> {
  results: T[];
  count: number;
  page: number;
  page_size: number;
  total_pages: number;
}
