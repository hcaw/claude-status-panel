import { expect, test } from 'claude-code/testing'

const RUN = {
  command: 'status-panel',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 200 },
} as const

test('/status-panel opens the pane, then closes it', async ($, on) => {
  const opened: string[] = []
  const closed: string[] = []
  let isUp = false
  on('ui.open', ($, e) => {
    opened.push(e.id)
    isUp = true
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    closed.push(e.id)
    isUp = false
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: isUp ? [{ id: 'status-panel', title: 'Status', isShown: true, isFocused: false, isPlaced: true }] : [],
  }))

  await $.command.run(RUN)
  expect(opened).toEqual(['status-panel'])
  expect(closed).toEqual([])

  await $.command.run(RUN)
  expect(closed).toEqual(['status-panel'])
})
