import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { hostInfoPathOf, hostMutexName } from "./paths";
import { listPresenceFiles } from "./presence";

export interface HostSettings {
  readonly mode: string;
  readonly word: string;
  readonly typeMs: number;
  readonly fresh: number;
  readonly idle: number;
}

export const HOST_FRESH_MS = 8000;

interface HostInfo {
  pid?: number;
  mode?: string;
  word?: string;
  typeMs?: number;
  fresh?: number;
  idle?: number;
  updated?: number;
}

export interface HostSupervisorOptions {
  readonly scriptPath: string;
  readonly stateDir: string;
  readonly settings: HostSettings;
  readonly shellPath?: string | null;
  readonly log?: (message: string) => void;
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

  constructor(private readonly options: HostSupervisorOptions) {}

  async ensure(): Promise<void> {
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
    // Someone else is already rendering; nothing to do.
    const current = this.readInfo();
    if (current && this.isLive(current)) return;

    const candidates = [this.options.shellPath, "pwsh.exe", "powershell.exe"].filter(
      (candidate): candidate is string => typeof candidate === "string" && candidate.length > 0,
    );

    for (const shell of candidates) {
      if (await this.tryShell(shell)) return;
    }
    this.warn("could not start the popup host: no usable PowerShell found");
  }

  /**
   * Starts the host with one PowerShell and waits for its first heartbeat.
   *
   * Notes for Windows: the host is spawned without `detached`, because a
   * detached child silently fails to run here, and the Store build of pwsh
   * exits its launcher immediately, so the exit code says nothing about the
   * host. host.json is the only reliable proof that it came up.
   */
  private async tryShell(shell: string): Promise<boolean> {
    const before = this.readInfo()?.updated ?? 0;
    try {
      const child = spawn(shell, this.buildArgs(), {
        stdio: "ignore",
        windowsHide: true,
      });
      child.on("error", () => {});
      child.unref();
    } catch {
      return false;
    }

    for (let attempt = 0; attempt < 10; attempt++) {
      await delay(250);
      const info = this.readInfo();
      if (info && this.isLive(info) && (info.updated ?? 0) > before) return true;
    }
    this.log(`${shell} did not start the popup host`);
    return false;
  }

  private buildArgs(): string[] {
    const { settings } = this.options;
    return [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-WindowStyle",
      "Hidden",
      "-Sta",
      "-File",
      this.options.scriptPath,
      "-Mode",
      settings.mode,
      "-StateDir",
      this.options.stateDir,
      "-MutexName",
      hostMutexName(this.options.stateDir),
      "-Word",
      settings.word,
      "-TypeMs",
      String(settings.typeMs),
      "-FreshSeconds",
      String(settings.fresh),
      "-IdleSeconds",
      String(settings.idle),
    ];
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
    const { settings } = this.options;
    return (
      info.mode === settings.mode &&
      info.word === settings.word &&
      info.typeMs === settings.typeMs &&
      info.fresh === settings.fresh &&
      info.idle === settings.idle
    );
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
