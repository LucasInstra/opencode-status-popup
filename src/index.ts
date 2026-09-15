import { Plugin } from "@opencode/plugin";
import { parseConfig, type PopupMode } from "./config";
import { createDebugLog } from "./debug";
import { HostSupervisor, type HostSettings } from "./host";
import { hostScriptPath, instanceSlug, presenceFileOf, projectNameOf, statusStateDir } from "./paths";
import { MODE_PREFERENCE_KEY, resolveMode, toggleMode } from "./preferences";
import { PresenceWriter } from "./presence";
import { SessionActivity, type RawEvent } from "./status";

const PLUGIN_ID = "opencode.status-popup";
const HEARTBEAT_MS = 3000;
const SUPERVISE_MS = 8000;

export default Plugin.define({
  id: PLUGIN_ID,
  async setup(ctx) {
    const config = parseConfig(ctx.options);
    if (!config.enabled) return;
    if (process.platform !== "win32") {
      return;
    }

    const directory = ctx.location.directory;
    const stateDir = statusStateDir(process.env.OPENCODE_STATUS_POPUP_DIR);
    const project = projectNameOf(directory);
    const trace = createDebugLog(stateDir);

    const stored = await ctx.storage.get(MODE_PREFERENCE_KEY).catch(() => undefined);
    const settings: HostSettings = {
      mode: resolveMode(stored, config.mode),
      word: config.word,
      typeMs: config.typeMs,
      fresh: config.freshSeconds,
      idle: config.idleSeconds,
      mark: config.mark,
    };
    trace(`setup directory=${directory} project=${project} mode=${settings.mode} pid=${process.pid}`);

    const activity = new SessionActivity({ errorHoldMs: config.errorHoldSeconds * 1000 });
    const presence = new PresenceWriter(presenceFileOf(stateDir, directory), {
      instance: instanceSlug(directory),
      project,
      directory,
      mode: settings.mode,
    });
    const host = new HostSupervisor({
      scriptPath: hostScriptPath(),
      stateDir,
      settings,
      shellPath: config.shellPath,
      log: (message) => console.error(`[${PLUGIN_ID}] ${message}`),
    });

    let snapshot = activity.snapshot();
    presence.sync(snapshot);
    // Do not block location activation on PowerShell startup; the supervisor
    // interval keeps trying and reports failures through the log.
    void host.ensure();

    const controller = new AbortController();
    const heartbeat = setInterval(() => {
      snapshot = activity.snapshot();
      presence.refresh(snapshot);
    }, HEARTBEAT_MS);
    const supervise = setInterval(() => {
      void host.ensure();
    }, SUPERVISE_MS);
    heartbeat.unref?.();
    supervise.unref?.();

    // /popup-* commands: the renderer is switchable at runtime, the choice is
    // remembered, and the host restarts because its settings no longer match.
    const switchMode = async (mode: PopupMode, persist: boolean): Promise<void> => {
      if (settings.mode !== mode) {
        settings.mode = mode;
        presence.setMode(mode);
        presence.sync(snapshot);
      }
      await (persist
        ? ctx.storage.set(MODE_PREFERENCE_KEY, mode)
        : ctx.storage.remove(MODE_PREFERENCE_KEY)
      ).catch(() => undefined);
      trace(`switch mode=${mode} persist=${persist}`);
    };

    await ctx.command.transform((editor) => {
      editor.add({
        name: "popup-window",
        description: "Status popup: show the floating pill instead of the tray icon",
        execute: async () => {
          await switchMode("window", true);
          void host.ensure();
        },
      });
      editor.add({
        name: "popup-tray",
        description: "Status popup: show a tray icon instead of the floating pill",
        execute: async () => {
          await switchMode("tray", true);
          void host.ensure();
        },
      });
      editor.add({
        name: "popup-toggle",
        description: "Status popup: switch between the floating pill and the tray icon",
        execute: async () => {
          const next = toggleMode(settings.mode === "tray" ? "tray" : "window");
          await switchMode(next, true);
          void host.ensure();
        },
      });
      editor.add({
        name: "popup-reset",
        description: "Status popup: forget the chosen mode and use the one from the config",
        execute: async () => {
          await switchMode(config.mode, false);
          void host.ensure();
        },
      });
    });

    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          const accepted = belongsToLocation(event, directory);
          if (accepted) {
            snapshot = activity.apply(event) ?? snapshot;
            presence.sync(snapshot);
          }
          trace(`event ${event.type} accepted=${accepted} phase=${snapshot.phase} busy=${snapshot.busy}`);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error(`[${PLUGIN_ID}] event stream stopped: ${String(error)}`);
        trace(`stream stopped: ${String(error)}`);
      }
    })();

    return () => {
      controller.abort();
      clearInterval(heartbeat);
      clearInterval(supervise);
      presence.dispose();
      host.shutdown();
    };
  },
});

function belongsToLocation(event: RawEvent & { location?: unknown }, directory: string): boolean {
  const location = event.location;
  if (typeof location !== "object" || location === null) return true;
  const eventDirectory = (location as Record<string, unknown>).directory;
  if (typeof eventDirectory !== "string" || !eventDirectory) return true;
  return normalizeDirectory(eventDirectory) === normalizeDirectory(directory);
}

function normalizeDirectory(value: string): string {
  return value.replace(/[\\/]+$/, "").replace(/\//g, "\\").toLowerCase();
}
