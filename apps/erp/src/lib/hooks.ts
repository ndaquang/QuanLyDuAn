import { useCallback, useEffect, useRef, useState } from "react";

import { api, type Page, type Query } from "./api";

/** GET an endpoint and keep the result; `path=null` skips the call. */
export function useFetch<T>(path: string | null, query?: Query) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const key = path ? `${path}?${JSON.stringify(query ?? {})}` : null;
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (!path) return;
    const id = ++seq.current;
    setLoading(true);
    try {
      const res = await api.get<T>(path, query);
      if (id === seq.current) {
        setData(res);
        setError(null);
      }
    } catch (e) {
      if (id === seq.current) setError(e instanceof Error ? e.message : "Lỗi tải dữ liệu");
    } finally {
      if (id === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}

/** Paginated list with search, filters and page state (what every ERP table needs). */
export function useList<T>(path: string | null, initialFilters: Query = {}, pageSize = 20) {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [filters, setFilters] = useState<Query>(initialFilters);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const filtersKey = JSON.stringify(filters);
  useEffect(() => setPage(1), [debouncedQ, filtersKey]);

  const query: Query = { ...filters, q: debouncedQ, page, page_size: pageSize };
  const result = useFetch<Page<T>>(path, query);
  const setFilter = (key: string, value: Query[string]) => setFilters((f) => ({ ...f, [key]: value }));
  return { ...result, page, setPage, q, setQ, filters, setFilter, setFilters, query };
}

export function useDebounced<T>(value: T, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}
