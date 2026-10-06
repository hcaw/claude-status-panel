// Text charts drawn from Unicode box drawing and block elements, so they look the same on every surface
// that draws `Text`. Each chart is a list of runs, one per colour, that the pane draws as
// nested `Text`; every glyph is one cell wide, so a chart `n` cells wide is `n` glyphs.
import type { Color } from 'claude-code'

export type Run = { text: string; color?: Color; dim?: boolean; bold?: boolean }
type Cell = Omit<Run, 'text'> & { glyph: string }

// A meter is a thin line, filled in half cells: `╸` is the left half of `━`.
const LINE = '━'
const HALF = '╸'
const MARK = '┃'
// A column filled from the bottom in eighths, 1 to 8.
const TICKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

const clamp = (n: number, low = 0, high = 1) => Math.min(high, Math.max(low, n))

// Joins neighbouring cells of the same style into one run.
function runs(cells: Cell[]): Run[] {
  const out: Run[] = []
  for (const { glyph, ...style } of cells) {
    const last = out[out.length - 1]
    if (last && last.color === style.color && last.dim === style.dim && last.bold === style.bold) last.text += glyph
    else out.push({ text: glyph, ...style })
  }
  return out
}

// How many cells a line of runs takes.
export const width = (line: Run[]) => line.reduce((sum, run) => sum + run.text.length, 0)

/**
 * A thin horizontal meter `cells` wide filled to `fraction` (0 to 1) at half a cell's
 * resolution, the rest a dim track of the same line. `mark`, a fraction too, draws a
 * taller tick at that point, over the fill or the track: the pace line on a limit,
 * where usage would stand if it went evenly through the window.
 */
export function meter(fraction: number, cells: number, color: Color, mark?: number): Run[] {
  const halves = Math.round(clamp(fraction) * cells * 2)
  const out: Cell[] = []
  for (let i = 0; i < cells; i++) {
    const filled = clamp(halves - i * 2, 0, 2)
    out.push(filled === 0 ? { glyph: LINE, color: 'inactive', dim: true } : { glyph: filled === 2 ? LINE : HALF, color })
  }
  if (mark !== undefined) {
    const at = Math.min(cells - 1, Math.floor(clamp(mark) * cells))
    out[at] = { glyph: MARK, color: 'text', bold: true }
  }
  return runs(out)
}

/**
 * A sparkline of the last `cells` values, one column each, from zero to `max` (the
 * largest shown when absent). One hue: the history dim, the latest value bright.
 */
export function spark(values: readonly number[], cells: number, color: Color, max?: number): Run[] {
  const shown = values.slice(-cells)
  const top = max ?? Math.max(...shown, 1)
  return runs(
    shown.map((value, i) => {
      const share = top > 0 ? clamp(value / top) : 0
      const glyph = TICKS[Math.round(share * (TICKS.length - 1))]!
      return i === shown.length - 1 ? { glyph, color, bold: true } : { glyph, color, dim: true }
    }),
  )
}
