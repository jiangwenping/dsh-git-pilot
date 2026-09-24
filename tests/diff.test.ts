/** Host unit tests: numstat/unified-diff parsing, untracked facts, and row assembly. */
import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { changedFileRow, parseNumstatZ, parseUnifiedDiff, untrackedFacts } from '../src/git/diff.ts'

describe('parseNumstatZ', () => {
  it('parses counts and paths, including tabs inside paths', () => {
    const entries = parseNumstatZ(['3\t1\tsrc/a.ts', '-\t-\tbin.png', '2\t0\tdir\twith-tab.txt'].join('\0'))
    expect(entries).toEqual([
      { added: 3, deleted: 1, path: 'src/a.ts' },
      { added: null, deleted: null, path: 'bin.png' },
      { added: 2, deleted: 0, path: 'dir\twith-tab.txt' },
    ])
  })

  it('ignores a trailing separator', () => {
    expect(parseNumstatZ('1\t0\tx\0')).toEqual([{ added: 1, deleted: 0, path: 'x' }])
  })
})

describe('parseUnifiedDiff', () => {
  const diff = [
    'diff --git a/a.txt b/a.txt',
    'index 111..222 100644',
    '--- a/a.txt',
    '+++ b/a.txt',
    '@@ -1,2 +1,3 @@',
    ' one',
    '-two',
    '+two and more',
    '+three',
    'diff --git a/b.txt b/b.txt',
    'index 333..444 100644',
    '--- a/b.txt',
    '+++ b/b.txt',
    '@@ -0,0 +1,1 @@',
    '+hello',
  ].join('\n')

  it('extracts hunks with headers, bodies, and line numbers', () => {
    const hunks = parseUnifiedDiff(diff)
    expect(hunks).toHaveLength(2)
    expect(hunks[0]).toMatchObject({ oldStart: 1, oldLines: 2, newStart: 1, newLines: 3 })
    expect(hunks[0].lines).toEqual([' one', '-two', '+two and more', '+three'])
    expect(hunks[1]).toMatchObject({ oldStart: 0, oldLines: 0, newStart: 1, newLines: 1 })
    expect(hunks[1].lines).toEqual(['+hello'])
  })

  it('keeps lines after a mid-hunk no-newline marker (R2 regression)', () => {
    const diff = [
      '@@ -1,2 +1,4 @@',
      ' line1',
      '-line2',
      '\\ No newline at end of file',
      '+line2',
      '+line3',
      '+line4',
    ].join('\n')
    const hunks = parseUnifiedDiff(diff)
    expect(hunks).toHaveLength(1)
    expect(hunks[0].lines).toEqual([' line1', '-line2', '\\ No newline at end of file', '+line2', '+line3', '+line4'])
  })

  it('does not push the trailing-newline artifact as a body line', () => {
    const hunks = parseUnifiedDiff('@@ -1,1 +1,1 @@\n-x\n+x\n')
    expect(hunks[0].lines).toEqual(['-x', '+x'])
  })

  it('tolerates abbreviated header forms', () => {
    const hunks = parseUnifiedDiff('@@ -3 +3 @@\n-x\n+x')
    expect(hunks[0]).toMatchObject({ oldStart: 3, oldLines: 1, newStart: 3, newLines: 1 })
  })
})

describe('untrackedFacts', () => {
  it('counts non-empty lines', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-git-pilot-facts-'))
    try {
      const file = join(dir, 'new.txt')
      await writeFile(file, 'a\n\n  \nb\n')
      const facts = await untrackedFacts(file, 1024)
      expect(facts).toEqual({ lines: 2, binary: false, oversized: false })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('flags binary content by NUL probe', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-git-pilot-facts-'))
    try {
      const file = join(dir, 'blob.bin')
      await writeFile(file, Buffer.from([0x61, 0x00, 0x62]))
      const facts = await untrackedFacts(file, 1024)
      expect(facts.binary).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('flags oversized files without reading them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-git-pilot-facts-'))
    try {
      const file = join(dir, 'big.txt')
      await writeFile(file, 'x'.repeat(64))
      const facts = await untrackedFacts(file, 8)
      expect(facts.oversized).toBe(true)
      expect(facts.lines).toBe(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('changedFileRow', () => {
  it('marks binary rows and sums plain rows', () => {
    expect(changedFileRow('logo.png', 'modified', { added: null, deleted: null, path: 'logo.png' })).toEqual({
      path: 'logo.png', status: 'modified', added: 0, deleted: 0, binary: true,
    })
    expect(changedFileRow('a.ts', 'modified', { added: 4, deleted: 1, path: 'a.ts' })).toEqual({
      path: 'a.ts', status: 'modified', added: 4, deleted: 1,
    })
    expect(changedFileRow('new.ts', 'untracked', undefined)).toEqual({
      path: 'new.ts', status: 'untracked', added: 0, deleted: 0,
    })
  })
})
