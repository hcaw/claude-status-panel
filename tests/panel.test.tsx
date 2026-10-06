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

const HOME = 'C:\\Users\\test'
const CWD = `${HOME}\\project`

// The engine hands hooks a path in the platform's own separators, whichever the mod
// joined it with.
const isPath = (path: string, expected: string) => path.replace(/\\/g, '/') === expected.replace(/\\/g, '/')

// A Windows session in a git repository, signed in to a Max plan: everything the
// panel gathers comes through `$`, with no process run. `files` adds files by path.
function stubEngine(on: On, files: Record<string, string> = {}) {
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
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [], cost: { usd: 0 } },
  }))
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
    if (isPath(e.path, `${CWD}/.git/HEAD`)) return { value: 'ref: refs/heads/feature/windows\n' }
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
    expect(await ui.find({ type: 'Text', text: /^~\\project$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^feature\/windows$/ })).toBeDefined()
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
  const transcript = `${HOME}/.claude/projects/C--Users-test-project/session-1.jsonl`
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
