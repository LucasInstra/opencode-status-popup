import { appendFileSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const MAX_BYTES = 512 * 1024;
const PREVIOUS_SUFFIX = ".1";

/**
 * Optional tracing for the plugin side, written next to the presence files.
 * Enable it with OPENCODE_STATUS_POPUP_DEBUG=1; the log rotates at the cap
 * (one previous generation, `plugin.log.1`), so it cannot grow forever and the
 * newest lines are the ones kept. Every failure inside it is swallowed.
 */
export function createDebugLog(stateDir: string): (line: string) => void {
  if (process.env.OPENCODE_STATUS_POPUP_DEBUG !== "1") return () => {};

  const file = join(stateDir, "plugin.log");
  return (line: string) => {
    try {
      rotateIfFull(file);
      appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
    } catch {
      // tracing must never break the plugin
    }
  };
}

function rotateIfFull(file: string): void {
  let size: number;
  try {
    size = statSync(file).size;
  } catch {
    return; // the file does not exist yet
  }
  if (size <= MAX_BYTES) return;

  // A rotation that fails (a reader holds the file) must not fall back to
  // appending: the cap is what keeps the log from growing forever, so the
  // caller drops the line instead.
  const previous = `${file}${PREVIOUS_SUFFIX}`;
  rmSync(previous, { force: true });
  renameSync(file, previous);
}
