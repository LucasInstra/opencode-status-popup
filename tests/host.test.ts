import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildHostArgs, hostInfoMatches, HostSupervisor, type HostSettings } from "../src/host";

const settings: HostSettings = {
  mode: "window",
  word: "opencode",
  typeMs: 140,
  fresh: 20,
  idle: 25,
  mark: false,
  position: "top-left",
};

describe("host launch", () => {
  it("passes every setting to the host script, position included", () => {
    const args = buildHostArgs({ scriptPath: "C:\\host\\popup.ps1", stateDir: "C:\\state", settings });

    const valueOf = (flag: string): string | undefined => args[args.indexOf(flag) + 1];
    expect(valueOf("-Mode")).toBe("window");
    expect(args).toContain("-StateDir:C:\\state");
    expect(valueOf("-TypeMs")).toBe("140");
    expect(valueOf("-FreshSeconds")).toBe("20");
    expect(valueOf("-IdleSeconds")).toBe("25");
    expect(valueOf("-Position")).toBe("top-left");
    expect(valueOf("-Mark")).toBe("0");
    expect(args).toContain("-Word:opencode");
  });

  it("attaches free-form values to their flags, so a leading dash cannot be a parameter", () => {
    const args = buildHostArgs({
      scriptPath: "C:\\host\\popup.ps1",
      stateDir: "-state",
      settings: { ...settings, word: "-Mark" },
    });

    expect(args).toContain("-Word:-Mark");
    expect(args).toContain("-StateDir:-state");
    expect(args).not.toContain("-Word");
    expect(args).not.toContain("-StateDir");
  });

  it("restarts when a rendered setting diverges, but not when only the position moves", () => {
    const info = {
      pid: 4242,
      updated: Date.now(),
      mode: "window",
      word: "opencode",
      typeMs: 140,
      fresh: 20,
      idle: 25,
      mark: false,
      position: "top-left",
    };

    expect(hostInfoMatches(info, settings)).toBe(true);
    // The corner is applied at first placement and on Reset position; a live
    // host keeps the position the user already has.
    const movedCorner = { ...info, position: "bottom-right" };
    expect(hostInfoMatches(movedCorner, settings)).toBe(true);
    expect(hostInfoMatches({ ...info, word: "hi" }, settings)).toBe(false);
  });

  it("does not compare what the current renderer does not use", () => {
    const tray: HostSettings = { ...settings, mode: "tray" };
    const trayInfo = {
      pid: 4242,
      updated: Date.now(),
      mode: "tray",
      word: "opencode",
      typeMs: 140,
      fresh: 20,
      idle: 25,
      mark: false,
      position: "top-left",
    };

    // The tray draws on a fixed tick and its icon is the letter: typeMs and
    // mark cannot change it, so they do not restart it.
    expect(hostInfoMatches({ ...trayInfo, typeMs: 900, mark: true }, tray)).toBe(true);
    // It still restarts for what it does render.
    expect(hostInfoMatches({ ...trayInfo, word: "hi" }, tray)).toBe(false);
    expect(hostInfoMatches({ ...trayInfo, fresh: 60 }, tray)).toBe(false);

    // The pill renders both, so a divergence there restarts it.
    expect(hostInfoMatches({ ...trayInfo, mode: "window", typeMs: 900 }, settings)).toBe(false);
    expect(hostInfoMatches({ ...trayInfo, mode: "window", mark: true }, settings)).toBe(false);
  });
});

describe("host supervisor", () => {
  it("does not start a host again once a shutdown is in flight", async () => {
    const stateDir = join(tmpdir(), `popup-host-latch-${process.pid}`);
    const scriptPath = join(stateDir, "missing.ps1");
    const logs: string[] = [];
    const supervisor = new HostSupervisor({
      scriptPath,
      stateDir,
      settings,
      log: (message) => void logs.push(message),
    });

    supervisor.deactivate();
    await supervisor.ensure();
    expect(logs).toEqual([]);

    // Without the latch the same call reports the missing script, so the
    // empty log above is the latch, not a swallowed warning.
    const fresh = new HostSupervisor({
      scriptPath,
      stateDir,
      settings,
      log: (message) => void logs.push(message),
    });
    await fresh.ensure();
    expect(logs).toEqual([`host script missing at ${scriptPath}`]);
  });

  it("latches on shutdown as well", async () => {
    const stateDir = join(tmpdir(), `popup-host-shutdown-${process.pid}`);
    const logs: string[] = [];
    const supervisor = new HostSupervisor({
      scriptPath: join(stateDir, "missing.ps1"),
      stateDir,
      settings,
      log: (message) => void logs.push(message),
    });

    supervisor.shutdown();
    await supervisor.ensure();
    expect(logs).toEqual([]);
  });

  it.skipIf(process.platform !== "win32")(
    "kills a shell that was still starting when a shutdown latches",
    async () => {
      const stateDir = mkdtempSync(join(tmpdir(), `popup-host-kill-${process.pid}-`));
      const scriptPath = join(stateDir, "stub.ps1");
      writeFileSync(scriptPath, STUB_HOST);
      const supervisor = new HostSupervisor({ scriptPath, stateDir, settings, log: () => {} });

      try {
        const probing = supervisor.ensure();
        const pid = await waitFor(() => readPid(join(stateDir, "child.pid")));
        expect(isAlive(pid)).toBe(true);

        supervisor.deactivate();
        await probing;
        await waitFor(() => (isAlive(pid) ? undefined : true));
        expect(isAlive(pid)).toBe(false);
      } finally {
        rmSync(stateDir, { recursive: true, force: true });
      }
    },
    15_000,
  );
});

/** A host-shaped script that proves it started and then just stays alive. */
const STUB_HOST = [
  "param(",
  '  [string]$Mode, [string]$StateDir, [string]$MutexName,',
  '  [int]$Mark, [string]$Word, [int]$TypeMs,',
  '  [string]$Position, [int]$FreshSeconds, [int]$IdleSeconds,',
  "  [switch]$KeepAlive",
  ")",
  '[System.IO.File]::WriteAllText((Join-Path $PSScriptRoot "child.pid"), [string]$PID)',
  "Start-Sleep -Seconds 30",
  "",
].join("\n");

function readPid(file: string): number | undefined {
  try {
    const raw = readFileSync(file, "utf8").replace(/^\uFEFF/, "").trim();
    const value = Number.parseInt(raw, 10);
    return Number.isInteger(value) && value > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor<T>(check: () => T | undefined, timeoutMs = 8000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = check();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("timed out waiting for the child process");
}
