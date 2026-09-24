#!/usr/bin/env node
// Dev tool: drives the popup host without OpenCode.
//
//   node scripts/preview.mjs --mode window --state busy
//   node scripts/preview.mjs --mode tray --watch
//   node scripts/preview.mjs --stop
//
// It writes the same presence file the plugin writes, so the host cannot tell
// the difference.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const stateDir = join(tmpdir(), "opencode-status-popup");
const presenceDir = join(stateDir, "state");
const presenceFile = join(presenceDir, "preview.json");
const hostInfoFile = join(stateDir, "host.json");
const hostScript = join(root, "host", "popup.ps1");

const options = parseArgs(process.argv.slice(2));

if (options.stop) {
  stopHost();
  process.exit(0);
}

mkdirSync(presenceDir, { recursive: true });

const project = "preview";
const workingStates = new Set(["busy", "retry"]);
let state = options.state;
const defaultDetail = state === "error" ? "429 provider.rate-limit" : state === "permission" ? "bash git status" : "";

writePresence();
startHeartbeat();
let spawnedHost = false;
const spawned = await ensureHost();
spawnedHost = spawned;

console.log(`state dir: ${stateDir}`);
console.log(`host: ${spawned ? "spawned" : "already running"}`);
console.log(`state: ${options.state}${options.watch ? " (cycling)" : ""}`);
console.log("use --stop to clean up, or Ctrl+C");

if (options.seconds > 0) {
  setTimeout(() => {
    release();
    process.exit(0);
  }, options.seconds * 1000);
}

if (options.watch) {
  const cycle = ["busy", "retry", "error", "permission", "idle"];
  // Continue the cycle from the state that is already showing, which is what
  // `--state` promises; a plain `--watch` starts at busy as before.
  const start = cycle.indexOf(state);
  let index = start >= 0 ? start : 0;
  setInterval(() => {
    index = (index + 1) % cycle.length;
    state = cycle[index];
    writePresence();
    console.log(`state: ${state}`);
  }, 6000);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(options.keep ? "\nleaving the preview host running" : "\nstopping preview host");
    release();
    process.exit(0);
  });
}

function parseArgs(args) {
  const parsed = {
    mode: "window",
    state: "busy",
    detail: undefined,
    word: "opencode",
    type: 140,
    idleStatic: false,
    watch: false,
    keep: false,
    stop: false,
    seconds: 0,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const eq = arg.indexOf("=");
    const key = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);
    const takeValue = () => (inline !== undefined ? inline : args[++i]);
    switch (key) {
      case "--mode":
        parsed.mode = takeValue() === "tray" ? "tray" : "window";
        break;
      case "--state": {
        const value = takeValue();
        parsed.state = ["busy", "idle", "retry", "error", "permission"].includes(value) ? value : "busy";
        break;
      }
      case "--detail":
        parsed.detail = takeValue() ?? undefined;
        break;
      case "--word":
        parsed.word = takeValue() ?? parsed.word;
        break;
      case "--type":
        parsed.type = Number(takeValue()) || parsed.type;
        break;
      case "--idle-static":
        parsed.idleStatic = true;
        break;
      case "--seconds":
        parsed.seconds = Number(takeValue()) || 0;
        break;
      case "--watch":
        parsed.watch = true;
        break;
      case "--keep":
        parsed.keep = true;
        break;
      case "--stop":
        parsed.stop = true;
        break;
      default:
        break;
    }
  }
  return parsed;
}

function writePresence() {
  const payload = {
    version: 1,
    instance: "preview",
    pid: process.pid,
    project,
    directory: root,
    mode: options.mode,
    phase: state,
    busy: workingStates.has(state) ? 1 : 0,
    retry: state === "retry" ? 1 : 0,
    errors: state === "error" ? 1 : 0,
    permissions: state === "permission" ? 1 : 0,
    detail: options.detail ?? defaultDetail,
    updated: Date.now(),
  };
  const tmp = `${presenceFile}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(payload));
    renameSync(tmp, presenceFile);
  } catch {
    // The host may be reading the file right now; the next heartbeat retries.
  }
}

function startHeartbeat() {
  setInterval(writePresence, 3000);
}

function readHostInfo() {
  try {
    return JSON.parse(readFileSync(hostInfoFile, "utf8"));
  } catch {
    return undefined;
  }
}

function hostIsLive() {
  const info = readHostInfo();
  if (!info || typeof info.pid !== "number") return false;
  if (Date.now() - (info.updated ?? 0) > 6000) return false;
  try {
    process.kill(info.pid, 0);
  } catch {
    return false;
  }
  return true;
}

async function ensureHost() {
  const info = readHostInfo();
  if (hostIsLive()) {
    const idleMatches = options.mode !== "tray" || (info?.trayIdleStatic ?? false) === options.idleStatic;
    if (info?.mode === options.mode && info?.word === options.word && idleMatches) return false;
    // the plugin restarts a host whose settings changed; do the same here
    try {
      process.kill(info.pid);
    } catch {
      // already gone
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  await spawnHost();
  return true;
}

async function spawnHost() {
  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-WindowStyle",
    "Hidden",
    "-Sta",
    "-File",
    hostScript,
    "-Mode",
    options.mode,
    // Attached to their flags: a bare value that looks like a host parameter
    // (for example `--word -Mark`) would be bound as a parameter instead.
    `-StateDir:${stateDir}`,
    `-Word:${options.word || "opencode"}`,
    "-TypeMs",
    String(options.type),
    "-TrayIdleStatic",
    options.idleStatic ? "1" : "0",
  ];
  if (options.keep) args.push("-KeepAlive");
  for (const shell of ["pwsh.exe", "powershell.exe"]) {
    const ok = await trySpawn(shell, args);
    if (ok) return;
  }
  throw new Error("cannot find pwsh.exe or powershell.exe");
}

function trySpawn(shell, args) {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(shell, args, { stdio: "ignore", windowsHide: true });
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => done(true), 700);
    child.on("error", () => done(false));
    child.on("spawn", () => {
      child.unref();
      done(true);
    });
  });
}

function stopHost() {
  const info = readHostInfo();
  if (info?.pid) {
    try {
      process.kill(info.pid);
    } catch {
      // already gone
    }
  }
  try {
    if (existsSync(presenceFile)) rmSync(presenceFile);
  } catch {
    // ignore
  }
}

/**
 * Drops our presence file and stops the host when this run started it, unless
 * --keep asked for the host to survive the preview. A host the preview only
 * attached to (the real plugin's) is always left alone.
 */
function release() {
  try {
    if (existsSync(presenceFile)) rmSync(presenceFile);
  } catch {
    // ignore
  }
  if (options.keep) return;
  if (!spawnedHost) return;
  const info = readHostInfo();
  if (info?.pid) {
    try {
      process.kill(info.pid);
    } catch {
      // already gone
    }
  }
}
