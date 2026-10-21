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
