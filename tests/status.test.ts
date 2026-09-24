/** Host unit tests: status parsing and repositoryStatus against a real repo. */
import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GitRunner } from '../src/git/runner.ts'
import { parseStatusEntriesZ, parseStatusV2Z, repositoryStatus, sumNumstatZ } from '../src/git/status.ts'
import { createTempRepo } from './helpers/temp-repo.ts'
import { nodeSubprocess } from './helpers/node-subprocess.ts'

function git(): GitRunner {
  return new GitRunner(nodeSubprocess(), 'git', { timeoutMs: 10_000, outputMaxBytes: 1024 * 1024 })
}

describe('parseStatusV2Z', () => {
  it('reads branch, upstream, ahead/behind, and counts entries', () => {
    const output = [
      '# branch.oid abc1234def5678',
      '# branch.head feature/x',
      '# branch.upstream origin/feature/x',
      '# branch.ab +2 -1',
      '1 M. N... 000000 000000 000000 file-a',
      '? file-b',
      '\0'.trim(),
    ].join('\0')
    const parsed = parseStatusV2Z(output)
    expect(parsed.branch).toBe('feature/x')
    expect(parsed.upstream).toBe('origin/feature/x')
    expect(parsed.ahead).toBe(2)
    expect(parsed.behind).toBe(1)
    expect(parsed.commit).toBe('abc1234')
    expect(parsed.detached).toBe(false)
    expect(parsed.dirtyFiles).toBe(2)
  })

  it('marks detached HEAD and the initial repository', () => {
    const parsed = parseStatusV2Z(['# branch.oid (initial)', '# branch.head (detached)', '? x'].join('\0'))
    expect(parsed.detached).toBe(true)
    expect(parsed.commit).toBeUndefined()
    expect(parsed.dirtyFiles).toBe(1)
  })

  it('counts unmerged records', () => {
    const parsed = parseStatusV2Z(['u AU N... 000000 000000 000000 both', '1 .M N... 1 1 1 f'].join('\0'))
    expect(parsed.dirtyFiles).toBe(2)
  })
})

describe('parseStatusEntriesZ / changeStatusOf', () => {
  it('maps ordinary, untracked, and unmerged records', () => {
    const entries = parseStatusEntriesZ([
      '1 M. N... 000000 000000 000000 000000 000000 modified file',
      '1 .D N... 111111 222222 333333 444444 555555 deleted file',
      '? new file.txt',
      'u AU N... 0 0 0 0 1 1 1 1 conflict',
    ].join('\0'))
    expect(entries).toHaveLength(4)
    const statuses = entries.map(entry => ('untracked' in entry ? 'untracked' : 'unmerged' in entry ? 'unmerged' : `${entry.index}/${entry.worktree}`))
    expect(statuses).toEqual(['M/.', './D', 'untracked', 'unmerged'])
  })
})

describe('sumNumstatZ', () => {
  it('sums counts and skips binary entries', () => {
    const parsed = sumNumstatZ(['3\t1\ta.txt', '-\t-\tlogo.png', '0\t2\tb.txt'].join('\0'))
    expect(parsed).toEqual({ added: 3, deleted: 3 })
  })
})

describe('repositoryStatus', () => {
  it('reports a clean repository', async () => {
    const repo = await createTempRepo()
    try {
      await repo.write('a.txt', 'one\ntwo\n')
      repo.run(['add', '.'])
      repo.run(['commit', '-m', 'init'])
      const status = await repositoryStatus(git(), repo.root, AbortSignal.timeout(5000))
      expect(status.isRepo).toBe(true)
      expect(status.branch).toBe('master')
      expect(status.dirtyFiles).toBe(0)
      expect(status.added).toBe(0)
      expect(status.deleted).toBe(0)
      expect(status.upstream).toBeUndefined()
    } finally {
      await repo.dispose()
    }
  })

  it('counts staged, unstaged, and untracked changes with line totals', async () => {
    const repo = await createTempRepo()
    try {
      await repo.write('a.txt', 'one\ntwo\n')
      repo.run(['add', '.'])
      repo.run(['commit', '-m', 'init'])
      await repo.write('a.txt', 'one\ntwo\nthree\n')
      await repo.write('new.txt', 'x\ny\n')
      const status = await repositoryStatus(git(), repo.root, AbortSignal.timeout(5000))
      expect(status.dirtyFiles).toBe(2)
      expect(status.added).toBe(1)
      expect(status.deleted).toBe(0)
    } finally {
      await repo.dispose()
    }
  })

  it('answers isRepo false outside a repository', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'dsh-git-pilot-plain-'))
    try {
      const status = await repositoryStatus(git(), plain, AbortSignal.timeout(5000))
      expect(status.isRepo).toBe(false)
    } finally {
      await rm(plain, { recursive: true, force: true })
    }
  })

  it('marks a detached HEAD', async () => {
    const repo = await createTempRepo()
    try {
      await repo.write('a.txt', 'x\n')
      repo.run(['add', '.'])
      repo.run(['commit', '-m', 'init'])
      const hash = repo.run(['rev-parse', 'HEAD']).trim()
      repo.run(['checkout', '--detach', hash])
      const status = await repositoryStatus(git(), repo.root, AbortSignal.timeout(5000))
      expect(status.detached).toBe(true)
      expect(status.branch).toBeUndefined()
      expect(status.commit).toBe(hash.slice(0, 7))
    } finally {
      await repo.dispose()
    }
  })
})
