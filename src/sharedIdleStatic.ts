import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";

/**
 * The tray idle choice made at runtime lives in a file next to the presence
 * data, for the same reason the mode does: several plugin instances (one per
 * location, or a reloaded instance next to an old one) all supervise the same
 * host process, so they have to agree on it or they keep killing each other's
 * host.
 */
export function readSharedIdleStatic(path: string): boolean | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { trayIdleStatic?: unknown };
    return typeof parsed?.trayIdleStatic === "boolean" ? parsed.trayIdleStatic : undefined;
  } catch {
    return undefined;
  }
}

/** Passing undefined removes the file, which is what a reset does. */
export function writeSharedIdleStatic(path: string, value: boolean | undefined): void {
  try {
    if (value === undefined) {
      rmSync(path, { force: true });
      return;
    }
    const temporary = `${path}.tmp`;
    writeFileSync(temporary, JSON.stringify({ trayIdleStatic: value }));
    renameSync(temporary, path);
  } catch {
    // a failed write only delays the convergence of other instances
  }
}
