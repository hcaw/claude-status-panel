import { expect, test } from 'claude-code/testing'

test('the footer toggle keeps the modes and opens the pane when pressed', async ($, on) => {
  const opened: string[] = []
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: [] }))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'status-panel',
      surface,
      component: 'SessionMode',
      props: { modes: ['auto mode on'] },
      viewport: { columns: 200, rows: 50, isFullscreen: true },
    })
    expect(await ui.find({ type: 'Text', text: /auto mode on/ })).toBeDefined()
    await ui.press({ key: 'status-panel-toggle' })
    await ui.unmount()
  }
  expect(opened).toEqual(['status-panel', 'status-panel'])
})

test('outside fullscreen the footer keeps the modes and draws no toggle', async ($, on) => {
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))

  const ui = await $.ui.mount({
    plugin: 'status-panel',
    surface: 'terminal',
    component: 'SessionMode',
    props: { modes: ['auto mode on'] },
    viewport: { columns: 200, rows: 50, isFullscreen: false },
  })
  expect(await ui.find({ type: 'Text', text: /auto mode on/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'status-panel-toggle' })).toBeUndefined()
})

test('a reload with the pane open keeps the footer toggle filled', async ($, on) => {
  on('ui.panes', () => ({
    value: [{ id: 'status-panel', title: 'Status', isShown: true, isFocused: false, isPlaced: true }],
  }))
  on('command.register', () => ({ value: { command: 'status-panel' } }))
  on('clock.every', () => ({ value: undefined }))
  on('session.turns', () => ({ value: 0 }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))

  // A hot reload runs `session.start` again while the pane stays open.
  await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({
    plugin: 'status-panel',
    surface: 'terminal',
    component: 'SessionMode',
    props: { modes: [] },
    viewport: { columns: 200, rows: 50, isFullscreen: true },
  })
  const button = (await ui.find({ type: 'Button', key: 'status-panel-toggle' })) as { props?: { label?: string } }
  expect(button?.props?.label).toBe('■ status')
  await ui.unmount()
})
