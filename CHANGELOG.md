# Changelog

Notable changes to this project, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- Stale and orphaned presence files are reaped: on the next plugin setup, and
  again before the last instance decides whether the host can stop, so a file
  left behind by a killed session neither lingers forever nor vetoes the stop.
  Targets are files whose `updated` went stale, payloads that cannot be parsed
  and orphaned `*.tmp` writes; a file that is momentarily unreadable is left
  alone.

### Changed

- Both logs rotate at their cap instead of stopping or vanishing: `plugin.log`
  keeps one previous generation as `plugin.log.1` (512 KiB), `host.log` does
  the same (256 KiB), and the newest lines are never the ones thrown away.
- TUI: with `enabled: false` the four palette commands are no longer
  registered, so they cannot write a mode request nobody consumes or toast a
  success that never happens.
- The host is no longer given up on during a cold start: a shell that is still
  alive after the first 2.5 s keeps its probe window (up to 10 s) instead of
  being abandoned for the next interpreter, and a shell that cannot even start
  fails over immediately. The "no usable PowerShell found" warning now fires
  only when no shell reached a heartbeat, and points at `host.log`.

### Fixed

- Free-form host arguments that match a parameter name (`-Mark`, `-Word`, or
  a dash-prefixed `OPENCODE_STATUS_POPUP_DIR`) no longer break the host before
  it can log anything: the value travels attached to its flag
  (`-Word:value`, `-StateDir:value`), which PowerShell binds as a value
  whatever it looks like.
- A mode switch already in flight when the plugin shuts down can no longer
  spawn a host after the cleanup removed the presence file: the supervisor
  latches off before the rest of the cleanup runs and kills a shell that was
  still starting.
- Docs: the `session.command` example uses `name` (the field the API expects),
  `typeMs` is scoped to the pill, `OPENCODE_STATUS_POPUP_DIR` is documented,
  and a live-vs-restart table says what a change to each option does to a
  running host.

## 0.2.3 — 2026-09-16

### Fixed

- `position` now reaches the host: it was parsed and documented but never passed
  on the command line, so a fresh profile always opened bottom-right and
  `Reset position` ignored the configured corner. The corner is resolved when
  the pill is placed (first show, or reset), so a change applies without moving
  a pill you already dragged and without restarting the host.
- TUI: the entrypoint hands its slot claim back. `ui.slot` returns the disposer
  and the keymap layer is owned by the slot, so a reload or a disable no longer
  leaves the four palette commands behind and stacks a second copy.
- Server: the command and the tool registration are disposed on shutdown, for
  the same reason — a reload no longer stacks a second copy of `/popup-*` and
  `popup_mode`.
- The `mode.request` handoff is written atomically on the client side and parsed
  before the file is removed, so a switch cannot be lost to a half written file.
- `npm run docs:gif` rebuilds `docs/typing.gif` and `docs/tray.gif`, which is
  what the README always promised.
- Tray: the letter builds at the documented pace again (about two pixels per
  250 ms tick; the 22-cell ring rounds to a step of two).

### Changed

- `@opencode/plugin` bumped from `^2.0.4` to `^2.0.5`.
- Dev: `host/popup.ps1` defaults `-Mark` to off, so `npm run preview*` and the
  foreground dev host match the documented default (the plugin always passed the
  option explicitly).
- Dev: `npm run preview -- --watch --state <s>` continues the cycle from `<s>`
  instead of always resuming at `retry`, which is what the README promised.
- Docs: the state directory files are named in the README (`host.json`,
  `mode.json`, `mode.request`, `position.json`, and the preview harness's
  `preview.json`), the option ranges are documented, and the stale "500 ms"
  comment and the prompt command path were corrected.

## 0.2.2 — 2026-09-16

### Fixed

- TUI: `/popup` no longer lists every command twice. The `/` completion appends
  the server commands to the keymap slashes without deduplicating, so the
  commands registered by `tui.ts` showed up next to the identical server ones.
  The TUI entrypoint is palette-only now (`ctrl+p`); `/popup` keeps the server
  commands and the palette keeps the client-side ones.

## 0.2.1 — 2026-09-16

### Added

