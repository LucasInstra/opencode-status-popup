import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const STATE_FOLDER = "opencode-status-popup";

export function statusStateDir(override?: string | null): string {
  return override && override.trim() ? override.trim() : join(tmpdir(), STATE_FOLDER);
}

export function presenceDirOf(stateDir: string): string {
  return join(stateDir, "state");
}

export function hostInfoPathOf(stateDir: string): string {
  return join(stateDir, "host.json");
}

/** Written by a host menu item ("Show in tray" / "Show as window"). */
export function modeRequestPathOf(stateDir: string): string {
  return join(stateDir, "mode.request");
}

/**
 * The chosen renderer, shared by every plugin instance: the host is a single
 * process, so the mode cannot live in per instance state or instances fight.
 */
export function sharedModePathOf(stateDir: string): string {
  return join(stateDir, "mode.json");
}

export function hostScriptPath(): string {
  return fileURLToPath(new URL("../host/popup.ps1", import.meta.url));
}

/** One host per state directory, so tests and custom dirs do not collide. */
export function hostMutexName(stateDir: string): string {
  return `Local\\opencode-status-popup-${hash(stateDir)}`;
}

export function presenceFileOf(stateDir: string, directory: string): string {
  return join(presenceDirOf(stateDir), `${instanceSlug(directory)}.json`);
}

export function projectNameOf(directory: string): string {
  const trimmed = directory.replace(/[\\/]+$/, "");
  return basename(trimmed) || trimmed || "opencode";
}

export function instanceSlug(directory: string): string {
  const name = projectNameOf(directory)
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .slice(0, 32)
    .replace(/^-+|-+$/g, "");
  return `${name || "project"}-${hash(directory)}`;
}

/** FNV-1a, only used to build a stable file name per project directory. */
function hash(value: string): string {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193) >>> 0;
  }
  return result.toString(16).padStart(8, "0");
}
