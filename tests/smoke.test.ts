/**
 * Smoke test for the real thing: it loads the plugin, feeds it synthetic
 * OpenCode events and checks that presence files are written and a real
 * PowerShell popup host is started and stopped again.
 *
 * It spawns a visible window/tray icon and needs PowerShell, so it only runs
 * on Windows with SMOKE=1:
 *
 *   $env:SMOKE=1; npm test
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import plugin from "../src/index";
import { hostInfoPathOf, presenceFileOf } from "../src/paths";

const enabled = process.platform === "win32" && process.env.SMOKE === "1";

describe.skipIf(!enabled)("plugin smoke", () => {
  it("drives presence files and the host through a busy to idle cycle", async () => {
    const stateDir = join(tmpdir(), `opencode-status-popup-smoke-${process.pid}`);
    rmSync(stateDir, { recursive: true, force: true });

    const previous = process.env.OPENCODE_STATUS_POPUP_DIR;
    process.env.OPENCODE_STATUS_POPUP_DIR = stateDir;

    const directory = process.cwd();
    const presence = presenceFileOf(stateDir, directory);
    const queue = new EventQueue();
    const ctx = {
      options: { mode: "window", idleSeconds: 30 },
      location: { directory },
      event: { subscribe: (options?: { signal?: AbortSignal }) => queue.stream(options?.signal) },
    };

    let cleanup: Awaited<ReturnType<typeof plugin.setup>> = undefined;
    let hostPid = 0;
    try {
      cleanup = await plugin.setup(ctx as never);

      expect(existsSync(presence)).toBe(true);
      expect(readJson(presence)?.phase).toBe("idle");

      queue.push({ type: "session.status", data: { sessionID: "ses_smoke", status: { type: "busy" } } });
      const busy = await waitFor(() => {
        const data = readJson(presence);
        return data?.busy === 1 ? data : undefined;
      });
      expect(busy.phase).toBe("busy");

      queue.push({ type: "session.text.delta", data: { sessionID: "ses_smoke" } });
      queue.push({ type: "session.retry.scheduled", data: { sessionID: "ses_smoke" } });
      await waitFor(() => (readJson(presence)?.phase === "retry" ? true : undefined));

      const host = await waitFor(() => {
        const info = readJson(hostInfoPathOf(stateDir));
        if (!info || info.mode !== "window") return undefined;
        if (Date.now() - Number(info.updated) > 8000) return undefined;
        return info;
      });
      hostPid = Number(host.pid);
      expect(hostPid).toBeGreaterThan(0);
      expect(isAlive(hostPid)).toBe(true);

      queue.push({ type: "session.idle", data: { sessionID: "ses_smoke" } });
      await waitFor(() => (readJson(presence)?.phase === "idle" ? true : undefined));
    } finally {
      await cleanup?.();
      if (previous === undefined) delete process.env.OPENCODE_STATUS_POPUP_DIR;
      else process.env.OPENCODE_STATUS_POPUP_DIR = previous;
    }

    expect(existsSync(presence)).toBe(false);
    if (hostPid > 0) {
      await waitFor(() => (isAlive(hostPid) ? undefined : true));
    }
    rmSync(stateDir, { recursive: true, force: true });
  }, 60_000);
});

class EventQueue {
  private readonly queue: unknown[] = [];
  private readonly waiters: Array<() => void> = [];

  push(event: unknown): void {
    this.queue.push(event);
    for (const waiter of this.waiters.splice(0)) waiter();
  }

  async *stream(signal?: AbortSignal): AsyncGenerator<unknown> {
    while (!signal?.aborted) {
      if (this.queue.length === 0) {
        await new Promise<void>((resolve) => {
          this.waiters.push(resolve);
          signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        if (signal?.aborted) return;
      }
      const next = this.queue.shift();
      if (next !== undefined) yield next;
    }
  }
}

function readJson(path: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  return true;
}

async function waitFor<T>(check: () => T | undefined, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = check();
    if (last !== undefined) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("timed out waiting for the expected state");
}