- TUI entrypoint (`tui.ts`): `/popup-window`, `/popup-tray`, `/popup-toggle` and
  `/popup-reset` now show up in the `/` autocomplete and the command palette.
  The command leaves a request file next to the presence data, so the switch
  takes the same path the popup menu uses and every server instance applies it.
- `exports["./tui"]` so an npm install exposes the same entrypoint, plus a root
  `tui.ts` that re-exports it for plugin directories, where a loader resolves a
  `tui` file next to `index.ts` instead of the package exports.

### Changed

- Pill: a **left click brings the OpenCode terminal forward**, the same focus
  target the tray icon uses. A press only counts as a click when the window does
  not move past the system drag distance, so dragging still moves the pill.
- Tray: a **left click brings the OpenCode terminal forward** instead of showing
  the balloon. The host walks the parent chain of the process that wrote the
  presence file (and, when that chain died with the service, other processes of
  the same executable) to the terminal window, restoring it when minimized. The
  live state moved to `Show details` in the right click menu, and the balloon is
  still the fallback when no window can be found.
- Presence files already carried the writer pid; the host now keeps it in the
  aggregate, which is what makes the focus target findable.
- The idle states breathe on the WPF composition clock (a `DoubleAnimation` on
  the window opacity) instead of repainting from PowerShell on every `typeMs`
  tick: same 2.4s period, now smooth and with no per tick work in the host.
- Mode switches are faster: the plugin reacts to a request within 100ms (was
  500ms) and the tray frames are drawn on demand instead of all at startup —
  measured 408ms to bring the icon up, was ~1000ms, taking a full switch from
  ~2.4-3.1s to ~1.6s before the poll change.

## 0.2.0 — 2026-09-16

### Added

- **The tray icon is the letter `o` of the wordmark, built pixel by pixel**: a 6x7
  grid, a one-cell stroke, pixels appearing clockwise from the top left (about two
  every 250 ms), the finished letter holding for half a second before it starts
  over. The color follows the state — blue while working, amber on a retry, red on
  a failure, violet while a permission is pending — and the letter blinks when it
  is waiting on you.
- `mark` option to draw the same small `o` before the word on the pill. Off by
  default; the mark belongs to the tray icon.
- **Switch renderers without editing the config or restarting**: `/popup-window`,
  `/popup-tray`, `/popup-toggle` and `/popup-reset` commands, a `popup_mode` tool
  (`window | tray | toggle | reset`), and a right-click menu on both renderers
  (`Show in tray` / `Show as window`). `reset` forgets the choice and goes back to
  the `mode` of the config.
- The renderer choice is **shared between plugin instances** through `mode.json` in
  the state directory, read by every instance on each tick.
- The pill position is also saved **while it moves**, every 2 seconds, on top of the
  saves on drag end and close.
- **Tracing** with `OPENCODE_STATUS_POPUP_DEBUG=1`: what the plugin sees (events,
  phases, host starts) is appended to `%TEMP%\opencode-status-popup\plugin.log`.
- A root `index.ts`, because a plugin loaded from a directory is resolved through
  `index.ts` and not through the `exports` field of `package.json`; a checkout can
  now be pointed at directly in `plugins`.
- CI on GitHub Actions (Windows): typecheck, unit tests and the smoke test.

### Fixed

- The tray letter now reads as an `o` instead of a square: the corners are closed
  and the stroke is one cell thick (2 px at 125% DPI), taller than wide like the
  glyph in the wordmark.
- Two OpenCode instances with different configurations no longer fight over the
  host, each killing the renderer the other one started.
- A configured plugin directory loads (through the new root `index.ts`), and the
  freshly added mark stays off by default on the pill.

## 0.1.0 — 2026-09-15

First release.

### Added

- Always-on-top pill that types the word out while the agent works, and an
  alternative tray renderer.
- Five states with the priority `permission > error > retry > busy > idle`: amber
  while a provider request is being retried, red after a failed execution (kept for
  `errorHoldSeconds`), violet with a `?` when OpenCode is waiting for a permission.
- One presence file per location, aggregated by a single PowerShell host shared by
  every instance, with expiry of stale data and self-exit when nothing is running.
- Options: `enabled`, `mode`, `word`, `typeMs`, `position`, `freshSeconds`,
  `idleSeconds`, `errorHoldSeconds`, `shellPath`.
