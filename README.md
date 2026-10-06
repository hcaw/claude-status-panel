# status-panel

A Claude Code mod that shows session, workspace, account and usage details in a side pane you can toggle, so the status line itself can stay small.

The pane has these sections:

- **Workspace:** directory, git branch, line counts and status flags (`+` staged, `*` unstaged, `?` untracked, `!` conflict)
- **Session:** Claude Code version, model, effort, time running, cost
- **Account:** plan and email
- **Context:** context window used, as a percentage and in tokens
- **Tokens:** input, output, cached and total for the session
- **Limits:** 5-hour and 7-day usage, and progress through the 5-hour block
- **Env:** Node and Python versions (with any virtual env) for the kind of project in the directory

It refreshes every 10 seconds and after each turn while open, and does no work while closed.

## Install

In a Claude Code terminal session:

```
/plugin install status-panel --marketplace hcaw/claude-status-panel
```

Answer `y` to add the marketplace, then pick the user scope.

## Use

- `/status-panel` toggles the pane.
- The footer row under the prompt shows a `▢ status` / `▣ status` toggle you can click.
- For a keyboard shortcut, add a command binding to `~/.claude/keybindings.json`:

  ```json
  {
    "context": "Chat",
    "bindings": {
      "ctrl+x s": "command:status-panel"
    }
  }
  ```

## Develop

You need [Claude Code](https://code.claude.com) and Node.js. TypeScript is a dev dependency, so nothing else is installed globally.

```
npm install          # TypeScript, for type-checking only
npm run typecheck    # tsc -p . against the vendored types in types/claude-code.d.ts
npm test             # claude plugin test .
npm run validate     # claude plugin validate .
claude --plugin-dir .
```

The mod itself has no runtime dependencies: Claude Code loads `hooks/register.tsx` directly, with no build step.
