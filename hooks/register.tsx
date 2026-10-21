import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register } from 'claude-code'

import type { History, Snapshot, Tokens } from '../types'
import { dayOf, releaseOf } from './changelog'
import { meter, spark, width as cellsOf, type Run } from './charts'

const PANE = 'status-panel'
const TITLE = 'Status'
// The refresh timer ticks at the finest step of the choices and refreshes once the chosen
// period has passed, so a change of setting takes effect within a tick.
const TICK_MS = 5_000
// Seconds, shortest first: the bounds are the first and last, and a stored value outside
// them (or between) falls back to the nearest choice.
const REFRESH_CHOICES = [
  [5, '5s'],
  [10, '10s'],
  [30, '30s'],
  [60, '1m'],
  [300, '5m'],
] as const
const DEFAULT_REFRESH = 10
const refreshChoice = (stored: unknown): number => {
  const wanted = typeof stored === 'number' && Number.isFinite(stored) ? stored : DEFAULT_REFRESH
  return REFRESH_CHOICES.reduce((best, [secs]) => (Math.abs(secs - wanted) < Math.abs(best - wanted) ? secs : best), DEFAULT_REFRESH)
}
// The largest file `$.fs.read` returns.
const READ_LIMIT = 4 * 1024 * 1024
const NO_TOKENS: Tokens = { input: 0, output: 0, cached: 0, cacheRead: 0, total: 0 }
const NO_HISTORY: History = { context: [], output: [] }
// Responses kept for the sparklines: more than any pane is wide.
const HISTORY_CAP = 240
const HOUR = 3_600_000
const WINDOWS = { fiveHour: 5 * HOUR, sevenDay: 7 * 24 * HOUR }

const snapshot = atom({ plugin: 'status-panel', key: 'snapshot' } as const, null)
const effort = atom({ plugin: 'status-panel', key: 'effort' } as const, null)
const shown = atom({ plugin: 'status-panel', key: 'shown' } as const, false)
const tokens = atom({ plugin: 'status-panel', key: 'tokens' } as const, null)
const history = atom({ plugin: 'status-panel', key: 'history' } as const, null)
const tab = atom({ plugin: 'status-panel', key: 'tab' } as const, 'overview')
// The section whose help is pinned open in the band by a click, or null.
const helpTopic = atom({ plugin: 'status-panel', key: 'helpTopic' } as const, null)
// Whether hovering a `?` opens its help; it needs a terminal that reports the pointer.
const hoverHelp = atom({ plugin: 'status-panel', key: 'hoverHelp' } as const, false)
const refreshSecs = atom({ plugin: 'status-panel', key: 'refreshSecs' } as const, DEFAULT_REFRESH)
const TABS = [
  ['overview', 'Overview'],
  ['settings', 'Settings'],
] as const

const NOTES: Record<string, string[]> = {
  Context: ['Used is the share of the model window in use. Trend is the context size after each reply.'],
  Tokens: ['Cached is cache reads and writes. Cache hit is the share of input served from the cache.'],
  Limits: [
    '┃ is how much of the window has passed. A fill beyond it means you are using the limit faster than the clock.',
    'on pace for N% is where use lands at the reset at this rate. out in T means the limit comes first.',
  ],
}

// Hover scopes link a section's `?` in the pane to its note in the band above the prompt:
// the engine reveals one when the pointer is over the other, with no hook or state.
const scopeOf = (title: string) => `help-${title}`

// A click on a `?` pins its section's help; the same one again, or another's, closes or replaces it.
const pinHelp = ($: EngineInterface, title: string) =>
  update($, helpTopic, now => (now === title ? null : title))

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

// This plugin's own version, from the manifest it was loaded from, and when that version was
// released and what it changed, from the CHANGELOG.md beside it. A version with no dated entry
// (a working copy between releases) has neither.
async function aboutOf($: EngineInterface): Promise<Pick<Snapshot, 'pluginVersion' | 'released' | 'releaseNote'>> {
  const manifest = JSON.parse(await $.fs.read(join($.plugin.root, '.claude-plugin/plugin.json'))) as { version?: string }
  const pluginVersion = manifest.version || undefined
  if (!pluginVersion) return {}
  const changelog = await $.fs.read(join($.plugin.root, 'CHANGELOG.md')).catch(() => '')
  const release = releaseOf(changelog, pluginVersion)
  return { pluginVersion, released: release?.date, releaseNote: release?.summary }
}

