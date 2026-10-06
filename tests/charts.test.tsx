import { expect, test } from 'claude-code/testing'

import { meter, spark, width, type Run } from '../hooks/charts'

const glyphs = (runs: Run[]) => runs.map(run => run.text).join('')

test('a meter is exactly as wide as asked, whatever it holds', () => {
  for (const cells of [4, 9, 30]) {
    for (const fraction of [-1, 0, 0.01, 0.5, 0.99, 1, 2]) {
      expect(width(meter(fraction, cells, 'success'))).toBe(cells)
      expect(width(meter(fraction, cells, 'success', fraction))).toBe(cells)
    }
  }
  expect(meter(0, 4, 'success')).toEqual([{ text: '━━━━', color: 'inactive', dim: true }])
  expect(meter(1, 4, 'success')).toEqual([{ text: '━━━━', color: 'success' }])
  // Fill and track are the same line in two colours; a half cell ends in `╸`.
  expect(meter(0.5, 10, 'success').map(run => [run.text, run.color])).toEqual([
    ['━━━━━', 'success'],
    ['━━━━━', 'inactive'],
  ])
  expect(glyphs(meter(0.55, 10, 'success'))).toBe('━━━━━╸━━━━')
})

test('a meter draws its pace tick over the fill or the track', () => {
  expect(glyphs(meter(0.25, 8, 'success', 0.5))).toBe('━━━━┃━━━')
  expect(meter(0.25, 8, 'success', 0.5).map(run => run.color)).toEqual(['success', 'inactive', 'text', 'inactive'])
  expect(meter(0.75, 8, 'success', 0.5).map(run => run.color)).toEqual(['success', 'text', 'success', 'inactive'])
  expect(glyphs(meter(0.5, 8, 'success', 1))).toBe('━━━━━━━┃')
})

test('a sparkline shows the latest values in one hue, the newest bright', () => {
  expect(glyphs(spark([0, 50, 100], 3, 'claude', 100))).toBe('▁▅█')
  expect(glyphs(spark([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4, 'claude'))).toBe('▆▇▇█')
  const runs = spark([1, 2, 3], 3, 'claude')
  expect(runs.map(run => [run.color, run.dim ?? false, run.bold ?? false])).toEqual([
    ['claude', true, false],
    ['claude', false, true],
  ])
  expect(width(spark([], 4, 'claude'))).toBe(0)
})
