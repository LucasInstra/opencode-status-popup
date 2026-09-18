import type { PopupMode } from "./config";

/** Key used in the plugin storage for the mode chosen with /popup-*. */
export const MODE_PREFERENCE_KEY = "mode";

/** Key used in the plugin storage for the tray idle chosen with /popup-static. */
export const IDLE_STATIC_PREFERENCE_KEY = "trayIdleStatic";

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

/**
 * The /popup-static command is the runtime switch; the configured value is only
 * the fallback for when nothing has been chosen yet.
 */
export function resolveIdleStatic(stored: unknown, configured: boolean): boolean {
  return typeof stored === "boolean" ? stored : configured;
}

/** The tray idle a toggle command lands on. */
export function toggleIdleStatic(current: boolean): boolean {
  return !current;
}
