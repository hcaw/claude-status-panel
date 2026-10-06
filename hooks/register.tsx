import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register } from 'claude-code'

import type { Snapshot, Tokens } from '../types'

const PANE = 'status-panel'
const TITLE = 'Status'
const REFRESH_MS = 10_000
// The largest file `$.fs.read` returns.
const READ_LIMIT = 4 * 1024 * 1024
const NO_TOKENS: Tokens = { input: 0, output: 0, cached: 0, total: 0 }

const snapshot = atom({ plugin: 'status-panel', key: 'snapshot' } as const, null)
const effort = atom({ plugin: 'status-panel', key: 'effort' } as const, null)
const shown = atom({ plugin: 'status-panel', key: 'shown' } as const, false)
const tokens = atom({ plugin: 'status-panel', key: 'tokens' } as const, null)

async function isOpen($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some(pane => pane.id === PANE)
}

// Paths are joined with `/`, which Windows accepts as well as `\`.
const join = (dir: string, name: string) => `${dir.replace(/[\\/]+$/, '')}/${name}`

const isAbsolute = (path: string) => /^(?:[A-Za-z]:)?[\\/]/.test(path)

// The folder above `dir`, keeping its trailing separator so a root stays a root
// (`/`, `C:\`); undefined once there is nothing above.
function parent(dir: string): string | undefined {
  const trimmed = dir.replace(/[\\/]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (cut < 0) return undefined
  const up = trimmed.slice(0, cut + 1)
  return up === dir ? undefined : up
}

// The checked-out branch, read from HEAD as git itself does, with no git process: the
// nearest `.git` above cwd is the repository's folder, or (in a worktree or submodule)
// a file naming it. A detached HEAD reads as its short commit.
async function branchOf($: EngineInterface, cwd: string): Promise<string | undefined> {
  for (let dir: string | undefined = cwd; dir; dir = parent(dir)) {
    const dotGit = join(dir, '.git')
    const found = await $.fs.stat(dotGit).catch(() => undefined)
    if (!found) continue
    let gitDir = dotGit
    if (found.kind === 'file') {
      const named = /^gitdir:\s*(.+?)\s*$/m.exec(await $.fs.read(dotGit))?.[1]
      if (!named) return undefined
      gitDir = isAbsolute(named) ? named : join(dir, named)
    }
    const head = (await $.fs.read(join(gitDir, 'HEAD'))).trim()
    const ref = /^ref:\s*(?:refs\/heads\/)?(.+)$/.exec(head)?.[1]
    return ref ?? head.slice(0, 7)
  }
  return undefined
}

// Where Claude Code keeps its files: CLAUDE_CONFIG_DIR when set, else the home folder
// (USERPROFILE on Windows, HOME elsewhere), with `.claude.json` beside `.claude`.
async function claudeFiles($: EngineInterface): Promise<{ account: string; projects: string } | undefined> {
  const configDir = await $.env.get('CLAUDE_CONFIG_DIR')
  if (configDir) return { account: join(configDir, '.claude.json'), projects: join(configDir, 'projects') }
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  return home ? { account: join(home, '.claude.json'), projects: join(home, '.claude/projects') } : undefined
}

// The signed-in account's plan and email, from Claude Code's own `.claude.json`.
async function accountOf($: EngineInterface): Promise<Pick<Snapshot, 'plan' | 'email'>> {
  const files = await claudeFiles($)
  if (!files) return {}
  const config = JSON.parse(await $.fs.read(files.account)) as {
    oauthAccount?: { organizationType?: string; emailAddress?: string }
  }
  const account = config.oauthAccount ?? {}
  // `claude_max` reads as "Claude Max".
  const org = (account.organizationType ?? '')
    .replace(/claude_/g, '')
    .replace(/_/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, first => first.toUpperCase())
  return { plan: org ? `Claude ${org}` : 'Claude', email: account.emailAddress || undefined }
}

const addUsage = (sum: Tokens, usage: ModelUsage): Tokens => {
  const input = sum.input + usage.input_tokens
  const output = sum.output + usage.output_tokens
  const cached = sum.cached + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
  return { input, output, cached, total: input + output + cached }
}

// The session's token totals so far, summed from its transcript with each response
// counted once: for a resumed session, whose earlier turns this process never saw.
// Undefined when the transcript is not found or is larger than `$.fs.read` returns.
async function transcriptTokens($: EngineInterface): Promise<Tokens | undefined> {
  const files = await claudeFiles($)
  if (!files) return undefined
  const name = `${await $.session.id()}.jsonl`
  // A project's folder is its path with every other character a dash; a very long
  // path is shortened, so look through every folder when that misses.
  const guess = join(join(files.projects, (await $.session.root()).replace(/[^A-Za-z0-9]/g, '-')), name)
  let path = (await $.fs.exists(guess)) ? guess : undefined
  if (!path) {
    const folders = (await $.fs.list(files.projects)).filter(entry => entry.kind === 'dir')
    const found = await Promise.all(
      folders.map(async folder => {
        const candidate = join(join(files.projects, folder.name), name)
        return (await $.fs.exists(candidate)) ? candidate : undefined
      }),
    )
    path = found.find(one => one !== undefined)
  }
  if (!path || (await $.fs.stat(path)).size > READ_LIMIT) return undefined

  type Row = { message?: { id?: string; usage?: Partial<Record<keyof ModelUsage, number | null>> } }
  const seen = new Set<string>()
  let sum = NO_TOKENS
  for (const line of (await $.fs.read(path)).split('\n')) {
    if (!line.includes('"usage"')) continue
    let row: Row
    try {
      row = JSON.parse(line) as Row
    } catch {
      continue
    }
    const usage = row.message?.usage
    if (!usage) continue
    const id = row.message?.id
    if (id) {
      if (seen.has(id)) continue
      seen.add(id)
    }
    sum = addUsage(sum, {
      input_tokens: usage.input_tokens ?? 0,
      output_tokens: usage.output_tokens ?? 0,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
    })
  }
  return sum
}

async function refresh($: EngineInterface): Promise<void> {
  const cwd = await $.session.cwd()
  const [usage, version, model, branch, account] = await Promise.all([
    $.session.usage(),
    $.session.version(),
    $.session.model(),
    branchOf($, cwd).catch(() => undefined),
    accountOf($).catch(() => ({})),
  ])
  const limit = (kind: string) => {
    const found = usage.rateLimits.find(one => one.kind === kind)
    return found && { percent: found.percentUsed, resetsAt: found.resetsAt }
  }
  const next: Snapshot = {
    ...account,
    branch,
    updatedAt: await $.clock.now(),
    cwd,
    version: version.version,
    model,
    startedAt: usage.startedAt,
    context: usage.context,
    fiveHour: limit('five_hour'),
    sevenDay: limit('seven_day'),
    costUsd: usage.cost?.usd,
  }
  await update($, snapshot, () => next)
}

async function toggle($: EngineInterface): Promise<void> {
  if (await isOpen($)) {
    await $.ui.close({ id: PANE })
    return
  }
  await $.ui.open({ id: PANE, title: TITLE })
  await update($, shown, () => true)
  await refresh($).catch(() => undefined)
}

async function configuredEffort($: EngineInterface, model?: string): Promise<string | undefined> {
  const settings = (await $.settings.read()) as {
    effortLevel?: string
    modelSettings?: Record<string, { effortLevel?: string }>
  }
  const perModel = model ? settings.modelSettings?.[model]?.effortLevel : undefined
  return perModel ?? settings.effortLevel
}

const compact = (n?: number) =>
  n === undefined
    ? '–'
    : n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1)}M`
      : n >= 1_000
        ? `${(n / 1_000).toFixed(1)}k`
        : String(n)

const duration = (ms: number) => {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

// The home folder as `~`: /Users/<name> (macOS), /home/<name> (Linux), C:\Users\<name> (Windows).
const home = (path: string) => path.replace(/^(?:\/(?:Users|home)\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)(?=$|[/\\])/, '~')

const levelColour = (percent?: number) =>
  percent === undefined ? 'inactive' : percent >= 90 ? 'error' : percent >= 70 ? 'warning' : 'success'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'status-panel',
      description: 'Toggle a pane showing everything from the status line',
    })
    $.clock.every(REFRESH_MS, () => {
      void isOpen($)
        .then(open => (open ? refresh($) : undefined))
        .catch(() => undefined)
    })
    // Token totals live in `$.state`, which a hot reload keeps; a session resumed in
    // a new process starts without them, so they begin from its transcript.
    if ((await read($, tokens)) === null) {
      const fresh = (await $.session.turns()) === 0
      void (fresh ? Promise.resolve(NO_TOKENS) : transcriptTokens($))
        .catch(() => undefined)
        .then(found => update($, tokens, now => now ?? found ?? NO_TOKENS))
        .catch(() => undefined)
    }
    return started
  })

  // A /clear starts the conversation, and its token totals, over.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await update($, tokens, () => NO_TOKENS)
    return next(e)
  })

  on('command.run', { command: 'status-panel' }, async $ => {
    await toggle($)
    return {}
  })

  // Every close (this plugin's, the pane's close mark, ctrl+x x) clears the footer toggle.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    const closed = await next(e)
    await update($, shown, () => false)
    return closed
  }).catch(($, e, next) => next(e))

  // The footer row beside the status line: the engine draws the session's modes
  // here dim, joined by ' & '. Draw them the same way and add a clickable toggle.
  on('ui.render', { component: 'SessionMode' }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const isShown = await read($, shown)
    const modes = e.props.modes.join(' & ')
    return (
      <Box flexDirection="row">
        {modes ? <Text dimColor>{`${modes} · `}</Text> : null}
        <Button
          key="status-panel-toggle"
          plain
          dimColor
          label={isShown ? '▣ status' : '▢ status'}
          onPress={() => void toggle($).catch(() => undefined)}
        />
      </Box>
    )
  })

  on('turn.step', async function* ($, e, next) {
    if (e.effort !== undefined && e.agentId === undefined) {
      const level = String(e.effort)
      await update($, effort, () => level)
    }
    const result = yield* next(e)
    // Each main-loop response's usage, the same figures its transcript row records.
    const usage = result.usage
    if (usage && e.agentId === undefined) await update($, tokens, now => addUsage(now ?? NO_TOKENS, usage))
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (await isOpen($)) await refresh($).catch(() => undefined)
    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const snap = await read($, snapshot)
    const live = await read($, effort)
    const used = await read($, tokens)

    if (!snap) return <Text dimColor>Gathering status…</Text>

    const width = e.props.bodyColumns
    const labelWidth = Math.min(12, Math.max(8, Math.floor(width / 4)))
    const thinking = live ?? (await configuredEffort($, snap.model)) ?? '–'

    const row = (label: string, value: JSX.Element) => (
      <Box flexDirection="row">
        <Box width={labelWidth}>
          <Text dimColor>{label}</Text>
        </Box>
        <Box flexGrow={1}>{value}</Box>
      </Box>
    )
    const section = (title: string, ...rows: JSX.Element[]) => (
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="warning">
          {title}
        </Text>
        {rows}
      </Box>
    )

    const ctx = snap.context
    const five = snap.fiveHour
    const seven = snap.sevenDay
    const fiveLeftMs = five?.resetsAt ? Date.parse(five.resetsAt) - snap.updatedAt : undefined
    const blockElapsed = fiveLeftMs === undefined ? undefined : 5 * 3_600_000 - fiveLeftMs

    return (
      <Box flexDirection="column">
        {section(
          'Workspace',
          row('Directory', <Text color="ide" wrap="truncate-start">{home(snap.cwd)}</Text>),
          row('Branch', <Text bold color="merged" wrap="truncate">{snap.branch ?? 'no git'}</Text>),
        )}
        {section(
          'Session',
          row('Claude Code', <Text bold>{snap.version ?? '–'}</Text>),
          row('Model', <Text>{snap.model ?? '–'}</Text>),
          row('Effort', <Text bold color="merged">{thinking}</Text>),
          row('Running', <Text>{snap.startedAt ? duration(snap.updatedAt - snap.startedAt) : '–'}</Text>),
          row('Cost', <Text>{snap.costUsd === undefined ? '–' : `$${snap.costUsd.toFixed(2)}`}</Text>),
        )}
        {section(
          'Account',
          row('Plan', <Text>{snap.plan ?? '–'}</Text>),
          row('Email', <Text wrap="truncate">{snap.email ?? '–'}</Text>),
        )}
        {section(
          'Context',
          row(
            'Used',
            <Text bold color={levelColour(ctx.percent)}>
              {ctx.percent === undefined ? '–' : `${ctx.percent}%`}
            </Text>,
          ),
          row('Tokens', <Text>{`${compact(ctx.tokens)} of ${compact(ctx.window)}`}</Text>),
        )}
        {section(
          'Tokens',
          row('Input', <Text>{compact(used?.input)}</Text>),
          row('Output', <Text>{compact(used?.output)}</Text>),
          row('Cached', <Text>{compact(used?.cached)}</Text>),
          row('Total', <Text bold>{compact(used?.total)}</Text>),
        )}
        {section(
          'Limits',
          row('5 hour', <Text bold color={levelColour(five?.percent)}>{five ? `${five.percent}%` : '–'}</Text>),
          row('7 day', <Text bold color={levelColour(seven?.percent)}>{seven ? `${seven.percent}%` : '–'}</Text>),
          row(
            'Block',
            <Text>
              {blockElapsed === undefined
                ? '–'
                : `${duration(blockElapsed)} of 5h (resets in ${duration(fiveLeftMs ?? 0)})`}
            </Text>,
          ),
        )}
        <Text dimColor>/status-panel to hide · refreshes every 10s</Text>
      </Box>
    )
  })
}
