import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { api, ApiError } from "./api";
import type { AccessContext, UserBrief, WorkspaceInfo } from "./types";

const WS_KEY = "erp.workspace";

interface SessionState {
  status: "loading" | "anonymous" | "ready" | "no-workspace" | "not-configured";
  user: UserBrief | null;
  workspaces: WorkspaceInfo[];
  workspace: WorkspaceInfo | null;
  ctx: AccessContext | null;
  error: string | null;
}

interface SessionApi extends SessionState {
  slug: string;
  /** Path prefix for workspace endpoints: `/workspaces/<slug>` */
  ws: (path: string) => string;
  can: (code: string) => boolean;
  refresh: () => Promise<void>;
  switchWorkspace: (slug: string) => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionApi | null>(null);

function storedSlug() {
  try {
    return localStorage.getItem(WS_KEY);
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({
    status: "loading",
    user: null,
    workspaces: [],
    workspace: null,
    ctx: null,
    error: null,
  });

  const load = useCallback(async (preferred?: string | null) => {
    try {
      const me = await api.get<{ user: UserBrief; workspaces: WorkspaceInfo[] }>("/me/");
      if (!me.workspaces.length) {
        setState({ status: "no-workspace", user: me.user, workspaces: [], workspace: null, ctx: null, error: null });
        return;
      }
      const wanted = preferred ?? storedSlug();
      const workspace = me.workspaces.find((w) => w.slug === wanted) ?? me.workspaces[0];
      try {
        localStorage.setItem(WS_KEY, workspace.slug);
      } catch {
        /* private mode - ignore */
      }
      if (!workspace.is_configured) {
        setState({
          status: "not-configured",
          user: me.user,
          workspaces: me.workspaces,
          workspace,
          ctx: null,
          error: null,
        });
        return;
      }
      const ctx = await api.get<AccessContext>(`/workspaces/${workspace.slug}/context/`);
      setState({ status: "ready", user: me.user, workspaces: me.workspaces, workspace, ctx, error: null });
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        setState((s) => ({ ...s, status: "anonymous", user: null, ctx: null, error: null }));
      } else {
        setState((s) => ({ ...s, status: "anonymous", error: e instanceof Error ? e.message : "Lỗi" }));
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const value = useMemo<SessionApi>(() => {
    const slug = state.workspace?.slug ?? "";
    const perms = new Set(state.ctx?.permissions ?? []);
    return {
      ...state,
      slug,
      ws: (path: string) => `/workspaces/${slug}${path.startsWith("/") ? path : `/${path}`}`,
      can: (code: string) => Boolean(state.ctx?.is_admin) || perms.has(code),
      refresh: () => load(slug),
      switchWorkspace: (s: string) => void load(s),
      login: async (email: string, password: string) => {
        await api.post("/auth/login/", { email, password });
        await load();
      },
      logout: async () => {
        try {
          await api.post("/auth/logout/");
        } finally {
          setState({ status: "anonymous", user: null, workspaces: [], workspace: null, ctx: null, error: null });
        }
      },
    };
  }, [state, load]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
