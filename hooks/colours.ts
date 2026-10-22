// Colours that name a value: the same string always takes the same colour, whichever field
// shows it, so a change of model, version or account shows at a glance. Effort, whose levels
// are known, is a ramp instead, from light yellow to bright red.
//
// Theme keys hold only a handful of hues and no ramp, so these are raw colours, made in
// OKLCH (where equal lightness looks equally light whatever the hue) and given in two
// tones: bright for a dark theme, deeper for a light one, each kept readable as text.
import type { Color } from 'claude-code'

export type Tone = 'light' | 'dark'

/** The tone of a theme by its `/config` name: `light`, `light-daltonized`, ... or dark. */
export const toneOf = (theme: unknown): Tone => (typeof theme === 'string' && theme.startsWith('light') ? 'light' : 'dark')

// OKLCH to sRGB hex, giving up chroma until the colour fits the sRGB gamut.
function oklch(l: number, c: number, h: number): string {
  const toSrgb = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)
  for (let chroma = c; ; chroma -= 0.005) {
    const a = chroma * Math.cos((h * Math.PI) / 180)
    const b = chroma * Math.sin((h * Math.PI) / 180)
    const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
    const M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
    const S = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
    const rgb = [
      4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
      -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
      -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
    ].map(toSrgb)
    if (chroma <= 0 || rgb.every(x => x >= 0 && x <= 1)) {
      return `#${rgb.map(x => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0')).join('')}`
    }
  }
}

// How many hues the wheel is cut into.
export const HUE_COUNT = 50

// Lightness and chroma per tone: light enough to read on a dark background, dark enough on
// a light one, and as vivid as the gamut allows there.
const WHEEL = { dark: [0.8, 0.13], light: [0.5, 0.15] } as const

export const PALETTE: Record<Tone, readonly string[]> = {
  dark: Array.from({ length: HUE_COUNT }, (_, i) => oklch(WHEEL.dark[0], WHEEL.dark[1], (360 * i) / HUE_COUNT)),
  light: Array.from({ length: HUE_COUNT }, (_, i) => oklch(WHEEL.light[0], WHEEL.light[1], (360 * i) / HUE_COUNT)),
}

// Hashed ahead of every value. Hues side by side on the wheel look alike, so this was chosen
// (by trying salts in turn) to put each current model well apart from the others, and two
// releases in a row apart too. Changing it recolours every value.
const SALT = 'status-panel:497'

// FNV-1a over the string's UTF-16 code units: small, stable and spread well enough.
function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

/** Where `value` falls on the wheel, 0 to HUE_COUNT - 1. */
export const slotOf = (value: string) => fnv1a(SALT + value) % HUE_COUNT

/** The colour for `value`, or none for a missing one, which is drawn dim instead. */
export function hue(value: string | undefined, tone: Tone = 'dark'): Color | undefined {
  return value ? PALETTE[tone][slotOf(value)] : undefined
}

// Effort levels, least first.
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

// The ramp's ends, as OKLCH: a pale yellow to a bright red on a dark theme, and a deep gold
// to a deep red on a light one, where a pale yellow would not read.
const RAMP = {
  dark: [[0.95, 0.12, 100], [0.67, 0.24, 28]],
  light: [[0.56, 0.12, 85], [0.5, 0.21, 28]],
} as const

const ramp = (tone: Tone) =>
  EFFORTS.map((_, i) => {
    const t = i / (EFFORTS.length - 1)
    const [from, to] = RAMP[tone]
    return oklch(...([0, 1, 2].map(k => from[k]! + (to[k]! - from[k]!) * t) as [number, number, number]))
  })

const EFFORT_RAMP: Record<Tone, readonly string[]> = { dark: ramp('dark'), light: ramp('light') }

/** The colour of an effort level on the ramp; a level it does not know takes a hue as any value does. */
export function effortColour(level: string | undefined, tone: Tone = 'dark'): Color | undefined {
  const at = EFFORTS.indexOf(level as (typeof EFFORTS)[number])
  return at >= 0 ? EFFORT_RAMP[tone][at] : hue(level, tone)
}
