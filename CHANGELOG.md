# Changelog

All notable changes to status-panel. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each release opens with a one-line summary, which the pane's Settings tab shows under the release date.

## [Unreleased]

## [0.9.0] - 2026-10-21

The release date and summary on the Settings tab now come from this changelog, and installing no longer downloads TypeScript.

### Added

- This changelog, with a dated entry for every release.
- A one-line summary of the installed release on the Settings tab.

### Changed

- The release date on the Settings tab is read from this changelog instead of being written into the code.
- Installing or updating the plugin no longer installs TypeScript (about 30 MB) into Claude Code's plugin cache.

## [0.8.0] - 2026-10-21

The Settings tab shows when the installed version was released.

### Added

- A Released row under Version in the About section of the Settings tab.

## [0.7.0] - 2026-10-21

The Settings tab shows the installed plugin version.

### Added

- An About section on the Settings tab with the plugin's version, read from its manifest.

### Fixed

- The footer icon stays in step when a hot reload keeps the pane open.

## [0.6.0] - 2026-10-21

The pane opens only in fullscreen, where it can dock beside the chat.

### Changed

- `/status-panel`, the footer button and a keybinding open the pane only in the fullscreen layout, and say why otherwise. Outside fullscreen the footer shows no button.
- The footer icon uses widely supported square glyphs.

### Fixed

- The footer icon stays in step when the footer button closes the pane.

## [0.5.0] - 2026-10-21

Choose how often the pane refreshes.

### Added

- A refresh frequency on the Settings tab, from 5 seconds to 5 minutes (10 seconds by default).

### Removed

- The hint lines at the foot of the pane.

## [0.4.0] - 2026-10-21

Overview and Settings tabs, and help for each section.

### Added

- Overview and Settings tabs.
- A `?` beside each section heading that opens its help above the prompt, on click or, as a setting, on hover.

## [0.3.0] - 2026-10-06

Context, tokens and limits drawn as text charts.

### Added

- A meter of the context window used and a sparkline of how it filled, reply by reply.
- A cache meter and a sparkline of tokens written per reply in the Tokens section.
- A meter for each rate limit with a tick for the time elapsed, coloured by its projected outlook, with when it resets or runs out.

## [0.2.0] - 2026-10-06

Works on Windows: everything is gathered through Claude Code, with no Python.

### Changed

- The branch, plan, email and token totals are read through Claude Code itself instead of a `python3` script, so the pane works on every OS with nothing else installed.

### Removed

- Line counts and status flags in the Workspace section, and the Env section, which needed `git` or Python.

## [0.1.0] - 2026-10-06

First release: session, workspace, account and usage details in a side pane toggled with `/status-panel`.

### Added

- Workspace, Session, Account, Context, Tokens and Limits sections, refreshed every 10 seconds and after each turn while the pane is open.
- A footer button and an optional keybinding to toggle the pane.

[unreleased]: https://github.com/hcaw/claude-status-panel/compare/status-panel--v0.9.0...HEAD
[0.9.0]: https://github.com/hcaw/claude-status-panel/compare/status-panel--v0.8.0...status-panel--v0.9.0
[0.8.0]: https://github.com/hcaw/claude-status-panel/compare/status-panel--v0.7.0...status-panel--v0.8.0
[0.7.0]: https://github.com/hcaw/claude-status-panel/compare/status-panel--v0.6.0...status-panel--v0.7.0
[0.6.0]: https://github.com/hcaw/claude-status-panel/compare/status-panel--v0.5.0...status-panel--v0.6.0
[0.5.0]: https://github.com/hcaw/claude-status-panel/compare/status-panel--v0.4.0...status-panel--v0.5.0
[0.4.0]: https://github.com/hcaw/claude-status-panel/compare/status-panel--v0.3.0...status-panel--v0.4.0
[0.3.0]: https://github.com/hcaw/claude-status-panel/compare/status-panel--v0.2.0...status-panel--v0.3.0
[0.2.0]: https://github.com/hcaw/claude-status-panel/compare/status-panel--v0.1.0...status-panel--v0.2.0
[0.1.0]: https://github.com/hcaw/claude-status-panel/releases/tag/status-panel--v0.1.0
