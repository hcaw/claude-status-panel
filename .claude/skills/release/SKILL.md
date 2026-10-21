---
name: release
description: Release status-panel - write the changelog entry, bump the version, tag, push, publish the GitHub release and update the local install. Use when asked to release, ship, cut or publish a version.
---

# Releasing status-panel

`scripts/release.mjs` does the whole release; this is how to drive it.

1. List what is unreleased: `git log --oneline status-panel--v$(node -p "require('./.claude-plugin/plugin.json').version")..HEAD`.
2. Make `## [Unreleased]` in `CHANGELOG.md` cover every user-facing change in that list: a one-line summary first (the Settings tab shows it), then `### Added`, `### Changed`, `### Fixed` or `### Removed` bullets. British English, no em dashes, written for someone using the pane, not for a developer. Leave the edit uncommitted: the release commit picks it up.
3. `npm run release -- --dry-run`, adding `patch`, `minor`, `major` or `X.Y.Z` only if the user named one. Check the version and notes it prints.
4. `npm run release` with the same arguments. Run it in the background (`run_in_background`), since it waits for CI on three operating systems and can take longer than a foreground command may run. It runs every check, commits `release: X.Y.Z`, tags `status-panel--vX.Y.Z`, pushes both, creates the GitHub release, updates the installed plugin and waits for CI.
5. If it stops before "Pushing", fix the cause and run it again. If it stops after the push, or the run is cut off, fix the cause and run `npm run release -- --finish`. Never move or delete a pushed tag: fix forward with a patch release.
6. Report the release URL, the installed version, and that open sessions need `/reload-plugins`.
