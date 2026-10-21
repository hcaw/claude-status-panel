import { expect, test } from 'claude-code/testing'

import { dayOf, releaseOf } from '../hooks/changelog'

const CHANGELOG = [
  '# Changelog',
  '',
  '## [Unreleased]',
  '',
  'Coming soon.',
  '',
  '## [1.2.0] - 2026-10-21',
  '',
  'The pane reads its date from',
  'this [changelog](CHANGELOG.md), with `code`.',
  '',
  '### Added',
  '',
  '- A thing.',
  '',
  '## [1.1.0] - 2026-09-30',
  '',
  '### Fixed',
  '',
  '- **Bold** fix.',
  '',
  '[unreleased]: https://example.com/compare/v1.2.0...HEAD',
].join('\r\n')

test('a release is found by the manifest version, not by being first', () => {
  expect(releaseOf(CHANGELOG, '1.2.0')).toEqual({
    date: '2026-10-21',
    summary: 'The pane reads its date from this changelog, with code.',
  })
})

test('a release with no summary falls back to its first bullet', () => {
  expect(releaseOf(CHANGELOG, '1.1.0')).toEqual({ date: '2026-09-30', summary: 'Bold fix.' })
})

test('an undated or missing version has no release', () => {
  expect(releaseOf(CHANGELOG, 'Unreleased')).toBeUndefined()
  expect(releaseOf(CHANGELOG, '9.9.9')).toBeUndefined()
  expect(releaseOf('', '1.2.0')).toBeUndefined()
})

test('dates read as day, short month and year', () => {
  expect(dayOf('2026-10-21')).toBe('21 Oct 2026')
  expect(dayOf('2026-03-04')).toBe('4 Mar 2026')
  expect(dayOf('2026-13-01')).toBeUndefined()
  expect(dayOf('21 Oct 2026')).toBeUndefined()
})
