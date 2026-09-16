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
 * Reads and consumes a mode request left by the TUI palette or the host menu.
 *
 * The file is replaced atomically by its writers, so a payload that does not
 * parse can only be a leftover: it is dropped, or the watcher would wedge on
 * it. A read that fails is left alone instead — the file may be briefly locked
 * (AV, indexer) and the caller polls again 100 ms later.
 */
export function consumeModeRequest(path: string): { mode?: unknown } | undefined {
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
    dropModeRequest(path);
    return undefined;
  }

  dropModeRequest(path);
  return typeof parsed === "object" && parsed !== null ? (parsed as { mode?: unknown }) : {};
}

function dropModeRequest(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // a failed removal only re-applies an idempotent switch on the next tick
  }
}
