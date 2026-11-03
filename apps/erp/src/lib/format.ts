import { format, parseISO } from "date-fns";

export function fmtDate(value?: string | null) {
  if (!value) return "—";
  try {
    return format(parseISO(value), "dd/MM/yyyy");
  } catch {
    return value;
  }
}

export function fmtDateTime(value?: string | null) {
  if (!value) return "—";
  try {
    return format(parseISO(value), "dd/MM/yyyy HH:mm");
  } catch {
    return value;
  }
}

const money = new Intl.NumberFormat("vi-VN");

export function fmtMoney(value?: string | number | null) {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n)) return String(value);
  return `${money.format(n)} đ`;
}

/** 38 500 000 000 -> "38,5 tỷ" for compact KPI cards */
export function fmtMoneyShort(value?: string | number | null) {
  const n = Number(value || 0);
  if (n >= 1e9) return `${(n / 1e9).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} tỷ`;
  if (n >= 1e6) return `${(n / 1e6).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} triệu`;
  return money.format(n);
}

export function fmtPercent(value?: string | number | null) {
  const n = Number(value || 0);
  return `${n.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;
}

export function fmtSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function todayISO() {
  return format(new Date(), "yyyy-MM-dd");
}
