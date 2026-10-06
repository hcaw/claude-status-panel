import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Snapshot } from '../types'

const PANE = 'status-panel'
const TITLE = 'Status'
const REFRESH_MS = 10_000

const snapshot = atom({ plugin: 'status-panel', key: 'snapshot' } as const, null)
const effort = atom({ plugin: 'status-panel', key: 'effort' } as const, null)
const shown = atom({ plugin: 'status-panel', key: 'shown' } as const, false)

type Collected = Pick<Snapshot, 'branch' | 'gitExtras' | 'env' | 'plan' | 'email' | 'tokens'>

async function isOpen($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some(pane => pane.id === PANE)
}

async function collect($: EngineInterface, cwd: string): Promise<Collected> {
  try {
    const { exitCode, stdout } = await $.process.run(
      ['python3', '-I', `${$.plugin.root}/bin/collect.py`],
      { stdin: JSON.stringify({ cwd, session_id: await $.session.id() }), timeoutMs: 10_000 },
    )
    return exitCode === 0 ? (JSON.parse(stdout) as Collected) : {}
  } catch {
    return {}
  }
}

async function refresh($: EngineInterface): Promise<void> {
  const cwd = await $.session.cwd()
  const [usage, version, model, collected] = await Promise.all([
    $.session.usage(),
    $.session.version(),
    $.session.model(),
    collect($, cwd),
  ])
  const limit = (kind: string) => {
    const found = usage.rateLimits.find(one => one.kind === kind)
    return found && { percent: found.percentUsed, resetsAt: found.resetsAt }
  }
  const next: Snapshot = {
    ...collected,
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

const home = (path: string) => path.replace(/^\/Users\/[^/]+/, '~')

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
    return started
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
    return yield* next(e)
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
          row(
            'Branch',
            <Text wrap="truncate">
              <Text bold color="merged">{snap.branch ?? 'no git'}</Text>
              {snap.gitExtras ? <Text color="success">{` ${snap.gitExtras}`}</Text> : null}
            </Text>,
          ),
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
          row('Input', <Text>{compact(snap.tokens?.input)}</Text>),
          row('Output', <Text>{compact(snap.tokens?.output)}</Text>),
          row('Cached', <Text>{compact(snap.tokens?.cached)}</Text>),
          row('Total', <Text bold>{compact(snap.tokens?.total)}</Text>),
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
        {section('Env', row('Runtime', <Text wrap="truncate">{snap.env ?? '–'}</Text>))}
        <Text dimColor>/status-panel to hide · refreshes every 10s</Text>
      </Box>
    )
  })
}