const addUsage = (sum: Tokens, usage: ModelUsage): Tokens => {
  const input = sum.input + usage.input_tokens
  const output = sum.output + usage.output_tokens
  const cached = sum.cached + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
  // Totals kept before cache reads were counted apart stay without them: reads from
  // here on alone would understate the share against `cached`, which is the session's.
  const reads = sum.cacheRead === undefined ? {} : { cacheRead: sum.cacheRead + usage.cache_read_input_tokens }
  return { input, output, cached, ...reads, total: input + output + cached }
}

// One more response in the sparklines, the oldest dropped past the cap.
const addHistory = (now: History, usage: ModelUsage): History => ({
  context: [
    ...now.context,
    usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
  ].slice(-HISTORY_CAP),
  output: [...now.output, usage.output_tokens].slice(-HISTORY_CAP),
})

// The session's token totals and history so far, read from its transcript with each
// response counted once: for a resumed session, whose earlier turns this process never
// saw. Undefined when the transcript is not found or is larger than `$.fs.read` returns.
async function transcriptUsage($: EngineInterface): Promise<{ tokens: Tokens; history: History } | undefined> {
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
  let past = NO_HISTORY
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
    const one: ModelUsage = {
      input_tokens: usage.input_tokens ?? 0,
      output_tokens: usage.output_tokens ?? 0,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
    }
    sum = addUsage(sum, one)
    past = addHistory(past, one)
  }
  return { tokens: sum, history: past }
}

