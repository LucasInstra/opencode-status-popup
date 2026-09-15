# opencode status popup

An OpenCode V2 plugin that shows what the agent is doing on a second surface, outside the terminal.

While a session is thinking, a small always-on-top pill **types "opencode" letter by letter, on a loop** (`o` → `op` → `ope` → … → `opencode`), highlighting the newest letter. The same surface doubles as an attention light: it turns **amber** while a provider request is being retried, **red** when an execution failed, and **violet with a `?`** when OpenCode is waiting for you to allow something.

![the pill typing opencode](https://raw.githubusercontent.com/LucasInstra/opencode-status-popup/main/docs/typing.gif)

## States

| State | Window | Tray | Meaning |
|---|---|---|---|
| `idle` | `opencode`, white, slow breathing | mark, slow blink | nothing is running |
| `busy` | `opencode` typing itself, blue | mark with a bright wedge sweeping around it, blue | the agent is working |
| `retry` | `opencode` typing itself, amber | same sweep, amber | a provider request failed and another attempt is scheduled |
| `error` | `opencode!`, red, breathing | mark, red, blink | an execution failed (kept for `errorHoldSeconds`, or until the session works again) |
| `permission` | `opencode?`, violet, faster breathing | mark, violet, fast blink | OpenCode is blocked waiting for a permission decision from you |

Priority is `permission` > `error` > `retry` > `busy` > `idle`, so a session waiting for permission is never hidden behind work happening in another session. The tray tooltip and the tray balloon carry the detail (`needs you: bash git push origin main`, `error: 429 provider.rate-limit`), which is also where several projects are listed.

![the five states](https://raw.githubusercontent.com/LucasInstra/opencode-status-popup/main/docs/states.png)

Tray icons for the same states, the bright wedge sweeping around the mark while the agent works and the mark blinking while it waits for you, at 8x and at real size:

![tray icons in every state](https://raw.githubusercontent.com/LucasInstra/opencode-status-popup/main/docs/tray.png)

Two renderers, chosen with the `mode` option:

| | `window` (default) | `tray` |
|---|---|---|
| What you see | frameless translucent pill, top of the z-order | system tray icon with the OpenCode mark |
| Animation | the word types itself out | the mark with a bright wedge sweeping around it while it works, blinking while it waits |
| Cost | ~45–60 MB (PowerShell + WPF) | ~30–40 MB (PowerShell + WinForms) |
| Intrusiveness | floats above other windows, but no border, no taskbar button, does not steal focus | nothing covers the screen |
| Legibility of the word | fully readable | not readable at 16 px, hence the bar |

Both are a single detached PowerShell process that is started on demand, shared by every OpenCode instance, and exits by itself a few seconds after the last instance goes away.

## Install

Requires **OpenCode V2** and **Windows** (the host uses WPF/WinForms through PowerShell; `pwsh.exe` or `powershell.exe` from the machine).

### Local development copy

Any `.opencode/plugins/` directory in the location is discovered automatically, so a junction is enough:

```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.opencode\plugins" | Out-Null
New-Item -ItemType Junction -Path "$env:USERPROFILE\.opencode\plugins\opencode-status-popup" `
  -Target "C:\path\to\opencode-status-popup"
```

### Config entry

Point `plugins` at the package or at the entry file in `opencode.json(c)`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["C:/path/to/opencode-status-popup"]
}
```

### Package

Once published, `opencode plugin add opencode-status-popup`.

## Options

All options are optional. Defaults shown.

| Option | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Turn the plugin off without uninstalling it. |
| `mode` | `"window" \| "tray"` | `"window"` | Which renderer to use. |
| `word` | `string` | `"opencode"` | Word that types itself out. Max 24 characters. |
| `typeMs` | `number` | `140` | Milliseconds per typed character (40–2000). |
| `position` | `"bottom-right" \| "bottom-left" \| "top-right" \| "top-left"` | `"bottom-right"` | Where the pill appears the first time. After you drag it, the position is remembered. |
| `freshSeconds` | `number` | `20` | How long presence data counts as fresh. |
| `idleSeconds` | `number` | `25` | How long the host waits without any live instance before exiting. |
| `errorHoldSeconds` | `number` | `90` | How long a failed execution keeps the pill red. Use `0` to keep it until the session works again. |
| `shellPath` | `string` | `null` | Force a specific PowerShell executable. |

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "opencode-status-popup",
      "options": {
        "mode": "tray",
        "typeMs": 110,
        "position": "top-right"
      }
    }
  ]
}
```

## Interaction

- **Drag** the pill with the left mouse button. The position is stored in `%TEMP%\opencode-status-popup\window.json`.
- **Right click** for `Reset position` and `Close`.
- In `tray` mode, **left click** shows a balloon with the current state and **right click** opens `Close`.
- The window never appears in the taskbar or the Alt+Tab list, and it does not activate itself when it appears.

## How it works

```
OpenCode server
  └── plugin instance (one per location)
        ├── subscribes to the server event stream
        ├── tracks busy sessions      → session.status, session.execution.*, ...
        └── writes %TEMP%\opencode-status-popup\state\<project>.json every 3 s
                                              │
                        one PowerShell host ──┘  reads every presence file,
                        (named mutex per state dir) aggregates them and paints
