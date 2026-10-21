// Reads this plugin's CHANGELOG.md (Keep a Changelog), which `npm run release` writes: a
// `## [X.Y.Z] - YYYY-MM-DD` heading per release, then a one-line summary, then grouped bullets.

export type Release = { date: string; summary?: string }

const HEADING = /^## \[([^\]]+)\](?: - (\d{4}-\d{2}-\d{2}))?\s*$/
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// The dated entry for `version` (never `[Unreleased]`, which has no date): its ISO date and
// its summary, the first paragraph under the heading, or failing that its first bullet.
export function releaseOf(changelog: string, version: string): Release | undefined {
  const lines = changelog.replace(/\r\n?/g, '\n').split('\n')
  const start = lines.findIndex(line => {
    const found = HEADING.exec(line)
    return found?.[1] === version && found[2] !== undefined
  })
  if (start < 0) return undefined
  const date = HEADING.exec(lines[start]!)![2]!
  const prose: string[] = []
  let bullet: string | undefined
  for (const line of lines.slice(start + 1)) {
    const text = line.trim()
    if (line.startsWith('## ') || /^\[[^\]]+\]: /.test(text)) break
    if (!text) {
      if (prose.length) break
      continue
    }
    if (text.startsWith('#')) {
      if (prose.length) break
      continue
    }
    if (/^[-*] /.test(text)) {
      if (prose.length) break
      bullet ??= text.slice(2)
      continue
    }
    if (bullet === undefined) prose.push(text)
  }
  const summary = prose.length ? prose.join(' ') : bullet
  return { date, summary: summary === undefined ? undefined : plain(summary) }
}

// `2026-10-21` as `21 Oct 2026`, without Intl, which the sandbox may not have.
export function dayOf(iso: string): string | undefined {
  const found = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  const month = found && MONTHS[Number(found[2]) - 1]
  return found && month ? `${Number(found[3])} ${month} ${found[1]}` : undefined
}

// Markdown links, code spans and bold as plain text.
const plain = (text: string) =>
  text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .trim()
