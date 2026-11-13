import { useState } from "react";

import { ApiError } from "@/lib/api";

import { useUi } from "./ui";

/** Small form-state helper: values, per-field server errors, submit with toasts. */
export function useForm<T extends Record<string, unknown>>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const { toast } = useUi();

  const set = <K extends keyof T>(key: K, value: T[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key as string]: "" }));
  };

  const bind = (key: keyof T) => ({
    value: (values[key] ?? "") as string,
    onChange: (e: { target: { value: string } }) => set(key, e.target.value as T[keyof T]),
  });

  async function submit<R>(fn: (v: T) => Promise<R>, success?: string): Promise<R | undefined> {
    setSaving(true);
    setErrors({});
    try {
      const res = await fn(values);
      if (success) toast(success);
      return res;
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fields);
        toast(e.message, "error");
      } else toast("Có lỗi xảy ra", "error");
      return undefined;
    } finally {
      setSaving(false);
    }
  }

  return { values, setValues, set, bind, errors, setErrors, saving, submit };
}

const NULLABLE_KEYS = new Set([
  "project",
  "parent",
  "department",
  "manager",
  "head",
  "role",
  "assignee",
  "owner",
  "tender",
  "supplier",
  "user",
  "approver_role",
  "min_amount",
]); // fmt: skip

/** Send empty dates / foreign keys as null (the API rejects ""), keep empty text as "". */
export function clean<T extends Record<string, unknown>>(values: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    const nullable = NULLABLE_KEYS.has(k) || /(_date|_deadline|date_of_birth)$/.test(k);
    out[k] = v === "" && nullable ? null : v;
  }
  return out;
}
