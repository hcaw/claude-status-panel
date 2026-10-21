# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`status-panel` is a Claude Code **mod**: a plugin of function hooks (not command hooks) that draws a toggleable side pane of session, workspace, account and usage details, so a status line can stay small. The repo is also its own plugin marketplace (`hcaw-status-panel`, via `.claude-plugin/marketplace.json` with `"source": "./"`), installed with `/plugin install status-panel --marketplace hcaw/claude-status-panel`.

The mod API is early access and changes between Claude Code releases. The authority is the engine's declaration file, not memory: load the `plugin-authoring` skill before changing hooks, then grep its `types/claude-code.d.ts` (or `.claude-plugin/types/claude-code/index.d.ts` once laid, see below) for the event or `$` method at hand.

## Commands

```
npm install                  # dev tooling only: pinned TypeScript; the mod has no runtime dependencies
npm run typecheck            # tsc -p .
npm test                     # claude plugin test .: runs every tests/*.test.ts(x); there is no per-test filter, so run one file by moving others aside or narrowing with describe/test names
npm run validate             # claude plugin validate .: manifest, marketplace file and hooks module, as the engine reads them
claude --plugin-dir .        # a session that loads this working copy and hot-reloads it on save
```

## Types

The `claude-code` module is not an npm package: the engine supplies it at run time, and it is the only bare import a hooks module may use. Its declarations are vendored in `types/claude-code.d.ts` (the pattern of Anthropic's built-in mods in `anthropics/claude-code/mods`), so a fresh clone type-checks with only `npm install`. `tsconfig.json` is self-contained, with the options from that file's header, and includes `types`, `hooks` and `tests`.

The engine also writes its own copy to `.claude-plugin/types/` (gitignored) whenever it loads the mod from this folder. `tsconfig.json` deliberately does not include that folder, so the two copies never clash. The vendored file's first line names the Claude Code version that wrote it. After a Claude Code update, refresh it by running `claude --plugin-dir .` once, then `cp .claude-plugin/types/claude-code/index.d.ts types/claude-code.d.ts`, then `npm run typecheck`. Never edit it by hand.

## Releasing a change

The installed plugin runs a cached copy from GitHub, not this folder. After editing: bump `version` in `.claude-plugin/plugin.json` and set `RELEASED` in `hooks/register.tsx` to the day's date (shown on the Settings tab), commit, push, then `claude plugin update status-panel@hcaw-status-panel` and `/reload-plugins` in a session.

## Architecture

All behaviour lives in `hooks/register.tsx` (named by `hooks/hooks.json`), with the text charts (a thin meter with an optional tick, a one-hue sparkline) as pure functions in `hooks/charts.ts`, which return runs of glyphs and theme colours that the pane draws as nested `Text`. The module runs in a sandbox with no Node and no DOM: everything external goes through `$`, and JSX compiles against the global `h` with elements taken from `$.ui.resolve(e)`.

- **Data flow:** a gather step (`refresh`) writes a `Snapshot` into `$.state`; render hooks only read state. Render hooks must never write state (the engine denies it), and module-level variables are lost on every hot reload, so anything a drawing reads goes in `$.state`.
- **State contract:** every `$.state` key is declared in `types/index.d.ts` under `PluginState['status-panel']`, and `plugin.json` names that file under `"types"`. `claude plugin validate` checks the module against it, so add a key there before using it.
- **Where the figures come from:** everything goes through `$`, with no `$.process.run` and no dependency on git, Python or anything else installed, so it behaves the same on every OS. Each piece is optional and a missing one renders as `–`.
  - `$.session.usage()` (context window, rate limits, cost, `startedAt`), `$.session.version()`, `$.session.model()`, and effort captured from `turn.step` (falling back to `effortLevel` / `modelSettings` in settings).
  - Branch: `branchOf` walks up from cwd with `$.fs` to the nearest `.git` (a folder, or a `gitdir:` file in a worktree or submodule) and reads `HEAD`; a detached HEAD shows its short commit. There is no engine API for a working-tree diff, so there are no line counts or status flags.
  - Plan and email: `oauthAccount` in Claude Code's `.claude.json`, under `CLAUDE_CONFIG_DIR` or the home folder (`USERPROFILE`, then `HOME`).
  - Token totals and history: the `tokens` and `history` keys, from each main-loop `turn.step` result's `usage` (history keeps each response's context size and output, capped at 240, for the sparklines) and reset by `session.end` with reason `clear`. `$.state` survives a hot reload but not a resume in a new process, so `session.start` seeds them once from the transcript `<projects>/*/<session_id>.jsonl`, skipped above `$.fs.read`'s 4 MiB limit. A field added to a stored shape is read as optional, since a hot reload keeps the old value.
  - Paths are joined with `/`; the engine hands hooks (and tests' stubs) the platform's own separators.
- **Refresh:** a `$.clock.every` timer (10 s) started in `session.start`, plus `turn.complete`, both skipped while the pane is closed. Every refresh call is wrapped in `.catch` so a failure never breaks a command or a turn.
- **Toggling:** one `toggle()` is shared by three entry points: the `/status-panel` command (`command.run`), the footer button, and an optional keybinding such as `"ctrl+x s": "command:status-panel"` that a user adds to `~/.claude/keybindings.json` (see the README). A `ui.close` hook keeps the `shown` flag in sync however the pane is closed (its close mark, `ctrl+x x`).
- **Footer button:** mods cannot draw into the status line itself. The button is drawn by hooking the `SessionMode` render site (the footer row beside the status line) and redrawing the engine's own content there, the mode labels dim and joined by `&`, followed by the button. Keep that content intact when changing this hook.
- **Panes opened unasked** only seat on wide terminals (144+ columns), so the pane is only ever opened in response to the user (command, button, keybinding), never from `session.start`.

- **Charts:** every glyph is one cell wide and every chart is sized from `bodyColumns`, so nothing wraps; colours are theme keys, never raw RGB, so light and dark themes both work. `Raster` (terminal only) and `Svg` (no terminal) are deliberately unused, so one drawing serves every surface. Colour carries meaning only: status keys on context and limit meters (a limit by its projected outlook), one hue per sparkline, and headers and figures in plain ink. The directory and branch keep their own colours (`ide`, `merged`) as identity, as Claude Code's own status line draws them.

## Tests

Tests use `claude-code/testing`. Nothing beneath the plugin answers engine events in a test, so each test stubs what the plugin calls (`ui.open` returning `{ value: { isPlaced: true } }`, `ui.panes`, `ui.close`). Calls that are not stubbed fail, which is why `refresh` is caught. UI tests mount a component and loop over `['terminal', 'desktop']` so the drawing is checked on more than one surface. `tests/panel.test.tsx` flattens a drawn pane into the lines a terminal would show and checks every chart fits at 28, 40 and 60 columns.

## Conventions

- British English in docs and comments, and no em dashes.
- Line endings are LF everywhere (`.gitattributes`, `.editorconfig`), whatever the host's `core.autocrlf`. CI (`.github/workflows/ci.yml`) type-checks, tests and validates on Linux, macOS and Windows, installing the Claude Code CLI from npm; it needs no sign-in. Keep tests free of platform-specific paths.
- The screenshot `docs/pane.png` is rendered (SVG, then rasterised at 2x so it shows anywhere) from the pane's own drawn tree (mount `Pane` in a test with sample data, then lay the tree out as the `lines()` helper in `tests/panel.test.tsx` does). Use example values only, never real paths or emails. Regenerate them when the pane's layout changes.
- The repo is public and MIT licensed: keep personal paths, emails and session data out of code, tests, docs and commit messages.
