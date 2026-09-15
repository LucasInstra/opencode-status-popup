/**
 * Turns OpenCode session events into a single "is anything thinking?" signal.
 *
 * The plugin only needs to know whether at least one session is busy, so the
 * tracker keeps a map of session id -> phase and folds every event into it.
 */

export type Phase = "idle" | "busy" | "retry";

export interface ActivitySnapshot {
  readonly phase: Phase;
  readonly busy: number;
  readonly retry: number;
}

export interface RawEvent {
  readonly type: string;
  readonly data?: unknown;
}

/** A session that produced no event for this long is dropped, so a missed stop
 * event cannot pin the popup to "busy" forever. */
export const MAX_SILENCE_MS = 45 * 60 * 1000;

const STOP_EVENTS = new Set<string>([
  "session.idle",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
]);

const RETRY_EVENTS = new Set<string>(["session.retry.scheduled"]);

const BUSY_EVENTS = new Set<string>([
  "session.execution.started",
  "session.inbox.delivered",
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

export class SessionActivity {
  private readonly sessions = new Map<string, SessionEntry>();
  private cached: ActivitySnapshot = { phase: "idle", busy: 0, retry: 0 };

  /** Returns the new snapshot when it differs from the previous one. */
  apply(event: RawEvent, now = Date.now()): ActivitySnapshot | undefined {
    const sessionID = readSessionID(event.data);
    if (!sessionID) return undefined;

    if (event.type === "session.status") {
      const status = readStatus(event.data);
      if (status === "idle") this.remove(sessionID);
      else if (status === "retry") this.set(sessionID, "retry", now);
      else if (status === "busy") this.set(sessionID, "busy", now);
    } else if (STOP_EVENTS.has(event.type)) {
      this.remove(sessionID);
    } else if (RETRY_EVENTS.has(event.type)) {
      this.set(sessionID, "retry", now);
    } else if (BUSY_EVENTS.has(event.type)) {
      this.set(sessionID, "busy", now);
    } else {
      return undefined;
    }

    return this.refresh();
  }

  snapshot(now = Date.now()): ActivitySnapshot {
    this.prune(now);
    return this.refresh();
  }

  reset(): void {
    this.sessions.clear();
    this.refresh();
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

  private remove(sessionID: string): void {
    this.sessions.delete(sessionID);
  }

  private prune(now: number): void {
    for (const [sessionID, entry] of this.sessions) {
      if (now - entry.seen > MAX_SILENCE_MS) this.sessions.delete(sessionID);
    }
  }

  private refresh(): ActivitySnapshot {
    let busy = 0;
    let retry = 0;
    for (const entry of this.sessions.values()) {
      busy++;
      if (entry.phase === "retry") retry++;
    }
    const phase: Phase = busy === 0 ? "idle" : retry > 0 ? "retry" : "busy";
    if (phase === this.cached.phase && busy === this.cached.busy && retry === this.cached.retry) {
      return this.cached;
    }
    this.cached = { phase, busy, retry };
    return this.cached;
  }
}

export function sameSnapshot(a: ActivitySnapshot, b: ActivitySnapshot): boolean {
  return a.phase === b.phase && a.busy === b.busy && a.retry === b.retry;
}

function readSessionID(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const value = (data as Record<string, unknown>).sessionID;
  return typeof value === "string" && value ? value : undefined;
}

function readStatus(data: unknown): "idle" | "busy" | "retry" | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const status = (data as Record<string, unknown>).status;
  if (typeof status !== "object" || status === null) return undefined;
  const type = (status as Record<string, unknown>).type;
  return type === "idle" || type === "busy" || type === "retry" ? type : undefined;
}