```

- **Busy detection** uses the public event stream: `session.status` (`busy`/`retry`/`idle`), `session.execution.started/succeeded/failed/interrupted`, `session.idle`, streaming deltas and tool activity. Permission prompts come from `permission.asked` / `permission.replied`. Every event is matched against the plugin's own location, so a busy session in another project does not light up your pill.
- **Multiple instances** (several OpenCode windows, several projects on one server) each write their own presence file. The host shows the union and the tray tooltip lists the project names.
- **Crash safety**: presence files expire after `freshSeconds`, a session that sends no event for 45 minutes is dropped, and the host exits by itself when nothing is fresh. The plugin also restarts the host if it died or if the options changed.
- **Tray overflow**: Windows puts new tray icons in the hidden overflow area by default. Drag it onto the taskbar to keep it visible.

## Development

```sh
npm install
npm run typecheck
npm test                        # unit tests for config and event tracking
$env:SMOKE=1; npm run smoke     # loads the plugin, drives it with events, spawns a real host
npm run preview                 # spawns the window host with a fake presence file
npm run preview:tray
npm run preview:stop
```

`npm run preview` is the fastest way to iterate on the visuals: it writes the same presence files the plugin writes, so the host cannot tell the difference. Useful flags: `--mode window|tray`, `--state busy|idle|retry|error|permission`, `--detail '<text>'`, `--watch` (cycles the states), `--word`, `--type`, `--seconds`.

`pwsh -File scripts/dev-host.ps1 -Mode window` runs the host in the foreground and writes everything it prints to `%TEMP%\opencode-status-popup\test-window.out`, which is the quickest way to read a script error.

`npm run docs:images` re-renders `docs/*.png` from the real XAML (off screen, so no screen capture and no desktop in the images) and dumps the raw frames; `npm run docs:gif` turns those frames into `docs/typing.gif`.

The host logs to `%TEMP%\opencode-status-popup\host.log`, which is the first place to look when the popup does not show up:

- `start mode=... pid=...` — the host started.
- `another host is already running, exiting` — the single instance guard did its job.
- `took over an abandoned host` — the previous host was killed hard; the new one recovered the slot.

## Notes and limitations

- Windows only. On other platforms the plugin loads and does nothing.
- The host is a separate process, so the popup outlives a `kill` of the OpenCode server for at most `idleSeconds`.
- `mode: "window"` uses WPF through PowerShell. If a machine blocks PowerShell or WPF, use `shellPath` to point at a working interpreter, or switch to `mode: "tray"`.