async function refresh($: EngineInterface): Promise<void> {
  const cwd = await $.session.cwd()
  const [usage, version, model, branch, account, about] = await Promise.all([
    $.session.usage(),
    $.session.version(),
    $.session.model(),
    branchOf($, cwd).catch(() => undefined),
    accountOf($).catch(() => ({})),
    aboutOf($).catch(() => ({})),
  ])
  const limit = (kind: string) => {
    const found = usage.rateLimits.find(one => one.kind === kind)
    return found && { percent: found.percentUsed, resetsAt: found.resetsAt }
  }
  const next: Snapshot = {
    ...account,
    ...about,
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

// The pane docks beside the transcript only in the fullscreen layout, so that is the only place
// it opens; a pane already open can always be closed.
async function toggle($: EngineInterface, isFullscreen: boolean | undefined): Promise<void> {
  if (await isOpen($)) {
    await $.ui.close({ id: PANE })
    // The `ui.close` hook clears this for the command and the close mark; a close from the
    // footer button does not reach it, so clear it here too.
    await update($, shown, () => false)
    return
  }
  if (isFullscreen !== true) {
    $.ui.toast('The status panel needs fullscreen mode')
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
      : n >= 100_000
        ? `${Math.round(n / 1_000)}k`
        : n >= 1_000
        ? `${(n / 1_000).toFixed(1)}k`
        : String(n)

const duration = (ms: number) => {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  const d = Math.floor(minutes / 1440)
  const h = Math.floor(minutes / 60) % 24
  const m = minutes % 60
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
}

// A part of a whole as a percentage, with a sliver shown as `<1%` rather than `0%`.
const share = (part: number, whole: number) => {
  if (whole <= 0) return '–'
  const p = (part / whole) * 100
  return p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`
}

// The home folder as `~`: /Users/<name> (macOS), /home/<name> (Linux), C:\Users\<name> (Windows).
const home = (path: string) => path.replace(/^(?:\/(?:Users|home)\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)(?=$|[/\\])/, '~')

const levelColour = (percent?: number) =>
  percent === undefined ? 'inactive' : percent >= 90 ? 'error' : percent >= 70 ? 'warning' : 'success'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // A hot reload runs this again with the pane still open, so take the flag from the
    // panes themselves: none is open in a new session, whatever a kept state says.
    const isUp = await isOpen($).catch(() => false)
    await update($, shown, () => isUp)
    await $.command.register({
      name: 'status-panel',
      description: 'Toggle a pane showing everything from the status line',
    })
    $.clock.every(TICK_MS, () => {
      void (async () => {
        if (!(await isOpen($))) return
        const last = (await read($, snapshot))?.updatedAt
        const period = refreshChoice(await read($, refreshSecs)) * 1000
        // A tick's worth of slack, so a 10 s period is not pushed to 15 s by timer jitter.
        if (last === undefined || (await $.clock.now()) - last >= period - TICK_MS / 2) await refresh($)
      })().catch(() => undefined)
    })
    // Token totals and history live in `$.state`, which a hot reload keeps; a session
    // resumed in a new process starts without them, so they begin from its transcript.
    if ((await read($, tokens)) === null || (await read($, history)) === null) {
      const fresh = (await $.session.turns()) === 0
      void (fresh ? Promise.resolve(undefined) : transcriptUsage($))
        .catch(() => undefined)
        .then(async found => {
          await update($, tokens, now => now ?? found?.tokens ?? NO_TOKENS)
          await update($, history, now => now ?? found?.history ?? NO_HISTORY)
        })
        .catch(() => undefined)
    }
    return started
  })

  // A /clear starts the conversation, and its token totals and history, over.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, tokens, () => NO_TOKENS)
      await update($, history, () => NO_HISTORY)
    }
    return next(e)
  })

  on('command.run', { command: 'status-panel' }, async ($, e) => {
    await toggle($, e.presentation.isFullscreen)
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
    // The pane only opens in the fullscreen layout, so only there is there a button.
    const fullscreen = e.viewport?.isFullscreen === true
    return (
      <Box flexDirection="row">
        {modes ? <Text dimColor>{fullscreen ? `${modes} · ` : modes}</Text> : null}
        {fullscreen ? (
          <Button
            key="status-panel-toggle"
            plain
            dimColor
            label={isShown ? '■ status' : '□ status'}
            onPress={() => void toggle($, true).catch(() => undefined)}
          />
        ) : null}
      </Box>
    )
  })

  // The band above the prompt shows the help pinned by a click, and holds the other notes
  // hidden for a hover to reveal when that setting is on. It passes while a survey has it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const pinned = await read($, helpTopic)
    const hovering = await read($, hoverHelp)
    const { Box, Text, Button } = $.ui.resolve(e)
    const card = (title: string, props: object, closable = false) => (
      <Box flexDirection="column" borderStyle="round" borderColor="inactive" paddingX={1} {...props}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold>{title}</Text>
          {closable ? (
            <Button
              key="status-panel-help-close"
              plain
              dimColor
              role="dismiss"
              label="×"
              onPress={() => void update($, helpTopic, () => null).catch(() => undefined)}
            />
          ) : null}
        </Box>
        {(NOTES[title] ?? []).map(note => (
          <Text dimColor wrap="wrap">
            {note}
          </Text>
        ))}
      </Box>
    )
    const hidden = hovering ? Object.keys(NOTES).filter(title => title !== pinned) : []
    if (!pinned && !hidden.length) return next(e)
    return (
      <Box flexDirection="column">
        {pinned ? card(pinned, {}, true) : null}
        {hidden.map(title => card(title, { display: 'none', hover: { scope: scopeOf(title), display: 'flex' } }))}
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
    if (usage && e.agentId === undefined) {
      await update($, tokens, now => addUsage(now ?? NO_TOKENS, usage))
      await update($, history, now => addHistory(now ?? NO_HISTORY, usage))
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (await isOpen($)) await refresh($).catch(() => undefined)
    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const snap = await read($, snapshot)
    const live = await read($, effort)
    const used = await read($, tokens)
    const past = await read($, history)
    const chosen = await read($, tab)
    const current = TABS.find(([key]) => key === chosen)?.[0] ?? 'overview'
    const hovering = await read($, hoverHelp)
    const every = refreshChoice(await read($, refreshSecs))

    if (!snap) return <Text dimColor>Gathering status…</Text>

    const width = e.props.bodyColumns
    // Labels are at most nine characters, so ten keeps a gap after the longest.
    const labelWidth = Math.min(12, Math.max(10, Math.floor(width / 4)))
    const thinking = live ?? (await configuredEffort($, snap.model)) ?? '–'
    // The cells a chart has beside its label, leaving `room` for a figure after it.
    const cells = (room = 0) => Math.max(4, Math.min(48, width - labelWidth - room))
    // Parts joined by ` · ` while they fit in `room` cells, a new line for each that does not.
    const pack = (parts: Run[][], room: number) => {
      const out: Run[][] = []
      for (const part of parts.filter(one => one.length)) {
        const last = out[out.length - 1]
        if (last && cellsOf(last) + 3 + cellsOf(part) <= room) last.push({ text: ' · ', dim: true }, ...part)
        else out.push([...part])
      }
      return out
    }
    const fitted = (label: string, parts: Run[][]) =>
      pack(parts, width - labelWidth).map((runs, i) => row(i === 0 ? label : '', line(runs)))

    const line = (runs: Run[]) => (
      <Text wrap="truncate">
        {runs.map(run => (
          <Text color={run.color} dimColor={run.dim} bold={run.bold}>
            {run.text}
          </Text>
        ))}
      </Text>
    )
    const row = (label: string | JSX.Element, value: JSX.Element) => (
      <Box flexDirection="row">
        <Box width={labelWidth} flexShrink={0}>
          {typeof label === 'string' ? <Text dimColor>{label}</Text> : label}
        </Box>
        <Box flexGrow={1}>{value}</Box>
      </Box>
    )
    // A chart and the figure after it, kept on one line.
    const charted = (chart: Run[], figure: JSX.Element) => (
      <Box flexDirection="row">
        {line(chart)}
        <Text> </Text>
        {figure}
      </Box>
    )
    // A title, then a dim rule to the pane's edge. Plain ink: colour is kept for the
    // charts, where it means something.
    // A title and a dim rule to the edge; where the section has help, a `?` ends the rule
    // and reveals that help in the band above the prompt while hovered.
    const heading = (title: string) => {
      const note = NOTES[title]
      const rule = (reserve: number) =>
        line([
          { text: title, bold: true },
          { text: ` ${'─'.repeat(Math.max(0, width - title.length - 1 - reserve))}`, color: 'inactive', dim: true },
        ])
      if (!note) return rule(0)
      return (
        <Box flexDirection="row">
          <Box flexGrow={1}>{rule(2)}</Box>
          <Text> </Text>
          <Box hover={hovering ? { scope: scopeOf(title) } : undefined}>
            <Button
              key={`help-${title}`}
              plain
              dimColor
              label="?"
              onPress={() => void pinHelp($, title).catch(() => undefined)}
            />
          </Box>
        </Box>
      )
    }
    const section = (title: string, ...rows: JSX.Element[]) => (
      <Box flexDirection="column" marginBottom={1}>
        {heading(title)}
        {rows}
      </Box>
    )
    // Figures in text ink; the chart beside one carries its status colour.
    const percent = (value?: number) =>
      value === undefined ? <Text dimColor>–</Text> : <Text bold>{`${Math.round(value)}%`}</Text>
    // A figure right-aligned in a column, so a list of them reads down by magnitude.
    const figure = (text: string, bold = false) => (
      <Box width={7} flexShrink={0} justifyContent="flex-end">
        <Text bold={bold}>{text}</Text>
      </Box>
    )
    // A sparkline beside its caption: the scale or span it is read against.
    const sparkline = (values: readonly number[], color: string, caption: (shown: number) => string, max?: number) => {
      const room = 9
      const chart = spark(values, cells(room), color, max)
      return charted(chart, <Text dimColor>{caption(cellsOf(chart))}</Text>)
    }

    // Context: how full the window is, and how it filled response by response.
    const ctx = snap.context
    const ctxPercent = ctx.percent ?? (ctx.tokens !== undefined && ctx.window ? (ctx.tokens / ctx.window) * 100 : undefined)
    const ctxTrend = past && past.context.length > 1 ? past.context : undefined

    // Tokens: a table of the session's totals; cache dwarfs the rest, so a part-to-whole
    // bar would be one colour. The cache's share of input is the ratio worth a meter.
    const hits = used?.cacheRead !== undefined && used.input + used.cached > 0 ? used.cacheRead / (used.input + used.cached) : undefined

    // Limits: usage against the time gone in each window. The tick on the bar is where
    // usage would stand if it went evenly; a fill past the tick is ahead of the clock.
    const limit = (label: string, window: number, found?: { percent: number; resetsAt?: string }) => {
      if (!found) return [row(label, <Text dimColor>–</Text>)]
      const left = found.resetsAt ? Date.parse(found.resetsAt) - snap.updatedAt : undefined
      const gone = left === undefined || Number.isNaN(left) ? undefined : Math.min(1, Math.max(0, 1 - left / window))
      const p = found.percent
      // The bar's colour is the window's outlook, not its usage alone: 72% with most of
      // the window to go is worse than 72% near its reset.
      let status = levelColour(p)
      let pace: Run | undefined
      if (p >= 100) pace = { text: 'limit reached', color: 'error', bold: true }
      else if (gone !== undefined && gone >= 0.05 && p > 0 && left !== undefined) {
        const projected = p / gone
        // At this rate, the time until 100%, when that comes before the reset.
        const out = ((window * gone) / p) * (100 - p)
        status = out < left ? 'error' : levelColour(Math.max(p, projected))
        pace =
          out < left
            ? { text: `out in ${duration(out)}`, color: 'error', bold: true }
            : { text: `on pace for ${Math.round(projected)}%`, color: status }
      }
      const when: Run[] = left === undefined || Number.isNaN(left) ? [] : [{ text: `resets in ${duration(left)}`, dim: true }]
      return [
        row(label, charted(meter(p / 100, cells(5), status, gone), percent(p))),
        ...fitted('', [when, pace ? [pace] : []]),
      ]
    }

    // The engine's close mark has a row of its own above the body that a mod cannot draw into
    // (a tab row lifted onto it is clipped), so the tabs are the body's first row.
    const tabs = (
      <Box flexDirection="column" marginBottom={1}>
        <Box flexDirection="row" gap={2}>
          {TABS.map(([key, label]) =>
            key === current ? (
              <Text bold underline>
                {label}
              </Text>
            ) : (
              <Button
                key={`tab-${key}`}
                plain
                dimColor
                label={label}
                onPress={() => void update($, tab, () => key).catch(() => undefined)}
              />
            ),
          )}
        </Box>
        {line([{ text: '─'.repeat(width), color: 'inactive', dim: true }])}
      </Box>
    )

    if (current === 'settings') {
      return (
        <Box flexDirection="column">
          {tabs}
          {section(
            'Refresh',
            // Presets rather than a free field: the bounds hold by construction.
            row(
              'Every',
              <Box flexDirection="row" gap={1}>
                {REFRESH_CHOICES.map(([secs, label]) =>
                  secs === every ? (
                    <Text bold>{`[${label}]`}</Text>
                  ) : (
                    <Button
                      key={`refresh-${secs}`}
                      plain
                      dimColor
                      label={label}
                      onPress={() => void update($, refreshSecs, () => secs).catch(() => undefined)}
                    />
                  ),
                )}
              </Box>,
            ),
            row('', <Text dimColor wrap="wrap">Between 5 seconds and 5 minutes. The pane also refreshes after each turn.</Text>),
          )}
          {section(
            'Help',
            row(
              '',
              <Button
                key="setting-hover-help"
                plain
                label={`${hovering ? '[x]' : '[ ]'} Open help on hover`}
                onPress={() => void update($, hoverHelp, now => !now).catch(() => undefined)}
              />,
            ),
            ...pack(
              [[{ text: 'Needs a terminal that reports pointer movement. If hovering a ? does nothing, leave this off and click it instead.', dim: true }]],
              width - labelWidth,
            ).map(runs => row('', <Text dimColor wrap="wrap">{runs.map(run => run.text).join('')}</Text>)),
          )}
          {section(
            'About',
            row('Version', <Text bold>{snap.pluginVersion ?? '–'}</Text>),
            row('Released', <Text>{(snap.released && dayOf(snap.released)) ?? '–'}</Text>),
            ...(snap.releaseNote ? [row('', <Text dimColor wrap="wrap">{snap.releaseNote}</Text>)] : []),
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {tabs}
        {section(
          'Workspace',
          row('Directory', <Text color="ide" wrap="truncate-start">{home(snap.cwd)}</Text>),
          row('Branch', <Text bold color="merged" wrap="truncate">{snap.branch ?? 'no git'}</Text>),
        )}
        {section(
          'Session',
          row('Version', <Text bold>{snap.version ?? '–'}</Text>),
          row('Model', <Text>{snap.model ?? '–'}</Text>),
          row('Effort', <Text bold>{thinking}</Text>),
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
            ctxPercent === undefined
              ? <Text dimColor>–</Text>
              : charted(meter(ctxPercent / 100, cells(5), levelColour(ctxPercent)), percent(ctxPercent)),
          ),
          ...fitted('Tokens', [
            [{ text: `${compact(ctx.tokens)} of ${compact(ctx.window)}` }],
            ctx.tokens === undefined ? [] : [{ text: `${compact(Math.max(0, ctx.window - ctx.tokens))} free`, dim: true }],
          ]),
          // Its own peak at the top, so the shape shows: growth, and the drop of a compaction.
          ...(ctxTrend ? [row('Trend', sparkline(ctxTrend, 'ide', shown => `last ${shown}`))] : []),
        )}
        {section(
          'Tokens',
          row('Input', figure(compact(used?.input))),
          row('Output', figure(compact(used?.output))),
          row('Cached', figure(compact(used?.cached))),
          row('Total', figure(compact(used?.total), true)),
          // The share of input read from the cache rather than sent afresh or written to it.
          ...(hits === undefined
            ? []
            : [row('Cache hit', charted(meter(hits, cells(5), 'planMode'), <Text bold>{share(hits, 1)}</Text>))]),
          // Tokens written per reply, against the largest shown.
          ...(past && past.output.length > 1
            ? [row('Replies', sparkline(past.output, 'claude', shown => `max ${compact(Math.max(...past.output.slice(-shown)))}`))]
            : []),
        )}
        {section(
          'Limits',
          ...limit('5 hour', WINDOWS.fiveHour, snap.fiveHour),
          ...limit('7 day', WINDOWS.sevenDay, snap.sevenDay),
        )}
      </Box>
    )
  })
}
