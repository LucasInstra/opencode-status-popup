import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import type { PopupPosition } from "./config";
import { hostInfoPathOf, hostMutexName } from "./paths";
import { listPresenceFiles } from "./presence";

export interface HostSettings {
  mode: string;
  word: string;
  typeMs: number;
  fresh: number;
  idle: number;
  mark: boolean;
  position: PopupPosition;
}

export const HOST_FRESH_MS = 8000;

/**
 * How long a shell gets to write its first heartbeat before the next
 * interpreter is tried, and the ceiling while the shell is still alive (a cold
 * machine can spend seconds in the first PowerShell start).
 */
const PROBE_MIN_MS = 2500;
const PROBE_MAX_MS = 10_000;
const PROBE_INTERVAL_MS = 250;

/**
 * The heartbeat the host writes to host.json: one field per rendered setting
 * whose value is fixed for the life of the host. `position` is deliberately
 * absent: the host resolves the corner when it places the pill, without a
 * restart (see `hostInfoMatches`).
 */
export interface HostInfo {
  pid?: number;
  mode?: string;
  word?: string;
  typeMs?: number;
  fresh?: number;
  idle?: number;
  mark?: boolean;
  updated?: number;
}

export interface HostSupervisorOptions {
  readonly scriptPath: string;
  readonly stateDir: string;
  readonly settings: HostSettings;
  readonly shellPath?: string | null;
  readonly log?: (message: string) => void;
}

export interface HostLaunch {
  readonly scriptPath: string;
  readonly stateDir: string;
  readonly settings: HostSettings;
}

/**
 * The command line the host is started with. The host echoes the same settings
 * back in its heartbeat, so this and `hostInfoMatches` have to stay in step,
 * with one deliberate exception: `position` is a placement-time value and is
 * not part of the comparison (see below).
 *
 * The free-form values travel attached to their flags (`-Word:value`,
 * `-StateDir:value`) on purpose: the host script uses `[CmdletBinding()]`, and
 * PowerShell would otherwise read a value that looks like one of its
 * parameters (`-Mark`, `-Word`, and the `-state` prefix of `-StateDir`) as a
 * parameter name and fail before the host can log anything.
 */
export function buildHostArgs(launch: HostLaunch): string[] {
  const { settings } = launch;
  return [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-WindowStyle",
    "Hidden",
    "-Sta",
    "-File",
    launch.scriptPath,
    "-Mode",
    settings.mode,
    `-StateDir:${launch.stateDir}`,
    "-MutexName",
    hostMutexName(launch.stateDir),
    "-Mark",
    settings.mark ? "1" : "0",
    `-Word:${settings.word}`,
    "-TypeMs",
    String(settings.typeMs),
    "-FreshSeconds",
    String(settings.fresh),
    "-IdleSeconds",
    String(settings.idle),
    "-Position",
    settings.position,
  ];
}

/**
 * True when a live host already renders exactly these settings. `position` is
 * deliberately not compared: it is a placement-time value, so a changed corner
 * applies at the next placement (first show, or Reset position) and restarting
 * here would churn the host without moving anything. Do not add it to the list
 * below: the live behaviour of the option depends on this omission.
 */
export function hostInfoMatches(info: HostInfo, settings: HostSettings): boolean {
  return (
    info.mode === settings.mode &&
    info.word === settings.word &&
    info.typeMs === settings.typeMs &&
    info.fresh === settings.fresh &&
    info.idle === settings.idle &&
    info.mark === settings.mark
  );
}

/**
 * Keeps exactly one popup host process alive.
 *
 * The host is a detached PowerShell process that renders the presence files, so
 * it outlives single plugin instances. The supervisor restarts it when it died,
 * when it went stale, or when the configuration changed.
 */
export class HostSupervisor {
  private spawning: Promise<void> | undefined;
  private warned = false;
  private closed = false;
  private probing: ReturnType<typeof spawn> | undefined;

  constructor(private readonly options: HostSupervisorOptions) {}

  /**
   * Latches the supervisor off: once a shutdown is in flight, `ensure` must
   * not spawn a replacement. Called before the rest of the cleanup so a mode
   * switch already being applied cannot bring an orphan host back. A shell
   * that is still starting is killed right here, because a fast shutdown may
   * never reach the next probe tick.
   */
  deactivate(): void {
    this.closed = true;
    this.kill(this.probing?.pid);
  }

