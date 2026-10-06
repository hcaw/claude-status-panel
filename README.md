# status-panel

A Claude Code mod that shows session, workspace, account and usage details in a side pane you can toggle, so the status line itself can stay small.

The pane has these sections:

- **Workspace:** directory and git branch
- **Session:** Claude Code version, model, effort, time running, cost
- **Account:** plan and email
- **Context:** a meter of the context window used, tokens used and free, and a sparkline of how it filled, reply by reply
- **Tokens:** the session's input, output, cached and total tokens, a meter of how much input came from the cache, and a sparkline of tokens written per reply
- **Limits:** a meter for the 5-hour and 7-day windows with a tick where the time elapsed stands, so usage running ahead of the clock shows at a glance. Each is coloured by its outlook, with when it resets and a projection: on pace for a figure, or when it runs out first

The charts are thin lines and block characters in your theme's colours, so they need no fonts or images and fit the pane at any width.

It refreshes every 10 seconds and after each turn while open, and does no work while closed. Everything comes from Claude Code itself, so it runs no other programs and works the same on macOS, Linux and Windows.

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
