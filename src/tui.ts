import { mkdirSync, writeFileSync } from "node:fs";
import type { Plugin } from "@opencode/plugin/tui";
import { modeRequestPathOf, statusStateDir } from "./paths";

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
 * instance watches that file every 500 ms, applies the change to the shared
 * mode and restarts the host, exactly like the popup menu does.
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

export default {
  id: "opencode.status-popup",
  setup(context: Plugin.Context) {
    const stateDir = statusStateDir(process.env.OPENCODE_STATUS_POPUP_DIR);

    const request = (mode: RequestedMode): boolean => {
      try {
        mkdirSync(stateDir, { recursive: true });
        writeFileSync(modeRequestPathOf(stateDir), JSON.stringify({ mode }));
        return true;
      } catch {
        return false;
      }
    };

    context.ui.slot({
      append: "app",
      render() {
        context.keymap.layer(() => ({
          mode: "global",
          commands: MODES.map((mode) => ({
            id: `popup.${mode}`,
            title: TITLE[mode],
            group: "Popup",
            palette: true,
            run() {
              const sent = request(mode);
              context.ui.toast.show({
                variant: sent ? "info" : "error",
                message: sent ? DONE[mode] : "Popup: could not reach the status popup state directory",
              });
            },
          })),
        }));
        return null;
      },
    });
  },
} satisfies Plugin.Definition;