  async ensure(): Promise<void> {
    if (this.closed) return;
    if (!existsSync(this.options.scriptPath)) {
      this.warn(`host script missing at ${this.options.scriptPath}`);
      return;
    }

    const info = this.readInfo();
    if (info && this.isLive(info)) {
      if (this.matches(info)) return;
      this.log(`restarting host: settings changed`);
      this.kill(info.pid);
    } else if (info?.pid) {
      this.kill(info.pid);
    }

    await this.spawnHost();
  }

  /** Stops the host, but only when this instance was the last one alive. */
  shutdown(): void {
    this.deactivate();
    const info = this.readInfo();
    if (!info?.pid || !this.isLive(info)) return;
    if (listPresenceFiles(this.options.stateDir).length > 0) return;
    this.log("stopping host: last instance went away");
    this.kill(info.pid);
  }

  private async spawnHost(): Promise<void> {
    if (!this.spawning) {
      this.spawning = this.doSpawn().finally(() => {
        this.spawning = undefined;
      });
    }
    await this.spawning;
  }

  private async doSpawn(): Promise<void> {
    if (this.closed) return;
    // Someone else is already rendering; nothing to do.
    const current = this.readInfo();
    if (current && this.isLive(current)) return;

    const candidates = [this.options.shellPath, "pwsh.exe", "powershell.exe"].filter(
      (candidate): candidate is string => typeof candidate === "string" && candidate.length > 0,
    );

    for (const shell of candidates) {
      if (this.closed) return;
      if (await this.tryShell(shell)) return;
    }
    this.warn("could not start the popup host: no usable PowerShell found (see host.log)");
  }

  /**
   * Starts the host with one PowerShell and waits for its first heartbeat.
   *
   * Notes for Windows: the host is spawned without `detached`, because a
   * detached child silently fails to run here, and the Store build of pwsh
   * exits its launcher immediately, so the exit code says nothing about the
   * host. host.json is the only reliable proof that it came up.
   *
   * The first window is short, so a shell that cannot run falls through to the
   * next one; a shell that is still alive when it elapses keeps a longer one,
   * because a cold machine can take several seconds to reach the heartbeat.
   */
  private async tryShell(shell: string): Promise<boolean> {
    const before = this.readInfo()?.updated ?? 0;
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(shell, this.buildArgs(), {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      return false;
    }

    let exited = false;
    let failed = false;
    child.on("error", () => {
      failed = true;
    });
    child.on("exit", () => {
      exited = true;
    });
    child.unref();
    this.probing = child;

    try {
      const started = Date.now();
      for (;;) {
        await delay(PROBE_INTERVAL_MS);
        const info = this.readInfo();
        if (info && this.isLive(info) && (info.updated ?? 0) > before) return true;
        if (this.closed) {
          // The shutdown started while this shell was starting: kill the child
          // we spawned, or it would come up after the cleanup and idle alone.
          this.kill(child.pid);
          return false;
        }
        const elapsed = Date.now() - started;
        if (failed) break;
        if (elapsed >= PROBE_MIN_MS && (exited || elapsed >= PROBE_MAX_MS)) break;
      }
      this.log(`${shell} did not start the popup host`);
      return false;
    } finally {
      if (this.probing === child) this.probing = undefined;
    }
  }

  private buildArgs(): string[] {
    return buildHostArgs(this.options);
  }

  private readInfo(): HostInfo | undefined {
    try {
      const raw = readFileSync(hostInfoPathOf(this.options.stateDir), "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed !== "object" || parsed === null) return undefined;
      return parsed as HostInfo;
    } catch {
      return undefined;
    }
  }

  private isLive(info: HostInfo): boolean {
    if (typeof info.pid !== "number" || info.pid <= 0) return false;
    if (typeof info.updated !== "number" || Date.now() - info.updated > HOST_FRESH_MS) return false;
    try {
      process.kill(info.pid, 0);
    } catch {
      return false;
    }
    return true;
  }

  private matches(info: HostInfo): boolean {
    return hostInfoMatches(info, this.options.settings);
  }

  private kill(pid: number | undefined): void {
    if (typeof pid !== "number" || pid <= 0) return;
    try {
      process.kill(pid);
    } catch {
      // already gone
    }
  }

  private log(message: string): void {
    this.options.log?.(message);
  }

  private warn(message: string): void {
    if (this.warned) return;
    this.warned = true;
    this.log(message);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
