import { expect, test } from 'claude-code/testing'

import { EFFORTS, HUE_COUNT, PALETTE, effortColour, hue, slotOf, toneOf } from '../hooks/colours'

const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1']
// Steps between two slots, the short way round the wheel.
const gap = (a: number, b: number) => Math.min(Math.abs(a - b), HUE_COUNT - Math.abs(a - b))

test('each tone has a wheel of distinct colours', () => {
  for (const tone of ['dark', 'light'] as const) {
    expect(PALETTE[tone]).toHaveLength(HUE_COUNT)
    expect(new Set(PALETTE[tone]).size).toBe(HUE_COUNT)
    for (const colour of PALETTE[tone]) expect(colour).toMatch(/^#[0-9a-f]{6}$/)
  }
})

test('a value takes the same slot every time, in either tone', () => {
  // Pinned, so a change to the hash or the salt (which recolours every value) is deliberate.
  expect(MODELS.map(slotOf)).toEqual([14, 2, 39, 27])
  expect(slotOf('2.1.291')).toBe(3)
  for (const value of [...MODELS, 'someone@example.com']) {
    expect(hue(value, 'dark')).toBe(PALETTE.dark[slotOf(value)])
    expect(hue(value, 'light')).toBe(PALETTE.light[slotOf(value)])
  }
})

test('the current models sit well apart on the wheel, and so do releases in a row', () => {
  const slots = MODELS.map(slotOf)
  for (const [i, a] of slots.entries()) for (const b of slots.slice(i + 1)) expect(gap(a, b)).toBeGreaterThanOrEqual(10)
  expect(gap(slotOf('2.1.291'), slotOf('2.1.292'))).toBeGreaterThanOrEqual(10)
})

test('values are spread across the wheel', () => {
  const seen = new Set(Array.from({ length: 500 }, (_, i) => slotOf(`value-${i}`)))
  expect(seen.size).toBe(HUE_COUNT)
})

test('effort runs from yellow to red, a colour per level', () => {
  for (const tone of ['dark', 'light'] as const) {
    const ramp = EFFORTS.map(level => effortColour(level, tone)!)
    expect(new Set(ramp).size).toBe(EFFORTS.length)
    // Red rises or holds and green falls as the level does: yellow at one end, red at the other.
    const channel = (colour: string, at: number) => parseInt(colour.slice(at, at + 2), 16)
    for (let i = 1; i < ramp.length; i++) {
      expect(channel(ramp[i]!, 1)).toBeGreaterThanOrEqual(channel(ramp[i - 1]!, 1) - 8)
      expect(channel(ramp[i]!, 3)).toBeLessThan(channel(ramp[i - 1]!, 3))
    }
  }
  // A level the ramp does not know is coloured as any value is.
  expect(effortColour('auto')).toBe(hue('auto'))
})

test('a missing value has no colour', () => {
  expect(hue(undefined)).toBeUndefined()
  expect(hue('')).toBeUndefined()
  expect(effortColour(undefined)).toBeUndefined()
})

test('a theme is light by its name, and dark otherwise', () => {
  expect(toneOf('light')).toBe('light')
  expect(toneOf('light-daltonized')).toBe('light')
  expect(toneOf('dark-ansi')).toBe('dark')
  expect(toneOf(undefined)).toBe('dark')
})
