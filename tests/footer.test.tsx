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
    })
    expect(await ui.find({ type: 'Text', text: /auto mode on/ })).toBeDefined()
    await ui.press({ key: 'status-panel-toggle' })
    await ui.unmount()
  }
  expect(opened).toEqual(['status-panel', 'status-panel'])
})
