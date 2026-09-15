import { appendFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MAX_BYTES = 512 * 1024;

/**
 * Optional tracing for the plugin side, written next to the presence files.
 * Enable it with OPENCODE_STATUS_POPUP_DEBUG=1; the log is capped so it cannot
 * grow forever, and every failure inside it is swallowed.
 */
export function createDebugLog(stateDir: string): (line: string) => void {
  if (process.env.OPENCODE_STATUS_POPUP_DEBUG !== "1") return () => {};

  const file = join(stateDir, "plugin.log");
  return (line: string) => {
    try {
      try {
        if (statSync(file).size > MAX_BYTES) return;
      } catch {
        // the file does not exist yet
      }
      appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
    } catch {
      // tracing must never break the plugin
    }
  };
}
