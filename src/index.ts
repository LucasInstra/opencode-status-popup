import { Plugin } from "@opencode/plugin";
import { parseConfig, type PopupMode } from "./config";
import { createDebugLog } from "./debug";
import { HostSupervisor, type HostSettings } from "./host";
import {
  hostScriptPath,
  idleStaticRequestPathOf,
  instanceSlug,
  modeRequestPathOf,
  presenceFileOf,
  projectNameOf,
  sharedIdleStaticPathOf,
  sharedModePathOf,
  sharedPositionPathOf,
  statusStateDir,
} from "./paths";
import {
  IDLE_STATIC_PREFERENCE_KEY,
  MODE_PREFERENCE_KEY,
  resolveIdleStatic,
  resolveMode,
  toggleIdleStatic,
  toggleMode,
} from "./preferences";
import { PresenceWriter, reapStalePresenceFiles } from "./presence";
import { consumeModeRequest, consumeRequest, readSharedMode, writeSharedMode } from "./sharedMode";
import { readSharedIdleStatic, writeSharedIdleStatic } from "./sharedIdleStatic";
import { writeSharedPosition } from "./sharedPosition";
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

    const sharedModePath = sharedModePathOf(stateDir);
    const sharedIdleStaticPath = sharedIdleStaticPathOf(stateDir);
    // The renderer is shared state, not per instance: every instance supervises
    // the same host, so they read the choice from the shared file and follow it
    // (see the supervisor tick below) instead of killing each other's host.
    const stored = await ctx.storage.get(MODE_PREFERENCE_KEY).catch(() => undefined);
    const storedIdleStatic = await ctx.storage
      .get(IDLE_STATIC_PREFERENCE_KEY)
      .catch(() => undefined);
    // Published for the host, which reads it when it places the pill: a changed
    // corner applies on the next Reset position without a host restart.
    writeSharedPosition(sharedPositionPathOf(stateDir), config.position);
    const settings: HostSettings = {
      mode: readSharedMode(sharedModePath) ?? resolveMode(stored, config.mode),
      word: config.word,
      typeMs: config.typeMs,
      fresh: config.freshSeconds,
      idle: config.idleSeconds,
      mark: config.mark,
      trayIdleStatic:
        readSharedIdleStatic(sharedIdleStaticPath) ??
        resolveIdleStatic(storedIdleStatic, config.trayIdleStatic),
      position: config.position,
    };
    trace(`setup directory=${directory} project=${project} mode=${settings.mode} pid=${process.pid}`);

    const activity = new SessionActivity({ errorHoldMs: config.errorHoldSeconds * 1000 });
    // Reap before this instance writes: files a killed session left behind
    // would otherwise linger, and the shutdown check counts any file as a
    // live writer.
    reapStalePresenceFiles(stateDir, config.freshSeconds * 1000);
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
      // Follow the shared choice instead of insisting on this instance's own:
      // when two instances disagree, whoever ticks first would otherwise kill
      // the host the other one started, forever.
      const shared = readSharedMode(sharedModePath);
      const desired = shared ?? config.mode;
      if (desired !== settings.mode) {
        trace(`following shared mode=${desired} (was ${settings.mode})`);
        settings.mode = desired;
        presence.setMode(desired);
        presence.sync(snapshot);
      }
      // The tray idle follows the same shared choice, or two instances would
      // fight over the host they both supervise.
      const sharedStatic = readSharedIdleStatic(sharedIdleStaticPath);
      const desiredStatic = sharedStatic ?? config.trayIdleStatic;
      if (desiredStatic !== settings.trayIdleStatic) {
        trace(`following shared tray idle static=${desiredStatic} (was ${settings.trayIdleStatic})`);
        settings.trayIdleStatic = desiredStatic;
      }
      void host.ensure();
    }, SUPERVISE_MS);
    heartbeat.unref?.();
    supervise.unref?.();

    // /popup-* commands: the renderer is switchable at runtime, the choice is
    // remembered, and the host restarts because its settings no longer match.
    // Applying and restarting stay separate: a reset changes both runtime
    // choices and must restart once, after both, not once per choice.
    const applyMode = async (mode: PopupMode, persist: boolean): Promise<string> => {
      if (settings.mode !== mode) {
        settings.mode = mode;
        presence.setMode(mode);
        presence.sync(snapshot);
      }
      writeSharedMode(sharedModePath, persist ? mode : undefined);
      await (persist
        ? ctx.storage.set(MODE_PREFERENCE_KEY, mode)
        : ctx.storage.remove(MODE_PREFERENCE_KEY)
      ).catch(() => undefined);
      trace(`switch mode=${mode} persist=${persist}`);
      return mode;
    };

    const switchMode = async (mode: PopupMode, persist: boolean): Promise<string> => {
      const applied = await applyMode(mode, persist);
      void host.ensure();
      return applied;
    };

    const applyIdleStatic = async (value: boolean, persist: boolean): Promise<boolean> => {
      settings.trayIdleStatic = value;
      writeSharedIdleStatic(sharedIdleStaticPath, persist ? value : undefined);
      await (persist
        ? ctx.storage.set(IDLE_STATIC_PREFERENCE_KEY, value)
        : ctx.storage.remove(IDLE_STATIC_PREFERENCE_KEY)
      ).catch(() => undefined);
      trace(`switch tray idle static=${value} persist=${persist}`);
      return value;
    };

    const switchIdleStatic = async (value: boolean, persist: boolean): Promise<boolean> => {
      const applied = await applyIdleStatic(value, persist);
      void host.ensure();
      return applied;
    };

    const applyRequest = async (request: unknown): Promise<string | undefined> => {
      switch (request) {
        case "window":
          return switchMode("window", true);
        case "tray":
          return switchMode("tray", true);
        case "toggle":
          return switchMode(toggleMode(settings.mode === "tray" ? "tray" : "window"), true);
        case "reset": {
          // A reset forgets every runtime choice, the tray idle included. Both
          // are applied before the single ensure: restarting in between would
          // bring the old renderer up and only converge on the next tick.
          await applyIdleStatic(config.trayIdleStatic, false);
          const mode = await applyMode(config.mode, false);
          void host.ensure();
          return mode;
        }
        default:
          return undefined;
      }
    };

    const applyIdleStaticRequest = async (request: unknown): Promise<boolean | undefined> => {
      if (request === "toggle") {
        return switchIdleStatic(toggleIdleStatic(settings.trayIdleStatic), true);
      }
      return undefined;
    };

    const commands = await ctx.command.transform((editor) => {
      editor.add({
        name: "popup-window",
        description: "Status popup: show the floating pill instead of the tray icon",
        execute: async () => void (await applyRequest("window")),
      });
      editor.add({
        name: "popup-tray",
        description: "Status popup: show a tray icon instead of the floating pill",
        execute: async () => void (await applyRequest("tray")),
      });
      editor.add({
        name: "popup-toggle",
        description: "Status popup: switch between the floating pill and the tray icon",
        execute: async () => void (await applyRequest("toggle")),
      });
      editor.add({
        name: "popup-reset",
        description: "Status popup: forget the runtime choices and use the ones from the config",
        execute: async () => void (await applyRequest("reset")),
      });
      editor.add({
        name: "popup-static",
        description:
          "Status popup: toggle the tray idle icon between the static letter and the blinking one",
        execute: async () => void (await applyIdleStaticRequest("toggle")),
      });
    });

    // The same switch as a tool, so it can be asked for in a prompt ("put the
    // popup in the tray"): the palette only lists client side commands.
    const tools = await ctx.tool.transform((editor) => {
      editor.namespace({
        name: "popup",
        description: "opencode status popup: show it as a floating pill or as a tray icon",
      });
      editor.add({
        name: "mode",
        description:
          "Switch the opencode status popup between the floating pill window and the tray icon. Use 'toggle' when the user does not care which one, 'reset' to go back to the configured mode and tray idle.",
        input: {
          type: "object",
          properties: {
            mode: {
              type: "string",
              enum: ["window", "tray", "toggle", "reset"],
              description: "window shows the pill, tray shows the tray icon",
            },
          },
          required: ["mode"],
          additionalProperties: false,
        },
        options: { namespace: "popup", codemode: true },
        execute: async (input) => {
          const requested = (input as { mode?: unknown }).mode;
          const applied = await applyRequest(requested);
          if (!applied) return { content: `Unknown popup mode: ${String(requested)}` };
          return { content: `Status popup is now in ${applied} mode.` };
        },
      });
    });

    // Menu items in the host ("Show in tray" / "Show as window") and the TUI
    // palette leave request files: the choices are applied here, on the next
    // 100 ms tick, and the host is replaced when its settings no longer match.
    const requestFile = modeRequestPathOf(stateDir);
    const idleStaticRequestFile = idleStaticRequestPathOf(stateDir);
    const watchRequest = setInterval(() => {
      const consumed = consumeModeRequest(requestFile);
      if (consumed) {
        void applyRequest(consumed.mode).then((applied) => {
          trace(`mode request ${String(consumed.mode)} applied=${String(applied)}`);
        });
      }
      const consumedStatic = consumeRequest(idleStaticRequestFile);
      if (consumedStatic) {
        void applyIdleStaticRequest(consumedStatic.idleStatic).then((applied) => {
          trace(
            `idle static request ${String(consumedStatic.idleStatic)} applied=${String(applied)}`,
          );
        });
      }
    }, 100);
    watchRequest.unref?.();

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

    return async () => {
      // Latch the supervisor off before anything else: a mode switch already
      // in flight must not spawn a host after this cleanup took the presence
      // file away.
      host.deactivate();
      controller.abort();
      clearInterval(heartbeat);
      clearInterval(supervise);
      clearInterval(watchRequest);
      // Both registrations are disposable; a reload that skipped this would
      // stack a second copy of the commands and of the tool. A synchronous
      // throw must not skip the rest of the cleanup either.
      for (const registration of [commands, tools]) {
        try {
          await registration.dispose();
        } catch {
          // keep cleaning up
        }
      }
      presence.dispose();
      // With our file gone, reap again: a stale file from a crashed session
      // must not veto the stop. Live instances stay, so this only stops the
      // host when it really is the last one.
      reapStalePresenceFiles(stateDir, config.freshSeconds * 1000);
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
