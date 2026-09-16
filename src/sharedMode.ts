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
