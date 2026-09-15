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

  constructor(
    private readonly file: string,
    private readonly meta: PresenceMeta,
  ) {}

  /** Writes only when the observable state changed. Returns true when it did. */
  sync(snapshot: ActivitySnapshot, now = Date.now()): boolean {
    const signature = `${snapshot.phase}|${snapshot.busy}|${snapshot.retry}|${this.meta.mode}`;
    if (signature === this.signature) return false;
    this.signature = signature;
    this.write(snapshot, now);
    return true;
  }

  /** Keeps the file fresh even while nothing changes. */
  refresh(snapshot: ActivitySnapshot, now = Date.now()): void {
    this.write(snapshot, now);
  }

  dispose(): void {
    this.signature = "";
    try {
      rmSync(this.file, { force: true });
    } catch {
      // the file is already gone
    }
  }

  private write(snapshot: ActivitySnapshot, now: number): void {
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
      updated: now,
    };
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.tmp`;
      writeFileSync(temporary, JSON.stringify(payload));
      renameSync(temporary, this.file);
    } catch {
      // A failed heartbeat is not worth interrupting the session for.
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
