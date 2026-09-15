/**
 * Turns OpenCode session events into a single "what should the popup show?"
 * signal.
 *
 * Phases, highest priority first:
 *   permission - the agent is blocked waiting for the user to allow something
 *   error      - the last execution of a session failed
 *   retry      - a provider request failed and another attempt is scheduled
 *   busy       - a session is working
 *   idle       - nothing is happening
 */

export type Phase = "idle" | "busy" | "retry" | "error" | "permission";

export interface ActivitySnapshot {
  readonly phase: Phase;
  /** Sessions that are working or waiting for a provider. */
  readonly busy: number;
  /** Sessions inside a provider retry backoff. */
  readonly retry: number;
  /** Sessions whose last execution failed and are still in the error window. */
  readonly errors: number;
  /** Permission requests that are waiting for the user. */
  readonly permissions: number;
  /** Short label for the phase, shown in the popup tooltip. */
  readonly detail: string;
}

export interface RawEvent {
  readonly type: string;
  readonly data?: unknown;
}

export interface SessionActivityOptions {
  /** How long a failed execution keeps the popup red. 0 keeps it until the next activity. */
  readonly errorHoldMs?: number;
}

/** A session that produced no event for this long is dropped, so a missed stop
 * event cannot pin the popup to "busy" forever. */
export const MAX_SILENCE_MS = 45 * 60 * 1000;

/** Safety net for a permission request whose reply we never saw. */
export const MAX_PERMISSION_MS = 15 * 60 * 1000;

const DEFAULT_ERROR_HOLD_MS = 90_000;
const MAX_DETAIL_LENGTH = 48;

const STOP_EVENTS = new Set<string>([
  "session.idle",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
]);

const RETRY_EVENTS = new Set<string>(["session.retry.scheduled"]);

/** Events that prove a session is working again and clear an earlier error. */
const REVIVE_EVENTS = new Set<string>(["session.execution.started", "session.inbox.delivered"]);

const BUSY_EVENTS = new Set<string>([
  "session.step.started",
  "session.step.streamed",
  "session.text.started",
  "session.text.delta",
  "session.reasoning.started",
  "session.reasoning.delta",
  "session.tool.input.started",
  "session.tool.input.delta",
  "session.tool.called",
  "session.tool.progress",
  "session.tool.success",
  "session.tool.failed",
  "session.shell.started",
  "session.compaction.started",
  "session.compaction.delta",
]);

interface SessionEntry {
  phase: "busy" | "retry";
  seen: number;
}

interface ErrorEntry {
  detail: string;
  at: number;
}

interface PermissionEntry {
  detail: string;
  at: number;
}

export class SessionActivity {
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly failures = new Map<string, ErrorEntry>();
  private readonly permissions = new Map<string, PermissionEntry>();
  private readonly errorHoldMs: number;
  private cached: ActivitySnapshot = {
    phase: "idle",
    busy: 0,
    retry: 0,
    errors: 0,
    permissions: 0,
    detail: "",
  };

  constructor(options: SessionActivityOptions = {}) {
    this.errorHoldMs = options.errorHoldMs ?? DEFAULT_ERROR_HOLD_MS;
  }

  /** Returns the new snapshot when it differs from the previous one. */
  apply(event: RawEvent, now = Date.now()): ActivitySnapshot | undefined {
    if (event.type === "permission.asked") {
      const request = readPermission(event.data);
      if (!request) return undefined;
      this.permissions.set(request.id, { detail: request.detail, at: now });
      return this.refresh(now);
    }

    if (event.type === "permission.replied") {
      const requestID = readString(event.data, "requestID");
      if (!requestID) return undefined;
      this.permissions.delete(requestID);
      return this.refresh(now);
    }

    const sessionID = readSessionID(event.data);
    if (!sessionID) return undefined;

    if (event.type === "session.status") {
      const status = readStatus(event.data);
      if (status === "idle") {
        this.retire(sessionID);
      } else if (status === "retry") {
        this.failures.delete(sessionID);
        this.set(sessionID, "retry", now);
      } else if (status === "busy") {
        this.failures.delete(sessionID);
        this.set(sessionID, "busy", now);
      }
    } else if (event.type === "session.execution.failed") {
      this.retire(sessionID);
      this.failures.set(sessionID, { detail: formatError(event.data), at: now });
    } else if (STOP_EVENTS.has(event.type)) {
      this.retire(sessionID);
    } else if (RETRY_EVENTS.has(event.type)) {
      this.failures.delete(sessionID);
      this.set(sessionID, "retry", now);
    } else if (REVIVE_EVENTS.has(event.type) || BUSY_EVENTS.has(event.type)) {
      this.failures.delete(sessionID);
      this.set(sessionID, "busy", now);
    } else {
      return undefined;
    }

    return this.refresh(now);
  }

