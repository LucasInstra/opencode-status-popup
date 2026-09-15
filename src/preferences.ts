import type { PopupMode } from "./config";

/** Key used in the plugin storage for the mode chosen with /popup-*. */
export const MODE_PREFERENCE_KEY = "mode";

/**
 * The /popup-* commands are the runtime switch; the configured mode is only the
 * fallback for when nothing has been chosen yet.
 */
export function resolveMode(stored: unknown, configured: PopupMode): PopupMode {
  return stored === "tray" || stored === "window" ? stored : configured;
}

/** The mode a toggle command lands on. */
export function toggleMode(current: PopupMode): PopupMode {
  return current === "tray" ? "window" : "tray";
}
