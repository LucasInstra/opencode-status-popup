import { readFileSync, renameSync, writeFileSync } from "node:fs";
import type { PopupPosition } from "./config";

const POSITIONS: readonly PopupPosition[] = [
  "bottom-right",
  "bottom-left",
  "top-right",
  "top-left",
];

/**
 * The configured corner, published for the host next to the presence data.
 *
 * The host is shared by every instance and can outlive a config change, so it
 * reads this file when it actually places the pill (first show, or Reset
 * position) instead of trusting the launch argument forever. A host started by
 * tooling that does not write the file keeps its argument.
 */
export function readSharedPosition(path: string): PopupPosition | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { position?: unknown };
    return POSITIONS.find((position) => position === parsed?.position);
  } catch {
    return undefined;
  }
}

export function writeSharedPosition(path: string, position: PopupPosition): void {
  try {
    const temporary = `${path}.tmp`;
    writeFileSync(temporary, JSON.stringify({ position }));
    renameSync(temporary, path);
  } catch {
    // a failed write only means the host keeps its launch position
  }
}
