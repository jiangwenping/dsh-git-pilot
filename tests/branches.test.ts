/** Host unit tests: branch listing, validation, creation, and checkout plumbing. */
import { describe, expect, it } from 'vitest'
import { GitRunner } from '../src/git/runner.ts'
import { createBranch, checkoutBranch, listBranches, validateBranchName } from '../src/git/branches.ts'
import { createTempRepo } from './helpers/temp-repo.ts'
import { nodeSubprocess } from './helpers/node-subprocess.ts'

function git(): GitRunner {
  return new GitRunner(nodeSubprocess(), 'git', { timeoutMs: 10_000, outputMaxBytes: 1024 * 1024 })
}

describe('validateBranchName', () => {
  it('accepts ordinary names', () => {
    expect(validateBranchName('feature/20260923-x')).toBeUndefined()
    expect(validateBranchName('release/1.2')).toBeUndefined()
  })

  it('rejects the usual bad shapes', () => {
    expect(validateBranchName('@')).toBeDefined()
    expect(validateBranchName('.hidden')).toBeDefined()
    expect(validateBranchName('')).toBeDefined()
    expect(validateBranchName('-x')).toBeDefined()
    expect(validateBranchName('a..b')).toBeDefined()
    expect(validateBranchName('a b')).toBeDefined()
    expect(validateBranchName('feature^x')).toBeDefined()
    expect(validateBranchName('x.lock')).toBeDefined()
    expect(validateBranchName('a/@{x')).toBeDefined()
    expect(validateBranchName('ends.')).toBeDefined()
  })
})

describe('listBranches', () => {
  it('reports the current branch first-class and locals sorted', async () => {
    const repo = await createTempRepo()
    try {
      await repo.write('a.txt', 'x\n')
      repo.run(['add', '.'])
      repo.run(['commit', '-m', 'init'])
      repo.run(['branch', 'feature/one'])
      repo.run(['branch', 'feature/two'])
      const list = await listBranches(git(), repo.root, { includeRemotes: false, maxBranches: 200 }, AbortSignal.timeout(5000))
      expect(list.current).toBe('master')
      expect(list.locals.map(branch => branch.name)).toEqual(['master', 'feature/one', 'feature/two'])
      expect(list.remotes).toEqual([])
      expect(list.truncated).toBe(false)
    } finally {
      await repo.dispose()
    }
  })

  it('marks detached HEAD and honors maxBranches', async () => {
    const repo = await createTempRepo()
    try {
      await repo.write('a.txt', 'x\n')
      repo.run(['add', '.'])
      repo.run(['commit', '-m', 'init'])
      repo.run(['branch', 'b1'])
      repo.run(['branch', 'b2'])
      repo.run(['checkout', '--detach', 'HEAD'])
      const list = await listBranches(git(), repo.root, { includeRemotes: false, maxBranches: 2 }, AbortSignal.timeout(5000))
      expect(list.detached).toBe(true)
      expect(list.current).toBeUndefined()
      expect(list.locals).toHaveLength(2)
      expect(list.truncated).toBe(true)
    } finally {
      await repo.dispose()
    }
  })
})

describe('createBranch', () => {
  it('creates and switches, flags duplicates and invalid names', async () => {
    const repo = await createTempRepo()
    try {
      await repo.write('a.txt', 'x\n')
      repo.run(['add', '.'])
      repo.run(['commit', '-m', 'init'])

      const created = await createBranch(git(), repo.root, 'feature/x', {}, AbortSignal.timeout(5000))
      expect(created).toEqual({ ok: true, branch: 'feature/x' })
      expect(repo.run(['branch', '--show-current']).trim()).toBe('feature/x')

      const duplicate = await createBranch(git(), repo.root, 'feature/x', {}, AbortSignal.timeout(5000))
      expect(duplicate).toMatchObject({ ok: false, reason: 'exists', existingBranch: 'feature/x' })

      const invalid = await createBranch(git(), repo.root, 'a..b', {}, AbortSignal.timeout(5000))
      expect(invalid).toMatchObject({ ok: false, reason: 'invalid-name' })

      const from = await createBranch(git(), repo.root, 'from-main', { from: 'master' }, AbortSignal.timeout(5000))
      expect(from).toEqual({ ok: true, branch: 'from-main' })
    } finally {
      await repo.dispose()
    }
  })
})

describe('checkoutBranch', () => {
  it('switches branches and reports git refusals', async () => {
    const repo = await createTempRepo()
    try {
      await repo.write('a.txt', 'x\n')
      repo.run(['add', '.'])
      repo.run(['commit', '-m', 'init'])
      repo.run(['branch', 'feature/one'])

      const switched = await checkoutBranch(git(), repo.root, 'feature/one', {}, AbortSignal.timeout(5000))
      expect(switched).toEqual({ ok: true, branch: 'feature/one' })

      const missing = await checkoutBranch(git(), repo.root, 'no/such/branch', {}, AbortSignal.timeout(5000))
      expect(missing).toMatchObject({ ok: false, reason: 'error' })
    } finally {
      await repo.dispose()
    }
  })
})

describe('checkoutBranch with tracking', () => {
  it('creates a local tracking branch for a remote ref instead of detaching', async () => {
    const repo = await createTempRepo()
    try {
      await repo.write('a.txt', 'x\n')
      repo.run(['add', '.'])
      repo.run(['commit', '-m', 'init'])
      repo.run(['remote', 'add', 'origin', '.'])
      repo.run(['update-ref', 'refs/remotes/origin/feature', 'HEAD'])
      const switched = await checkoutBranch(git(), repo.root, 'origin/feature', { asTracking: { local: 'feature' } }, AbortSignal.timeout(5000))
      expect(switched).toEqual({ ok: true, branch: 'feature' })
      expect(repo.run(['branch', '--show-current']).trim()).toBe('feature')
      const upstream = repo.run(['rev-parse', '--abbrev-ref', 'feature@{upstream}']).trim()
      expect(upstream).toBe('origin/feature')
    } finally {
      await repo.dispose()
    }
  })
})
