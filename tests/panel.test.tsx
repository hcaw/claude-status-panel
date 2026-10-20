import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const RUN = {
  command: 'status-panel',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 200 },
} as const

const PANE_PROPS = {
  title: 'Status',
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const

const HOME = '/home/test'
const CWD = `${HOME}/project`

// The engine hands hooks (and these stubs) a path in the platform's own form: its own
// separators, and on Windows a drive in front of a rooted path. So compare the tail, with
// the separators made alike.
const slashed = (path: string) => path.replace(/\\/g, '/')
const isPath = (path: string, expected: string) => slashed(path).endsWith(slashed(expected))

const IDLE_USAGE = { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [], cost: { usd: 0 } }

// A session in a git repository, signed in to a Max plan: everything the
// panel gathers comes through `$`, with no process run. `files` adds files by path.
function stubEngine(on: On, files: Record<string, string> = {}, usage: object = IDLE_USAGE) {
  const file = (path: string) => Object.entries(files).find(([name]) => isPath(path, name))?.[1]
  let isUp = false
  on('ui.open', () => {
    isUp = true
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({
    value: isUp ? [{ id: 'status-panel', title: 'Status', isShown: true, isFocused: false, isPlaced: true }] : [],
  }))
  on('session.cwd', () => ({ value: CWD }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.version', () => ({ value: { version: '2.1.291', base: '2.1.291' } }))
  on('session.usage', () => ({ value: usage as typeof IDLE_USAGE }))
  on('clock.now', () => ({ value: 60_000 }))
  on('settings.read', () => ({ value: {} }))
  on('env.get', ($, e) => ({ value: e.name === 'USERPROFILE' ? HOME : undefined }))
  on('fs.exists', ($, e) => ({ value: file(e.path) !== undefined }))
  on('fs.stat', ($, e) => {
    if (isPath(e.path, `${CWD}/.git`)) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } }
    const text = file(e.path)
    return text === undefined
      ? { deny: 'ENOENT' }
      : { value: { kind: 'file', size: text.length, mtimeMs: 0, isLink: false } }
  })
  on('fs.read', ($, e) => {
    const text = file(e.path)
    if (text !== undefined) return { value: text }
    if (isPath(e.path, `${CWD}/.git/HEAD`)) return { value: 'ref: refs/heads/feature/panel\n' }
    if (isPath(e.path, `${HOME}/.claude.json`)) {
      return {
        value: JSON.stringify({ oauthAccount: { organizationType: 'claude_max', emailAddress: 'someone@example.com' } }),
      }
    }
    return { deny: 'ENOENT' }
  })
}

test('the pane reads branch and account through $, with no process', async ($, on) => {
  stubEngine(on)
  await $.command.run(RUN)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'status-panel',
      surface,
      component: 'Pane',
      requestId: 'status-panel',
      props: PANE_PROPS,
    })
    expect(await ui.find({ type: 'Text', text: /^~\/project$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^feature\/panel$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Claude Max$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^someone@example\.com$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('token totals add up the main loop responses, not a subagent', async ($, on) => {
  stubEngine(on)
  on('turn.step', async function* ($, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn',
      usage: {
        model: 'claude-opus-5-5',
        input_tokens: 100,
        output_tokens: 1_000,
        cache_read_input_tokens: 2_000,
        cache_creation_input_tokens: 500,
      },
    }
  })
  const step = async (index: number, agentId?: string) => {
    const stream = $.turn.step({ turnId: 't1', index, model: 'claude-opus-5-5', messageCount: 1, agentId })
    for await (const _ of stream) {
      // The bottom hook answers with no pieces.
    }
  }
  await step(0)
  await step(1)
  await step(2, 'subagent')
  await $.command.run(RUN)

  const ui = await $.ui.mount({
    plugin: 'status-panel',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'status-panel',
    props: PANE_PROPS,
  })
  // Two main-loop responses: 200 in, 2,000 out, 5,000 cached, 7,200 in all.
  expect(await ui.find({ type: 'Text', text: /^200$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^2\.0k$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^5\.0k$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^7\.2k$/ })).toBeDefined()
  await ui.unmount()
})

test('a resumed session starts its token totals from the transcript', async ($, on) => {
  const transcript = `${HOME}/.claude/projects/${CWD.replace(/[^A-Za-z0-9]/g, '-')}/session-1.jsonl`
  const row = (id: string, input: number, output: number) =>
    JSON.stringify({ message: { id, usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: 1_000 } } })
  // One response written as two rows (one per content block) counts once.
  stubEngine(on, {
    [transcript]: [row('a', 10, 20), row('a', 10, 20), '{"type":"user"}', row('b', 30, 40), ''].join('\n'),
  })
  on('command.register', () => ({ value: { command: 'status-panel' } }))
  on('clock.every', () => ({ value: undefined }))
  on('session.turns', () => ({ value: 3 }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.root', () => ({ value: CWD }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  await $.command.run(RUN)

  const ui = await $.ui.mount({
    plugin: 'status-panel',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'status-panel',
    props: PANE_PROPS,
  })
  // Two responses: 40 in, 60 out, 2,000 cached, 2,100 in all.
  expect(await ui.find({ type: 'Text', text: /^40$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^60$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^2\.0k$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^2\.1k$/ })).toBeDefined()
  await ui.unmount()
})

type Drawn = { type: string; props?: Record<string, unknown>; children?: unknown[] }

// The drawing as the lines a terminal would show, near enough to measure: a column
// Box stacks its children, a row Box sets them side by side, a Box's `width` pads it.
function lines(node: unknown): string[] {
  if (node === null || node === undefined || node === false) return []
  if (typeof node === 'string' || typeof node === 'number') return [String(node)]
  if (Array.isArray(node)) return node.flatMap(lines)
  const el = node as Drawn
  const kids = el.children ?? []
  if (el.type === 'Text') return [kids.flatMap(lines).join('')]
  if (el.type !== 'Box') return []
  let out: string[]
  if (el.props?.flexDirection === 'row') {
    const parts = kids.map(kid => {
      const width = (kid as Drawn)?.props?.width
      const drawn = lines(kid)
      return typeof width === 'number' ? (drawn.length ? drawn : ['']).map(line => line.padEnd(width)) : drawn
    })
    const height = Math.max(0, ...parts.map(part => part.length))
    out = Array.from({ length: height }, (_, i) => parts.map(part => part[i] ?? '').join(''))
  } else out = kids.flatMap(lines)
  const below = el.props?.marginBottom
  return typeof below === 'number' ? [...out, ...Array<string>(below).fill('')] : out
}

test('every chart fits the pane, from narrow to wide', async ($, on) => {
  const MINUTE = 60_000
  stubEngine(on, {}, {
    startedAt: 0,
    context: { tokens: 412_000, window: 1_000_000, percent: 41 },
    rateLimits: [
      // Two hours left of five: 60% of the window gone, 72% used, so ahead of the clock.
      { kind: 'five_hour', percentUsed: 72, resetsAt: new Date(60_000 + 120 * MINUTE).toISOString() },
      { kind: 'seven_day', percentUsed: 18.5, resetsAt: new Date(60_000 + 4 * 24 * 60 * MINUTE).toISOString() },
    ],
    cost: { usd: 4.2 },
  })
  on('turn.step', async function* ($, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn',
      usage: {
        model: 'claude-opus-5-5',
        input_tokens: 40 + e.index * 3,
        output_tokens: [120, 900, 300, 2_400, 60, 700][e.index % 6]!,
        cache_read_input_tokens: 20_000 + e.index * 9_000,
        cache_creation_input_tokens: 1_500,
      },
    }
  })
  for (let index = 0; index < 40; index++) {
    for await (const _ of $.turn.step({ turnId: 't1', index, model: 'claude-opus-5-5', messageCount: 1 })) {
      // The bottom hook answers with no pieces.
    }
  }
  await $.command.run(RUN)

  for (const bodyColumns of [28, 40, 60]) {
    const ui = await $.ui.mount({
      plugin: 'status-panel',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'status-panel',
      props: { ...PANE_PROPS, bodyColumns },
    })
    const drawn = lines(await ui.drawn())
    // Nothing runs past the edge, charts and packed lines alike; only a long path, branch,
    // model or email truncates, by design.
    for (const line of drawn.filter(one => !/^(Directory|Branch|Model|Email) /.test(one))) {
      expect(line.length).toBeLessThanOrEqual(bodyColumns)
    }
    expect(await ui.find({ type: 'Text', text: /^72%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /out in/ })).toBeDefined()
    await ui.unmount()
  }
})