  snapshot(now = Date.now()): ActivitySnapshot {
    return this.refresh(now);
  }

  reset(): void {
    this.sessions.clear();
    this.failures.clear();
    this.permissions.clear();
    this.refresh(Date.now());
  }

  private set(sessionID: string, phase: "busy" | "retry", now: number): void {
    const entry = this.sessions.get(sessionID);
    if (entry) {
      entry.phase = phase;
      entry.seen = now;
      return;
    }
    this.sessions.set(sessionID, { phase, seen: now });
  }

  private retire(sessionID: string): void {
    this.sessions.delete(sessionID);
  }

  private prune(now: number): void {
    for (const [sessionID, entry] of this.sessions) {
      if (now - entry.seen > MAX_SILENCE_MS) this.sessions.delete(sessionID);
    }
    for (const [sessionID, entry] of this.failures) {
      if (this.errorHoldMs > 0 && now - entry.at > this.errorHoldMs) this.failures.delete(sessionID);
    }
    for (const [requestID, entry] of this.permissions) {
      if (now - entry.at > MAX_PERMISSION_MS) this.permissions.delete(requestID);
    }
  }

  private refresh(now: number): ActivitySnapshot {
    this.prune(now);

    let busy = 0;
    let retry = 0;
    for (const entry of this.sessions.values()) {
      busy++;
      if (entry.phase === "retry") retry++;
    }
    const errors = this.failures.size;
    const permissions = this.permissions.size;

    let phase: Phase = "idle";
    let detail = "";
    if (permissions > 0) {
      phase = "permission";
      detail = firstDetail(this.permissions);
    } else if (errors > 0) {
      phase = "error";
      detail = firstDetail(this.failures);
    } else if (busy > 0) {
      phase = retry > 0 ? "retry" : "busy";
    }

    if (
      phase === this.cached.phase &&
      busy === this.cached.busy &&
      retry === this.cached.retry &&
      errors === this.cached.errors &&
      permissions === this.cached.permissions &&
      detail === this.cached.detail
    ) {
      return this.cached;
    }

    this.cached = { phase, busy, retry, errors, permissions, detail };
    return this.cached;
  }
}

export function sameSnapshot(a: ActivitySnapshot, b: ActivitySnapshot): boolean {
  return (
    a.phase === b.phase &&
    a.busy === b.busy &&
    a.retry === b.retry &&
    a.errors === b.errors &&
    a.permissions === b.permissions &&
    a.detail === b.detail
  );
}

function firstDetail(entries: Map<string, { detail: string }>): string {
  for (const entry of entries.values()) {
    if (entry.detail) return entry.detail;
  }
  return "";
}

function readSessionID(data: unknown): string | undefined {
  return readString(data, "sessionID");
}

function readString(data: unknown, key: string): string | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const value = (data as Record<string, unknown>)[key];
  return typeof value === "string" && value ? value : undefined;
}

function readStatus(data: unknown): "idle" | "busy" | "retry" | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const status = (data as Record<string, unknown>).status;
  if (typeof status !== "object" || status === null) return undefined;
  const type = (status as Record<string, unknown>).type;
  return type === "idle" || type === "busy" || type === "retry" ? type : undefined;
}

function readPermission(data: unknown): { id: string; detail: string } | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const record = data as Record<string, unknown>;
  const id = typeof record.id === "string" && record.id ? record.id : undefined;
  if (!id) return undefined;

  const action = typeof record.action === "string" && record.action ? record.action : "permission";
  const resources = Array.isArray(record.resources)
    ? record.resources.filter((value): value is string => typeof value === "string" && value.length > 0)
    : [];
  const detail = [action, resources[0]].filter(Boolean).join(" ");
  return { id, detail: truncate(detail) };
}

function formatError(data: unknown): string {
  if (typeof data !== "object" || data === null) return "";
  const error = (data as Record<string, unknown>).error;
  if (typeof error !== "object" || error === null) return "";
  const record = error as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";
  const status = typeof record.status === "number" ? String(record.status) : "";
  const message = typeof record.message === "string" ? record.message : "";
  const label = [status, type].filter(Boolean).join(" ");
  return truncate(label || message);
}

function truncate(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length <= MAX_DETAIL_LENGTH) return trimmed;
  return `${trimmed.slice(0, MAX_DETAIL_LENGTH - 1)}…`;
}
