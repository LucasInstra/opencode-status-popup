import { Plugin } from "@opencode/plugin";
import { parseConfig } from "./config";
import { HostSupervisor } from "./host";
import { hostScriptPath, instanceSlug, presenceFileOf, projectNameOf, statusStateDir } from "./paths";
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

    const activity = new SessionActivity();
    const presence = new PresenceWriter(presenceFileOf(stateDir, directory), {
      instance: instanceSlug(directory),
      project,
      directory,
      mode: config.mode,
    });
    const host = new HostSupervisor({
      scriptPath: hostScriptPath(),
      stateDir,
      settings: {
        mode: config.mode,
        word: config.word,
        typeMs: config.typeMs,
        fresh: config.freshSeconds,
        idle: config.idleSeconds,
      },
      shellPath: config.shellPath,
      log: (message) => console.error(`[${PLUGIN_ID}] ${message}`),
    });

    let snapshot = activity.snapshot();
    presence.sync(snapshot);
    await host.ensure();

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

    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          if (!belongsToLocation(event, directory)) continue;
          snapshot = activity.apply(event) ?? snapshot;
          presence.sync(snapshot);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error(`[${PLUGIN_ID}] event stream stopped: ${String(error)}`);
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
