import * as React from "react";

/**
 * The module contract. A control never writes to SharePoint: it emits an `ActionPayload`
 * (JSON text on the `ActionPayload` output), canvas performs the write in `OnChange`, and replies
 * by setting the `ActionResult` input to `{requestId, status, message}`. Controls that started the
 * action stay locked until the matching `requestId` comes back.
 */

export interface ModuleContext {
  userEmail: string;
  userName: string;
  roles: string[];
  permissions: string[];
  config: Record<string, unknown>;
}

export const EMPTY_CONTEXT: ModuleContext = { userEmail: "", userName: "", roles: [], permissions: [], config: {} };

export interface ActionPayload<T = unknown> {
  action: string;
  requestId: string;
  payload: T;
}

export type ActionStatus = "ok" | "error" | "conflict";

export interface ActionResult {
  requestId: string;
  status: ActionStatus;
  message?: string;
  /** For `conflict`: who decided the record first and when (ISO). */
  decidedBy?: string;
  decidedAt?: string;
}

const stringsOnly = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === "string" ? v : v && typeof v === "object" && typeof (v as { Value?: unknown }).Value === "string" ? (v as { Value: string }).Value : null))
      .filter((v): v is string => typeof v === "string" && v.length > 0);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return [];
};

const asString = (v: unknown): string => (typeof v === "string" ? v : "");

/** Canvas can hand "" on first render. Never throw; degrade to EMPTY_CONTEXT. */
export function parseContext(raw: string | null | undefined): ModuleContext {
  if (!raw) return EMPTY_CONTEXT;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_CONTEXT;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return EMPTY_CONTEXT;
  const o = parsed as Record<string, unknown>;
  const config = typeof o.config === "object" && o.config !== null && !Array.isArray(o.config) ? (o.config as Record<string, unknown>) : {};
  return {
    userEmail: asString(o.userEmail),
    userName: asString(o.userName),
    roles: stringsOnly(o.roles),
    permissions: stringsOnly(o.permissions),
    config,
  };
}

/**
 * Permission check. When canvas sends no permission list at all (v1 only has the legacy
 * `Role - PBS Hub` choice), the check falls back to the role: PBS_Team and FAS_Team get the Ops
 * permissions, except payroll which v1 restricts to PBS_Team.
 */
export function hasPermission(ctx: ModuleContext, code: string): boolean {
  if (ctx.permissions.length > 0) return ctx.permissions.includes(code);
  const roles = ctx.roles.map((r) => r.toUpperCase().replace(/[\s-]/g, "_"));
  if (roles.includes("PBS_TEAM")) return true;
  if (roles.includes("FAS_TEAM")) return !code.startsWith("PAYROLL");
  return false;
}

export function configNumber(ctx: ModuleContext, key: string, fallback: number): number {
  const v = ctx.config[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return fallback;
}

export function parseActionResult(raw: string | null | undefined): ActionResult | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!o || typeof o !== "object" || typeof o.requestId !== "string") return null;
    const status = o.status === "ok" || o.status === "conflict" ? o.status : "error";
    return {
      requestId: o.requestId,
      status,
      message: typeof o.message === "string" ? o.message : undefined,
      decidedBy: typeof o.decidedBy === "string" ? o.decidedBy : undefined,
      decidedAt: typeof o.decidedAt === "string" ? o.decidedAt : undefined,
    };
  } catch {
    return null;
  }
}

let counter = 0;
export function newRequestId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export type Emit = (json: string) => void;

export interface PendingAction {
  requestId: string;
  action: string;
}

export interface UseActionResult {
  /** Emits an action that waits for its ActionResult; returns false if another one is still pending. */
  dispatch: (action: string, payload: unknown) => boolean;
  /** Emits a navigation / informational action that does not lock the control. */
  fire: (action: string, payload: unknown) => void;
  pending: PendingAction | null;
  lastResult: (ActionResult & { action: string }) | null;
  clearResult: () => void;
}

/**
 * requestId lifecycle. `dispatch` locks until canvas answers with the same requestId; a result for
 * any other id (a stale one from a previous screen visit) is ignored.
 */
export function useAction(emit: Emit, actionResultRaw: string | null, prefix: string): UseActionResult {
  const [pending, setPending] = React.useState<PendingAction | null>(null);
  const [lastResult, setLastResult] = React.useState<(ActionResult & { action: string }) | null>(null);
  const pendingRef = React.useRef<PendingAction | null>(null);

  React.useEffect(() => {
    const res = parseActionResult(actionResultRaw);
    const p = pendingRef.current;
    if (res && p && res.requestId === p.requestId) {
      pendingRef.current = null;
      setPending(null);
      setLastResult({ ...res, action: p.action });
    }
  }, [actionResultRaw]);

  const dispatch = React.useCallback(
    (action: string, payload: unknown): boolean => {
      if (pendingRef.current) return false;
      const requestId = newRequestId(prefix);
      const p = { requestId, action };
      pendingRef.current = p;
      setPending(p);
      setLastResult(null);
      emit(JSON.stringify({ action, requestId, payload } satisfies ActionPayload));
      return true;
    },
    [emit, prefix],
  );

  const fire = React.useCallback(
    (action: string, payload: unknown) => {
      emit(JSON.stringify({ action, requestId: newRequestId(prefix), payload } satisfies ActionPayload));
    },
    [emit, prefix],
  );

  const clearResult = React.useCallback(() => setLastResult(null), []);

  return { dispatch, fire, pending, lastResult, clearResult };
}
