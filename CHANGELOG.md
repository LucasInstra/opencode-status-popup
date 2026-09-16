# Changelog

Notable changes to this project, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- TUI entrypoint (`tui.ts`): `/popup-window`, `/popup-tray`, `/popup-toggle` and
  `/popup-reset` now show up in the `/` autocomplete and the command palette.
  The command leaves a request file next to the presence data, so the switch
  takes the same path the popup menu uses and every server instance applies it.
- `exports["./tui"]` so an npm install exposes the same entrypoint, plus a root
  `tui.ts` that re-exports it for plugin directories, where a loader resolves a
  `tui` file next to `index.ts` instead of the package exports.

### Changed

- Tray: a **left click brings the OpenCode terminal forward** instead of showing
  the balloon. The host walks the parent chain of the process that wrote the
  presence file (and, when that chain died with the service, other processes of
  the same executable) to the terminal window, restoring it when minimized. The
  live state moved to `Show details` in the right click menu, and the balloon is
  still the fallback when no window can be found.
- Presence files already carried the writer pid; the host now keeps it in the
  aggregate, which is what makes the focus target findable.
- The idle states repaint about every 300ms instead of every `typeMs` tick: the
  breathing period is unchanged, but the pill no longer redraws seven times a
  second while nothing happens.
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
