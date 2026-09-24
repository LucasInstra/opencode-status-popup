import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import tui from "../src/tui";
import { idleStaticRequestPathOf, modeRequestPathOf } from "../src/paths";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  delete process.env.OPENCODE_STATUS_POPUP_DIR;
});

describe("tui entrypoint", () => {
  it("exports the shape the TUI loader looks for", () => {
    expect(typeof tui.id).toBe("string");
    expect(tui.id.length).toBeGreaterThan(0);
    expect(typeof tui.setup).toBe("function");
  });

  it("registers the five popup commands in a keymap layer, palette-only", () => {
    const { context, layer } = mount();
    const commands = layer().commands ?? [];
    // No slash names: the `/` completion lists the server commands, and a slash
    // name here would make every command show up twice.
    expect(commands.every((command) => command.slash === undefined)).toBe(true);
    expect(commands.every((command) => command.palette === true)).toBe(true);
    expect(commands.map((command) => command.id)).toEqual([
      "popup.window",
      "popup.tray",
      "popup.toggle",
      "popup.reset",
      "popup.static",
    ]);
    expect(layer().mode).toBe("global");
  });

  it("writes a mode request for every renderer command and toasts the outcome", () => {
    const stateDir = stateDirFor("commands");
    const { context, layer } = mount(stateDir);
    const commands = (layer().commands ?? []).filter((command) => command.id !== "popup.static");
    const expected = ["window", "tray", "toggle", "reset"];

    for (const [index, command] of commands.entries()) {
      expect(command.run).toBeTypeOf("function");
      command.run?.();
      const request = JSON.parse(readFileSync(modeRequestPathOf(stateDir), "utf8")) as { mode?: string };
      expect(request.mode).toBe(expected[index]);
      expect(context.toasts.at(-1)?.variant).toBe("info");
    }
    expect(context.toasts).toHaveLength(4);
    // The request file is replaced atomically; the temporary never survives.
    expect(existsSync(`${modeRequestPathOf(stateDir)}.tmp`)).toBe(false);
  });

  it("writes a toggle request for the tray idle command", () => {
    const stateDir = stateDirFor("idle-static");
    const { context, layer } = mount(stateDir);
    const command = (layer().commands ?? []).find((next) => next.id === "popup.static");

    expect(command?.run).toBeTypeOf("function");
    command?.run?.();
    expect(JSON.parse(readFileSync(idleStaticRequestPathOf(stateDir), "utf8"))).toEqual({
      idleStatic: "toggle",
    });
    expect(context.toasts.at(-1)?.variant).toBe("info");
    expect(existsSync(`${idleStaticRequestPathOf(stateDir)}.tmp`)).toBe(false);
  });

  it("hands the slot claim back, so a reload cannot stack the palette", () => {
    const { cleanup, disposed } = mount();

    expect(disposed()).toBe(false);
    cleanup();
    expect(disposed()).toBe(true);
  });

  it("stays off the palette when the plugin is disabled", () => {
    const stateDir = stateDirFor("disabled");
    const { context, claimed, cleanup } = mount(stateDir, { enabled: false });

    expect(claimed()).toBe(false);
    expect(context.toasts).toEqual([]);
    expect(existsSync(modeRequestPathOf(stateDir))).toBe(false);
    cleanup();
  });

  it("stays off the palette when the platform cannot render the popup", () => {
    const original = process.platform;
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    try {
      const { context, claimed } = mount();
      expect(claimed()).toBe(false);
      expect(context.toasts).toEqual([]);
    } finally {
      Object.defineProperty(process, "platform", { value: original, configurable: true });
    }
  });

  it("reports an error instead of throwing when the request cannot be written", () => {
    const blocked = join(stateDirFor("blocked"), "not-a-directory");
    writeFileSync(blocked, "a file where the state directory should be");
    const { context, layer } = mount(blocked);

    const command = (layer().commands ?? [])[0];
    expect(() => command?.run?.()).not.toThrow();
    expect(context.toasts.at(-1)?.variant).toBe("error");
    expect(existsSync(modeRequestPathOf(blocked))).toBe(false);
  });
});

interface Toasts {
  variant?: string;
  message?: string;
}

interface Command {
  id?: string;
  palette?: boolean;
  slash?: { name: string };
  run?: () => void;
}

interface Layer {
  mode?: string;
  commands?: ReadonlyArray<Command>;
}

interface Harness {
  context: { toasts: Toasts[] };
  layer: () => Layer;
  cleanup: () => void;
  disposed: () => boolean;
  claimed: () => boolean;
}

function mount(stateDir?: string, options: Record<string, unknown> = {}): Harness {
  if (stateDir) process.env.OPENCODE_STATUS_POPUP_DIR = stateDir;
  else delete process.env.OPENCODE_STATUS_POPUP_DIR;

  const toasts: Toasts[] = [];
  let claim: { render: () => unknown } | undefined;
  let registered: Layer | undefined;
  let disposed = false;

  const context = {
    options,
    toasts,
    ui: {
      slot: (next: { render: () => unknown }) => {
        claim = next;
        return () => {
          disposed = true;
        };
      },
      toast: { show: (options: Toasts) => void toasts.push(options) },
    },
    keymap: {
      layer: (input: () => Layer) => {
        registered = input();
      },
    },
  };

  const cleanup = tui.setup(context as never);
  claim?.render();

  return {
    context: { toasts },
    layer: () => {
      if (!registered) throw new Error("render did not register a keymap layer");
      return registered;
    },
    cleanup: () => {
      cleanup?.();
    },
    disposed: () => disposed,
    claimed: () => claim !== undefined,
  };
}

function stateDirFor(label: string): string {
  const directory = mkdtempSync(join(tmpdir(), `popup-tui-${label}-`));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
