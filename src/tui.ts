import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import type { Plugin } from "@opencode/plugin/tui";
import { parseConfig } from "./config";
import { idleStaticRequestPathOf, modeRequestPathOf, statusStateDir } from "./paths";

/**
 * TUI entrypoint. Commands registered here run in the client process and show
 * up in the command palette, where they answer immediately — the server
 * commands of src/index.ts are known to the server only, so they never reach
 * the palette.
 *
 * They are deliberately palette-only: the `/` autocomplete already lists every
 * server command (the client appends them to the keymap slashes without
 * deduplicating), so a slash name here would show each command twice.
 *
 * A command drops a request file next to the presence data. Every server
 * instance watches those files every 100 ms, applies the change (the shared
 * mode, or the tray idle) and restarts the host, exactly like the popup menu
 * does for the mode.
 *
 * The SDK is imported as a type only: the runtime barrel pulls in solid-js,
 * which a plugin should not need just to register a few commands. The TUI
 * loader accepts any default export shaped like Plugin.Definition.
 */
const MODES = ["window", "tray", "toggle", "reset"] as const;
type RequestedMode = (typeof MODES)[number];

const TITLE: Record<RequestedMode, string> = {
  window: "Popup: show as window",
  tray: "Popup: show in the tray",
  toggle: "Popup: switch renderer",
  reset: "Popup: back to the configured renderer",
};

const DONE: Record<RequestedMode, string> = {
  window: "Popup: switching to the window",
  tray: "Popup: switching to the tray",
  toggle: "Popup: switching the renderer",
  reset: "Popup: going back to the configured renderer",
};

const COULD_NOT_REACH = "Popup: could not reach the status popup state directory";
const TOGGLE_IDLE_STATIC = "Popup: switching the tray idle icon";

export default {
  id: "opencode.status-popup",
  setup(context: Plugin.Context) {
    // A disabled plugin must stay out of the palette: the commands would
    // otherwise write mode requests nobody consumes and toast a success that
    // never happens.
    if (!parseConfig(context.options).enabled) return;
    // The host is Windows only (PowerShell + WPF/WinForms); on other platforms
    // the palette would do the same pointless thing, so stay out of it like
    // the server entrypoint does.
    if (process.platform !== "win32") return;

    const stateDir = statusStateDir(process.env.OPENCODE_STATUS_POPUP_DIR);

    const request = (payload: { mode: RequestedMode } | { idleStatic: "toggle" }): boolean => {
      try {
        mkdirSync(stateDir, { recursive: true });
        // Replace the file atomically: the server polls it from its own
        // process, so it must never read a half written payload.
        const target =
          "mode" in payload ? modeRequestPathOf(stateDir) : idleStaticRequestPathOf(stateDir);
        const temporary = `${target}.tmp`;
        writeFileSync(temporary, JSON.stringify(payload));
        renameSync(temporary, target);
        return true;
      } catch {
        return false;
      }
    };

    // The slot owns the keymap layer registered during its render, so returning
    // its disposer is what unregisters the palette on a reload or a disable;
    // without it every reload would stack a second copy of the commands.
    const disposeSlot = context.ui.slot({
      append: "app",
      render() {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            ...MODES.map((mode) => ({
              id: `popup.${mode}`,
              title: TITLE[mode],
              group: "Popup",
              palette: true as const,
              run() {
                const sent = request({ mode });
                context.ui.toast.show({
                  variant: sent ? "info" : "error",
                  message: sent ? DONE[mode] : COULD_NOT_REACH,
                });
              },
            })),
            {
              id: "popup.static",
              title: "Popup: tray idle static",
              group: "Popup",
              palette: true as const,
              run() {
                const sent = request({ idleStatic: "toggle" });
                context.ui.toast.show({
                  variant: sent ? "info" : "error",
                  message: sent ? TOGGLE_IDLE_STATIC : COULD_NOT_REACH,
                });
              },
            },
          ],
        }));
        return null;
      },
    });

    return () => disposeSlot();
  },
} satisfies Plugin.Definition;
