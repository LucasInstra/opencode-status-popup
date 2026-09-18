import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import type { PopupMode } from "./config";

/**
 * The renderer chosen at runtime lives in a file next to the presence data,
 * not in plugin memory: several plugin instances (one per location, or a
 * reloaded instance next to an old one) all supervise the same host process, so
 * they have to agree on the mode or they keep killing each other's host.
 */
export function readSharedMode(path: string): PopupMode | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { mode?: unknown };
    return parsed?.mode === "tray" || parsed?.mode === "window" ? parsed.mode : undefined;
  } catch {
    return undefined;
  }
}

/** Passing undefined removes the file, which is what a reset does. */
export function writeSharedMode(path: string, mode: PopupMode | undefined): void {
  try {
    if (!mode) {
      rmSync(path, { force: true });
      return;
    }
    const temporary = `${path}.tmp`;
    writeFileSync(temporary, JSON.stringify({ mode }));
    renameSync(temporary, path);
  } catch {
    // a failed write only delays the convergence of other instances
  }
}

/**
 * Reads and consumes a request file left by the TUI palette or the host menu.
 *
 * The file is replaced atomically by its writers, so a payload that does not
 * parse can only be a leftover: it is dropped, or the watcher would wedge on
 * it. A read that fails is left alone instead — the file may be briefly locked
 * (AV, indexer) and the caller polls again 100 ms later.
 */
export function consumeRequest(path: string): Record<string, unknown> | undefined {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return undefined; // nothing waiting, or a transient lock
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    dropRequest(path);
    return undefined;
  }

  // Only hand the request over once it is gone: a file that resists removal
  // (an indexer holding it) would otherwise be applied again every tick, and
  // `toggle` is not idempotent.
  if (!dropRequest(path)) return undefined;
  return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
}

/** The mode request file, typed for the payload its writer sends. */
export function consumeModeRequest(path: string): { mode?: unknown } | undefined {
  return consumeRequest(path);
}

function dropRequest(path: string): boolean {
  try {
    rmSync(path, { force: true });
    return true;
  } catch {
    return false;
  }
}
