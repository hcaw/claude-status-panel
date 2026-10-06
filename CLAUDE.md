# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`status-panel` is a Claude Code **mod**: a plugin of function hooks (not command hooks) that draws a toggleable side pane of session, workspace, account and usage details, so a status line can stay small. The repo is also its own plugin marketplace (`hcaw-status-panel`, via `.claude-plugin/marketplace.json` with `"source": "./"`), installed with `/plugin install status-panel --marketplace hcaw/claude-status-panel`.

The mod API is early access and changes between Claude Code releases. The authority is the engine's declaration file, not memory: load the `plugin-authoring` skill before changing hooks, then grep its `types/claude-code.d.ts` (or `.claude-plugin/types/claude-code/index.d.ts` once laid, see below) for the event or `$` method at hand.

## Commands

```
claude plugin validate .     # manifest, marketplace file and hooks module, as the engine reads them
claude plugin test .         # runs every tests/*.test.ts(x); there is no per-test filter, so run one file by moving others aside or narrowing with describe/test names
claude --plugin-dir .        # a session that loads this working copy and hot-reloads it on save
tsc -p .                     # type-check (see below)
```

`tsconfig.json` extends `.claude-plugin/types/tsconfig.json`, which is gitignored and only exists after the engine has loaded the mod from this folder (`claude --plugin-dir .` once). Until then, type-check with a tsconfig kept outside the repo using the options in the header of the skill's `claude-code.d.ts`, its `include` naming that file plus `hooks`, `types` and `tests`.

## Releasing a change

The installed plugin runs a cached copy from GitHub, not this folder. After editing: bump `version` in `.claude-plugin/plugin.json`, commit, push, then `claude plugin update status-panel@hcaw-status-panel` and `/reload-plugins` in a session.

## Architecture

All behaviour lives in `hooks/register.tsx` (named by `hooks/hooks.json`). The module runs in a sandbox with no Node and no DOM: everything external goes through `$`, and JSX compiles against the global `h` with elements taken from `$.ui.resolve(e)`.

- **Data flow:** a gather step (`refresh`) writes a `Snapshot` into `$.state`; render hooks only read state. Render hooks must never write state (the engine denies it), and module-level variables are lost on every hot reload, so anything a drawing reads goes in `$.state`.
- **State contract:** every `$.state` key is declared in `types/index.d.ts` under `PluginState['status-panel']`, and `plugin.json` names that file under `"types"`. `claude plugin validate` checks the module against it, so add a key there before using it.
- **Where the figures come from:**
  - From the engine via `$`: `$.session.usage()` (context window, rate limits, cost, `startedAt`), `$.session.version()`, `$.session.model()`, and effort captured from `turn.step` (falling back to `effortLevel` / `modelSettings` in settings).
  - From `bin/collect.py`, run via `$.process.run` with `{cwd, session_id}` on stdin and JSON on stdout: git branch, account plan and email from `~/.claude.json`, session token totals summed from the transcript `~/.claude/projects/*/<session_id>.jsonl`, git line counts and status flags, and the Env line (Node and Python versions detected from the project files in `cwd`). Output is plain text, since `Text` does not interpret ANSI escapes. Each piece is optional and missing ones render as `–`.
- **Refresh:** a `$.clock.every` timer (10 s) started in `session.start`, plus `turn.complete`, both skipped while the pane is closed. Every refresh call is wrapped in `.catch` so a failure never breaks a command or a turn.
- **Toggling:** one `toggle()` is shared by three entry points: the `/status-panel` command (`command.run`), the footer button, and an optional keybinding such as `"ctrl+x s": "command:status-panel"` that a user adds to `~/.claude/keybindings.json` (see the README). A `ui.close` hook keeps the `shown` flag in sync however the pane is closed (its close mark, `ctrl+x x`).
- **Footer button:** mods cannot draw into the status line itself. The button is drawn by hooking the `SessionMode` render site (the footer row beside the status line) and redrawing the engine's own content there, the mode labels dim and joined by `&`, followed by the button. Keep that content intact when changing this hook.
- **Panes opened unasked** only seat on wide terminals (144+ columns), so the pane is only ever opened in response to the user (command, button, keybinding), never from `session.start`.

## Tests

Tests use `claude-code/testing`. Nothing beneath the plugin answers engine events in a test, so each test stubs what the plugin calls (`ui.open` returning `{ value: { isPlaced: true } }`, `ui.panes`, `ui.close`). Calls that are not stubbed fail, which is why `refresh` is caught. UI tests mount a component and loop over `['terminal', 'desktop']` so the drawing is checked on more than one surface.

## Conventions

- British English in docs and comments, and no em dashes.
