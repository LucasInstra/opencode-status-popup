import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ActivitySnapshot } from "./status";

export const PRESENCE_VERSION = 1;

export interface PresenceMeta {
  readonly instance: string;
  readonly project: string;
  readonly directory: string;
  readonly mode: string;
}

/**
 * Writes the presence file the popup host reads. One file per plugin instance,
 * so several OpenCode windows (or several projects on one server) all show up.
 * The host ignores files whose `updated` timestamp went stale.
 */
export class PresenceWriter {
  private signature = "";
  private meta: PresenceMeta;

  constructor(
    private readonly file: string,
    meta: PresenceMeta,
  ) {
    this.meta = meta;
  }

  /** The renderer is switchable at runtime, and the mode is part of the file. */
  setMode(mode: string): void {
    if (this.meta.mode === mode) return;
    this.meta = { ...this.meta, mode };
    this.signature = "";
  }

  /** Writes only when the observable state changed. Returns true when it did. */
  sync(snapshot: ActivitySnapshot, now = Date.now()): boolean {
    const signature = this.signatureOf(snapshot);
    if (signature === this.signature) return false;
    // Remember the state only after it reached the disk: a failed write (the
    // host may be reading the file) is retried by the next change or heartbeat.
    if (!this.write(snapshot, now)) return false;
    this.signature = signature;
    return true;
  }

  /** Keeps the file fresh even while nothing changes. */
  refresh(snapshot: ActivitySnapshot, now = Date.now()): void {
    if (this.write(snapshot, now)) this.signature = this.signatureOf(snapshot);
  }

  private signatureOf(snapshot: ActivitySnapshot): string {
    return `${snapshot.phase}|${snapshot.busy}|${snapshot.retry}|${snapshot.errors}|${snapshot.permissions}|${snapshot.detail}|${this.meta.mode}`;
  }

  dispose(): void {
    this.signature = "";
    try {
      rmSync(this.file, { force: true });
    } catch {
      // the file is already gone
    }
  }

  private write(snapshot: ActivitySnapshot, now: number): boolean {
    const payload = {
      version: PRESENCE_VERSION,
      instance: this.meta.instance,
      pid: process.pid,
      project: this.meta.project,
      directory: this.meta.directory,
      mode: this.meta.mode,
      phase: snapshot.phase,
      busy: snapshot.busy,
      retry: snapshot.retry,
      errors: snapshot.errors,
      permissions: snapshot.permissions,
      detail: snapshot.detail,
      updated: now,
    };
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.tmp`;
      writeFileSync(temporary, JSON.stringify(payload));
      renameSync(temporary, this.file);
      return true;
    } catch {
      // A failed heartbeat is not worth interrupting the session for; the next
      // change or heartbeat tries again.
      return false;
    }
  }
}

export function listPresenceFiles(stateDir: string): string[] {
  try {
    return readdirSync(join(stateDir, "state")).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
}
