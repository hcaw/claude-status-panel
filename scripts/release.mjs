// Releases status-panel. Run from the repo root, on main, level with origin:
//
//   npm run release -- [patch|minor|major|X.Y.Z] [--dry-run] [--skip-install]
//       Dates the `## [Unreleased]` section of CHANGELOG.md, bumps plugin.json, runs every
//       check, commits `release: X.Y.Z`, tags `status-panel--vX.Y.Z` (with `claude plugin tag`),
//       pushes the commit and tag together, publishes the GitHub release with that section as
//       its notes, updates this machine's install and waits for CI. With no bump it picks one
//       from the commit subjects since the last tag: `feat` is minor, anything else patch, and a
//       breaking change major (minor while in 0.x). CHANGELOG.md may be the one uncommitted
//       file: it goes into the release commit.
//   npm run release -- --finish [--skip-install]
//       The steps after the push, for the version in plugin.json; safe to run again.
//   npm run release -- --check
//       Checks plugin.json, CHANGELOG.md and marketplace.json agree (CI runs this).
//   npm run release -- --notes X.Y.Z
//       Prints a version's changelog section, as the GitHub release shows it.
//
// Pushing the bump to main is what ships it: `claude plugin update` follows plugin.json's
// version on main. So every check runs before the push, and a failure after it is fixed
// forward with another release, never by moving a pushed tag.

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const NAME = 'status-panel'
const PLUGIN_ID = 'status-panel@hcaw-status-panel'
const MARKETPLACE = 'hcaw-status-panel'
const REPO = 'https://github.com/hcaw/claude-status-panel'
const BRANCH = 'main'
const MANIFEST = '.claude-plugin/plugin.json'
const CATALOG = '.claude-plugin/marketplace.json'
const CHANGELOG = 'CHANGELOG.md'
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/
const HEADING = /^## \[([^\]]+)\](?: - (\d{4}-\d{2}-\d{2}))?\s*$/
const LINK = /^\[[^\]]+\]: /

const tagOf = version => `${NAME}--v${version}`

class Stop extends Error {}
// Set once the release commit and tag are on origin, after which a failure is finished, not redone.
let pushed = false
const fail = message => {
  throw new Stop(message)
}
const say = message => console.log(`\n> ${message}`)

// git and gh are executables everywhere; npm and claude can be .cmd shims on Windows, so
// those go through a shell, always as fixed command lines with no user text in them.
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd()
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd()
const succeeds = (file, ...args) => spawnSync(file, args, { stdio: 'ignore' }).status === 0
const shell = command => {
  console.log(`$ ${command}`)
  if (spawnSync(command, { shell: true, stdio: 'inherit' }).status !== 0) fail(`\`${command}\` failed.`)
}
const shellOutput = command => {
  const result = spawnSync(command, { shell: true, encoding: 'utf8' })
  if (result.status !== 0) fail(`\`${command}\` failed:\n${result.stderr}`)
  return result.stdout
}
const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

const text = path => readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
const manifestVersion = (source = text(MANIFEST)) => JSON.parse(source).version

