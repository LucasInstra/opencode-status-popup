import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { hostInfoPathOf } from "./paths";
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
    const args = this.buildArgs();
    const candidates = [this.options.shellPath, "pwsh.exe", "powershell.exe"].filter(
      (candidate): candidate is string => typeof candidate === "string" && candidate.length > 0,
    );

    for (const shell of candidates) {
      if (await trySpawn(shell, args)) return;
    }
    this.warn("could not start the popup host: no usable PowerShell found");
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

function trySpawn(shell: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    let child;
    try {
      child = spawn(shell, args, { detached: true, stdio: "ignore", windowsHide: true });
    } catch {
      resolve(false);
      return;
    }

    const timer = setTimeout(() => finish(true), 700);
    child.on("error", () => finish(false));
    child.on("spawn", () => {
      child.unref();
      finish(true);
    });
  });
}