// The local date, as the person releasing it would write it.
function today() {
  const now = new Date()
  const two = n => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`
}

const isDate = iso => /^\d{4}-\d{2}-\d{2}$/.test(iso) && new Date(`${iso}T00:00:00Z`).toISOString().startsWith(iso)

function compare(a, b) {
  const [x, y] = [a, b].map(v => SEMVER.exec(v).slice(1).map(Number))
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

// The `## ` sections of a changelog: heading fields and the body lines, which stop at the
// next heading or the link definitions at the foot.
function sections(changelog) {
  const lines = changelog.split('\n')
  const found = []
  lines.forEach((line, index) => {
    const heading = HEADING.exec(line)
    if (heading) found.push({ version: heading[1], date: heading[2], line: index })
    else if (line.startsWith('## ')) found.push({ version: undefined, date: undefined, line: index, bad: line })
  })
  const links = lines.findIndex(line => LINK.test(line))
  return found.map((section, i) => {
    const end = Math.min(found[i + 1]?.line ?? lines.length, links < 0 ? lines.length : links)
    const body = lines.slice(section.line + 1, end)
    while (body.length && !body[0].trim()) body.shift()
    while (body.length && !body.at(-1).trim()) body.pop()
    return { ...section, body }
  })
}

// A section opens with a one-line summary, which the Settings tab shows.
const summaryOf = body => (body[0] && !/^([-*#]|\[)/.test(body[0].trim()) ? body[0].trim() : undefined)

// Everything wrong with these files, as a list.
function problemsWith(version, changelog, catalog = text(CATALOG)) {
  const problems = []
  if (!SEMVER.test(version ?? '')) problems.push(`${MANIFEST}: version "${version}" is not X.Y.Z.`)
  if (!changelog.startsWith('# Changelog\n')) problems.push(`${CHANGELOG}: the first line must be "# Changelog".`)
  const all = sections(changelog)
  for (const bad of all.filter(s => s.bad)) problems.push(`${CHANGELOG}: "${bad.bad}" is not "## [X.Y.Z] - YYYY-MM-DD".`)
  if (all[0]?.version !== 'Unreleased' || all[0].date) problems.push(`${CHANGELOG}: the first section must be "## [Unreleased]".`)
  const released = all.slice(1).filter(s => !s.bad)
  released.forEach((s, i) => {
    if (!SEMVER.test(s.version) || !s.date || !isDate(s.date)) {
      problems.push(`${CHANGELOG}: "## [${s.version}]" needs an X.Y.Z version and a real YYYY-MM-DD date.`)
      return
    }
    if (!summaryOf(s.body)) problems.push(`${CHANGELOG}: ${s.version} needs a one-line summary under its heading.`)
    const older = released[i + 1]
    if (older && SEMVER.test(older.version) && compare(s.version, older.version) <= 0) {
      problems.push(`${CHANGELOG}: ${s.version} must be newer than ${older.version} below it.`)
    }
    if (older?.date && s.date < older.date) problems.push(`${CHANGELOG}: ${s.version} is dated before ${older.version}.`)
  })
  if (released[0] && released[0].version !== version) {
    problems.push(`${CHANGELOG}: the newest entry is ${released[0].version}, but ${MANIFEST} says ${version}.`)
  }
  for (const entry of JSON.parse(catalog).plugins ?? []) {
    if ('version' in entry) problems.push(`${CATALOG}: drop "version" from ${entry.name}; ${MANIFEST} is its one source.`)
  }
  return problems
}

// The changelog with `[Unreleased]`'s entries moved under a dated heading for `to`, and the
// compare links at the foot brought up to date.
function promote(changelog, from, to, date) {
  const lines = changelog.split('\n')
  const unreleased = lines.findIndex(line => HEADING.exec(line)?.[1] === 'Unreleased')
  lines.splice(unreleased + 1, 0, '', `## [${to}] - ${date}`)
  const link = lines.findIndex(line => /^\[unreleased\]: /i.test(line))
  const ours = [`[unreleased]: ${REPO}/compare/${tagOf(to)}...HEAD`, `[${to}]: ${REPO}/compare/${tagOf(from)}...${tagOf(to)}`]
  if (link < 0) {
    while (lines.length && !lines.at(-1).trim()) lines.pop()
    lines.push('', ...ours, '')
  } else {
    lines.splice(link, 1, ...ours)
  }
  return lines.join('\n')
}

function notesOf(changelog, version) {
  const section = sections(changelog).find(s => s.version === version && s.date)
  if (!section) fail(`${CHANGELOG} has no dated entry for ${version}.`)
  return `${section.body.join('\n')}\n`
}

function nextVersion(current, bump) {
  if (SEMVER.test(bump)) {
    if (compare(bump, current) <= 0) fail(`${bump} is not newer than ${current}.`)
    return bump
  }
  const [major, minor, patch] = current.split('.').map(Number)
  if (bump === 'major') return `${major + 1}.0.0`
  if (bump === 'minor') return `${major}.${minor + 1}.0`
  if (bump === 'patch') return `${major}.${minor}.${patch + 1}`
  fail(`Unknown bump "${bump}": use patch, minor, major or X.Y.Z.`)
}

// The bump the commits since the last release call for.
function inferredBump(current) {
  const since = tagOf(current)
  if (!succeeds('git', 'rev-parse', '--verify', '--quiet', `refs/tags/${since}`)) {
    fail(`There is no tag ${since} to count commits from, so name the bump: patch, minor, major or X.Y.Z.`)
  }
  const log = git('log', '--format=%s%n%b%x00', `${since}..HEAD`)
  const commits = log.split('\0').map(c => c.trim()).filter(Boolean)
  if (!commits.length) fail(`Nothing to release: no commits since ${since}.`)
  const breaking = commits.some(c => /^\w+(\([^)]*\))?!:/.test(c) || /^BREAKING[ -]CHANGE:/m.test(c))
  const [major] = current.split('.').map(Number)
  if (breaking) return major === 0 ? 'minor' : 'major'
  return commits.some(c => /^feat(\([^)]*\))?:/.test(c)) ? 'minor' : 'patch'
}

// Refuses to release on top of a commit whose CI run failed. One still running is waited for.
function requireGreenCi(sha) {
  let runs
  try {
    runs = JSON.parse(gh('run', 'list', '--commit', sha, '--workflow', 'ci.yml', '--json', 'databaseId,status,conclusion', '--limit', '1'))
  } catch (error) {
    console.log(`(Could not read CI for ${sha.slice(0, 7)}, so carrying on: ${String(error.stderr ?? error).trim()})`)
    return
  }
  const run = runs[0]
  if (!run) return console.log(`(No CI run for ${sha.slice(0, 7)}; the local checks stand in for it.)`)
  if (run.status !== 'completed') {
    say(`Waiting for CI on ${sha.slice(0, 7)}`)
    if (spawnSync('gh', ['run', 'watch', String(run.databaseId), '--exit-status', '--compact', '--interval', '15'], { stdio: 'inherit' }).status !== 0) {
      fail(`CI failed on ${sha.slice(0, 7)}: fix it before releasing.`)
    }
  } else if (run.conclusion === 'failure') {
    fail(`CI failed on ${sha.slice(0, 7)}: fix it before releasing.`)
  }
}

function release(bump) {
  const dryRun = process.argv.includes('--dry-run')
  say('Checking the repository')
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
  if (branch !== BRANCH) fail(`Releases are cut from ${BRANCH}, not ${branch}.`)
  const dirty = git('status', '--porcelain').split('\n').filter(Boolean)
  const stray = dirty.filter(line => line.slice(3) !== CHANGELOG)
  if (stray.length) fail(`Commit or stash these first (only ${CHANGELOG} may be uncommitted):\n${stray.join('\n')}`)
  git('fetch', '--quiet', '--tags', 'origin', BRANCH)
  if (git('rev-parse', 'HEAD') !== git('rev-parse', `origin/${BRANCH}`)) fail(`${BRANCH} is not level with origin/${BRANCH}: pull or push first.`)
  if (!succeeds('gh', 'auth', 'status')) fail('gh is not signed in: run `gh auth login`.')

  const current = manifestVersion()
  const changelog = text(CHANGELOG)
  const problems = problemsWith(current, changelog)
  if (problems.length) fail(problems.join('\n'))
  const unreleased = sections(changelog)[0].body
  if (!unreleased.length) fail(`## [Unreleased] in ${CHANGELOG} is empty: say what this release changes first.`)
  if (!summaryOf(unreleased)) fail(`## [Unreleased] in ${CHANGELOG} needs a one-line summary above its bullets.`)

  const to = nextVersion(current, bump ?? inferredBump(current))
  const tag = tagOf(to)
  if (succeeds('git', 'rev-parse', '--verify', '--quiet', `refs/tags/${tag}`) || git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`)) {
    fail(`Tag ${tag} already exists.`)
  }
  requireGreenCi(git('rev-parse', 'HEAD'))

  const date = today()
  const promoted = promote(changelog, current, to, date)
  const manifest = text(MANIFEST).replace(/("version"\s*:\s*)"[^"]*"/, `$1"${to}"`)
  const after = problemsWith(manifestVersion(manifest), promoted)
  if (after.length) fail(after.join('\n'))

  console.log(`\n${NAME} ${current} -> ${to}, dated ${date}, tagged ${tag}. Notes:\n\n${notesOf(promoted, to)}`)
  if (dryRun) {
    console.log('Dry run: nothing written. Without --dry-run this runs `npm run check`, writes the two files, commits,')
    console.log(`tags, runs \`git push --atomic origin ${BRANCH} refs/tags/${tag}\`, creates the GitHub release and verifies it.`)
    return
  }

  say('Running every check')
  shell('npm run check')

  say(`Writing ${MANIFEST} and ${CHANGELOG}`)
  writeFileSync(MANIFEST, manifest)
  writeFileSync(CHANGELOG, promoted)

  say('Committing and tagging')
  const scratch = mkdtempSync(join(tmpdir(), `${NAME}-release-`))
  try {
    const message = join(scratch, 'message.txt')
    writeFileSync(message, `release: ${to}\n\n${summaryOf(unreleased)}\n`)
    git('add', MANIFEST, CHANGELOG)
    git('commit', '--quiet', '--file', message)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
  // Validates the plugin, checks the tree is clean and makes the annotated tag.
  shell('claude plugin tag .')

  say('Pushing')
  // Commit and tag land together or not at all.
  git('push', '--quiet', '--atomic', 'origin', BRANCH, `refs/tags/${tag}`)
  pushed = true
  finish(to)
}

// Everything after the push, safe to run again: the GitHub release, then checks from outside.
function finish(version = manifestVersion()) {
  const tag = tagOf(version)
  if (!git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`)) fail(`${tag} is not on origin: release first.`)

  say('Publishing the GitHub release')
  if (succeeds('gh', 'release', 'view', tag)) {
    console.log(`${tag} already has a release.`)
  } else {
    const scratch = mkdtempSync(join(tmpdir(), `${NAME}-notes-`))
    try {
      const notes = join(scratch, 'notes.md')
      writeFileSync(notes, notesOf(git('show', `${tag}:${CHANGELOG}`).replace(/\r\n/g, '\n'), version))
      gh('release', 'create', tag, '--verify-tag', '--title', `${NAME} ${version}`, '--notes-file', notes)
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  }

  say('Checking the release from outside')
  const published = JSON.parse(gh('release', 'view', tag, '--json', 'url,isDraft'))
  if (published.isDraft) fail(`${published.url} is a draft.`)
  const shipped = manifestVersion(git('show', `${tag}:${MANIFEST}`))
  if (shipped !== version) fail(`${tag} carries version ${shipped}, not ${version}.`)
  const remoteMain = git('ls-remote', 'origin', `refs/heads/${BRANCH}`).split(/\s/)[0]
  if (!succeeds('git', 'merge-base', '--is-ancestor', tag, remoteMain)) fail(`${tag} is not on origin/${BRANCH}.`)
  console.log(`${published.url}`)

  if (!process.argv.includes('--skip-install')) {
    say('Updating this machine to the release')
    const installed = () => JSON.parse(shellOutput('claude plugin list --json')).find(p => p.id === PLUGIN_ID)
    const before = installed()
    if (!before) {
      console.log(`${PLUGIN_ID} is not installed here, so there is nothing to update.`)
    } else {
      shell(`claude plugin marketplace update ${MARKETPLACE}`)
      shell(`claude plugin update ${PLUGIN_ID} --scope ${before.scope}`)
      const now = installed()?.version
      if (now !== version) fail(`The installed ${PLUGIN_ID} is ${now}, not ${version}.`)
      console.log(`Installed ${PLUGIN_ID} ${before.version} -> ${now}. Run /reload-plugins in open sessions.`)
    }
  }

  say('Waiting for CI on the release commit')
  const sha = git('rev-list', '-n', '1', tag)
  let run
  for (let tries = 0; tries < 20 && !run; tries++) {
    run = JSON.parse(gh('run', 'list', '--commit', sha, '--workflow', 'ci.yml', '--json', 'databaseId', '--limit', '1'))[0]
    if (!run) pause(6_000)
  }
  if (!run) fail(`No CI run appeared for ${sha.slice(0, 7)}; check ${REPO}/actions.`)
  if (spawnSync('gh', ['run', 'watch', String(run.databaseId), '--exit-status', '--compact', '--interval', '15'], { stdio: 'inherit' }).status !== 0) {
    fail(`CI failed on the release commit. ${version} is already out, so fix forward with a patch release.`)
  }
  console.log(`\nReleased ${NAME} ${version}.`)
}

try {
  const args = process.argv.slice(2)
  const words = args.filter(arg => !arg.startsWith('--'))
  if (args.includes('--check')) {
    const problems = problemsWith(manifestVersion(), text(CHANGELOG))
    if (problems.length) fail(problems.join('\n'))
    console.log(`${MANIFEST}, ${CHANGELOG} and ${CATALOG} agree on ${manifestVersion()}.`)
  } else if (args.includes('--notes')) {
    process.stdout.write(notesOf(text(CHANGELOG), words[0] ?? manifestVersion()))
  } else if (args.includes('--finish')) {
    finish()
  } else {
    if (words.length > 1) fail(`Expected one bump, got: ${words.join(' ')}`)
    release(words[0])
  }
} catch (error) {
  // A failed git or gh call's message holds the command and its stderr.
  console.error(`\nrelease: ${String(error.message).trim()}`)
  if (pushed) console.error('The commit and tag are pushed: fix the cause, then run `npm run release -- --finish`.')
  process.exitCode = 1
}
