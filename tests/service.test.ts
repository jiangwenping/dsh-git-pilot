/** Host integration tests: the service — guards, baselines, and cumulative session changes. */
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createGitPilotService, isProtectedBranch, type AgentsRegistryLike, type WorkspaceRegistryLike } from '../src/service.ts'
import type { GitPilotConfig } from '../src/config.ts'
import { createTempRepo, testConfig, type TempRepo } from './helpers/temp-repo.ts'
import { nodeSubprocess } from './helpers/node-subprocess.ts'

function config(overrides: Record<string, unknown> = {}): GitPilotConfig {
  return testConfig(overrides) as unknown as GitPilotConfig
}

function service(opts: {
  repo?: TempRepo
  overrides?: Record<string, unknown>
  registry?: WorkspaceRegistryLike
  agents?: AgentsRegistryLike
} = {}) {
  return createGitPilotService({
    subprocess: nodeSubprocess(),
    config: config(opts.overrides),
    getRegistry: opts.registry === undefined ? undefined : () => opts.registry,
    getAgents: opts.agents === undefined ? undefined : () => opts.agents,
  })
}

async function seedRepo(): Promise<TempRepo> {
  const repo = await createTempRepo()
  await repo.write('a.txt', 'one\ntwo\n')
  repo.run(['add', '.'])
  repo.run(['commit', '-m', 'init'])
  return repo
}

describe('session baseline snapshot (R5-1)', () => {
  it('treats pre-session untracked files as baseline, not session additions', async () => {
    const repo = await seedRepo()
    // Placed BEFORE the first baseline capture: previous behavior counted it
    // as session work (+3 lines); the worktree snapshot puts it in the base.
    await repo.write('scratch/old-work.txt', 'l1\nl2\nl3\n')
    const agents = { list: () => [], get: () => ({ session: { header: { cwd: repo.root } } }) }
    const svc = service({ repo, agents })
    const view = await svc.sessionChanges('s-r51')
    expect(view?.files.some(file => file.path === 'scratch/old-work.txt')).toBe(false)
    // Work created after the baseline still shows up.
    await repo.write('fresh.txt', 'brand new\n')
    const after = await svc.sessionChanges('s-r51')
    expect(after?.files.some(file => file.path === 'fresh.txt')).toBe(true)
    await repo.dispose()
  })
})

describe('isProtectedBranch', () => {
  it('matches exact names and trailing wildcards', () => {
    const patterns = ['master', 'main', 'release/*']
    expect(isProtectedBranch('master', patterns)).toBe(true)
    expect(isProtectedBranch('main', patterns)).toBe(true)
    expect(isProtectedBranch('release/20260923', patterns)).toBe(true)
    expect(isProtectedBranch('feature/x', patterns)).toBe(false)
    expect(isProtectedBranch('maintenance', patterns)).toBe(false)
    // Case-folded matching defends against case-insensitive filesystems.
    expect(isProtectedBranch('MAIN', patterns)).toBe(true)
    expect(isProtectedBranch('Main', patterns)).toBe(true)
  })
})

describe('status and branches', () => {
  it('serves standing and branch lists through the service', async () => {
    const repo = await seedRepo()
    const pilot = service({ repo })
    try {
      const status = await pilot.status(repo.root)
      expect(status.isRepo).toBe(true)
      expect(status.branch).toBe('master')
      const branches = await pilot.branches(repo.root)
      expect(branches.current).toBe('master')
      expect(pilot.status('/definitely/not/a/repo').then(s => s.isRepo)).resolves.toBe(false)
    } finally {
      await repo.dispose()
      pilot.dispose()
    }
  })

  it('answers isRepo false when git is missing', async () => {
    const repo = await seedRepo()
    const broken = createGitPilotService({
      subprocess: {
        async resolveExecutable() { throw new Error('not found') },
        spawn() { throw new Error('never') },
      },
      config: config(),
    })
    try {
      const status = await broken.status(repo.root)
      expect(status.isRepo).toBe(false)
      await expect(broken.sessionChanges('s1')).resolves.toBeUndefined()
    } finally {
      await repo.dispose()
      broken.dispose()
    }
  })
})

describe('branch mutations', () => {
  it('creates a branch and switches to it', async () => {
    const repo = await seedRepo()
    const pilot = service({ repo })
    try {
      const created = await pilot.createBranch(repo.root, 'feature/x', {})
      expect(created).toEqual({ ok: true, branch: 'feature/x' })
      const back = await pilot.checkout(repo.root, 'master', { confirm: ['protected'] })
      expect(back).toEqual({ ok: true, branch: 'master' })
    } finally {
      await repo.dispose()
      pilot.dispose()
    }
  })

  it('guards checkout into protected branches until confirmed', async () => {
    const repo = await seedRepo()
    const pilot = service({ repo })
    try {
      await pilot.createBranch(repo.root, 'feature/x', {})
      const blocked = await pilot.checkout(repo.root, 'master', {})
      expect(blocked).toMatchObject({ ok: false, reason: 'protected' })
      const confirmed = await pilot.checkout(repo.root, 'master', { confirm: ['protected'] })
      expect(confirmed).toEqual({ ok: true, branch: 'master' })
    } finally {
      await repo.dispose()
      pilot.dispose()
    }
  })

  it('guards checkout on a dirty worktree and reports the count', async () => {
    const repo = await seedRepo()
    repo.run(['branch', 'feature/other'])
    const pilot = service({ repo })
    try {
      await repo.write('a.txt', 'one\ntwo\nthree\n')
      const blocked = await pilot.checkout(repo.root, 'feature/other', {})
      expect(blocked).toMatchObject({ ok: false, reason: 'dirty', dirtyFiles: 1 })
    } finally {
      await repo.dispose()
      pilot.dispose()
    }
  })

  it('guards checkout while other sessions share the workspace, honoring exclusion', async () => {
    const repo = await seedRepo()
    repo.run(['branch', 'feature/other'])
    // A session opened in a subdirectory of the workspace counts as sharing it.
    await repo.write('sub/.keep', '')
    repo.run(['add', 'sub/.keep'])
    repo.run(['commit', '-qm', 'sub dir'])
    const agents: AgentsRegistryLike = {
      list: () => [{ session: { id: 'other-session', header: { cwd: `${repo.root}/sub` } } }],
      get: id => id === 'other-session' ? { session: { id: 'other-session', header: { cwd: `${repo.root}/sub` } } } : undefined,
    }
    const pilot = service({ repo, agents })
    try {
      const blocked = await pilot.checkout(repo.root, 'feature/other', { excludeSessionId: 'this-session' })
      expect(blocked).toMatchObject({ ok: false, reason: 'busy-sessions', busySessions: 1 })
      const excluded = await pilot.checkout(repo.root, 'feature/other', { excludeSessionId: 'other-session' })
      expect(excluded).toEqual({ ok: true, branch: 'feature/other' })
    } finally {
      await repo.dispose()
      pilot.dispose()
    }
  })

  it('resets session baselines of the workspace after a successful checkout', async () => {
    const repo = await seedRepo()
    repo.run(['branch', 'feature/other'])
    // The real runtime resolves the session cwd through the agent registry,
    // which is what lets a dropped baseline re-capture on the next read.
    const agents: AgentsRegistryLike = {
      list: () => [],
      get: id => ({ session: { id, header: { cwd: repo.root } } }),
    }
    const pilot = service({ repo, agents })
    try {
      await pilot.ensureBaseline('s1', repo.root)
      await repo.write('a.txt', 'one\ntwo\nthree\n')
      expect((await pilot.sessionChanges('s1'))?.total).toBe(1)
      const switched = await pilot.checkout(repo.root, 'feature/other', { confirm: ['dirty'] })
      expect(switched).toEqual({ ok: true, branch: 'feature/other' })
      // The pending edit belonged to the old branch's baseline; the switch
      // re-baselines, so the carried-over edit counts against the new branch.
      const changes = await pilot.sessionChanges('s1')
      expect(changes?.branch).toBe('feature/other')
      expect(changes?.baseline).toBeDefined()
      expect(changes?.total).toBe(0)
      expect((await pilot.status(repo.root)).branch).toBe('feature/other')
    } finally {
      await repo.dispose()
      pilot.dispose()
    }
  })

  it('restricts mutations to registered workspaces when a registry exists', async () => {
    const repo = await seedRepo()
    const pilot = service({ repo, registry: { list: () => [{ id: 'w1', path: '/somewhere/else' }] } })
    try {
      await expect(pilot.createBranch(repo.root, 'feature/x', {})).rejects.toThrow(/not a registered workspace/)
      const aware = service({ repo, registry: { list: () => [{ id: 'w1', path: repo.root }] } })
      await expect(aware.createBranch(repo.root, 'feature/x', {})).resolves.toEqual({ ok: true, branch: 'feature/x' })
      aware.dispose()
    } finally {
      await repo.dispose()
      pilot.dispose()
    }
  })
})

describe('session baselines and cumulative changes', () => {
  it('sums tracked and untracked changes against the baseline, surviving commits', async () => {
    const repo = await seedRepo()
    const pilot = service({ repo })
    try {
      await pilot.ensureBaseline('s1', repo.root)
      await repo.write('a.txt', 'one\ntwo\nthree\n')
      await repo.write('notes/new.txt', 'n1\nn2\nn3\n\nn4\n')
      let changes = await pilot.sessionChanges('s1')
      expect(changes).toBeDefined()
      expect(changes?.total).toBe(2)
      // Tree-diff numstat counts every line of an untracked file, tracked or not.
      expect(changes?.added).toBe(1 + 5)
      expect(changes?.deleted).toBe(0)
      expect(changes?.branch).toBe('master')

      // The agent commits: baseline semantics keep the session totals stable.
      // One nuance of DR-2: the untracked count skips empty lines, while git's
      // committed numstat counts every line, so the total gains the blank line.
      repo.run(['add', '.'])
      repo.run(['commit', '-m', 'work'])
      changes = await pilot.sessionChanges('s1')
      expect(changes?.total).toBe(2)
      expect(changes?.added).toBe(1 + 5)

      // The work reverts: totals fall back to zero.
      repo.run(['reset', '--hard', 'HEAD~1'])
      changes = await pilot.sessionChanges('s1')
      expect(changes?.total).toBe(0)
      expect(changes?.added).toBe(0)
    } finally {
      await repo.dispose()
      pilot.dispose()
    }
  })

  it('counts deletions and reports per-file statuses', async () => {
    const repo = await seedRepo()
    await repo.write('b.txt', 'gone\n')
    repo.run(['add', '.'])
    repo.run(['commit', '-m', 'add b'])
    const pilot = service({ repo })
    try {
      await pilot.ensureBaseline('s1', repo.root)
      repo.run(['rm', '-q', 'b.txt'])
      await repo.write('a.txt', 'one\n')
      const changes = await pilot.sessionChanges('s1')
      const byPath = new Map(changes?.files.map(file => [file.path, file]))
      expect(byPath.get('b.txt')).toMatchObject({ status: 'deleted', added: 0, deleted: 1 })
      expect(byPath.get('a.txt')).toMatchObject({ status: 'modified', added: 0, deleted: 1 })
      expect(changes?.deleted).toBe(2)
    } finally {
      await repo.dispose()
      pilot.dispose()
    }
  })

  it('serves a unified diff for tracked files and an all-added hunk for untracked ones', async () => {
    const repo = await seedRepo()
    const pilot = service({ repo })
    try {
      await pilot.ensureBaseline('s1', repo.root)
      await repo.write('a.txt', 'one\ntwo\nthree\n')
      await repo.write('new.txt', 'hello\nworld\n')
      const tracked = await pilot.sessionFileDiff('s1', 'a.txt')
      expect(tracked?.kind).toBe('text')
      if (tracked?.kind === 'text') {
        expect(tracked.hunks[0]?.lines).toContain(' two')
        expect(tracked.hunks[0]?.lines).toContain('+three')
      }
      const untracked = await pilot.sessionFileDiff('s1', 'new.txt')
      expect(untracked?.kind).toBe('text')
      if (untracked?.kind === 'text') {
        expect(untracked.hunks).toHaveLength(1)
        expect(untracked.hunks[0]?.lines).toEqual(['+hello', '+world'])
      }
    } finally {
      await repo.dispose()
      pilot.dispose()
    }
  })

  it('returns undefined without a baseline and re-baselines after forgetSession', async () => {
    const repo = await seedRepo()
    const pilot = service({ repo })
    try {
      // No baseline, no agent cwd: nothing to serve.
      await expect(pilot.sessionChanges('never-seen')).resolves.toBeUndefined()
      await pilot.ensureBaseline('s1', repo.root)
      await repo.write('a.txt', 'one\ntwo\nthree\n')
      expect((await pilot.sessionChanges('s1'))?.total).toBe(1)
      // Re-baselining absorbs the current state: the pending edit stops being
      // "session work" because the new baseline includes it.
      pilot.forgetSession('s1')
      await pilot.ensureBaseline('s1', repo.root)
      const rebased = await pilot.sessionChanges('s1')
      expect(rebased?.total).toBe(0)
      expect(rebased?.baseline).toBeDefined()
    } finally {
      await repo.dispose()
      pilot.dispose()
    }
  })

  it('respects maxFiles by capping rows but keeping totals', async () => {
    const repo = await seedRepo()
    const pilot = service({ repo, overrides: { maxFiles: 1 } })
    try {
      await pilot.ensureBaseline('s1', repo.root)
      await repo.write('a.txt', 'one\ntwo\nthree\n')
      await repo.write('new.txt', 'n\n')
      const changes = await pilot.sessionChanges('s1')
      expect(changes?.files).toHaveLength(1)
      expect(changes?.total).toBe(2)
      expect(changes?.truncated).toBe(true)
      expect(changes?.added).toBe(2)
    } finally {
      await repo.dispose()
      pilot.dispose()
    }
  })

  it('marks submodule rows without line counts', async () => {
    const repo = await seedRepo()
    const run = (args: string[], cwd: string): void => {
      execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } })
    }
    // A nested repo added as a submodule: its commit pointer moves as content.
    run(['init', '-q', '--initial-branch=master', 'sub'], repo.root)
    run(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 's'], `${repo.root}/sub`)
    run(['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', './sub', 'sub'], repo.root)
    run(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'add sub'], repo.root)
    const pilot = service({ repo })
    try {
      await pilot.ensureBaseline('s1', repo.root)
      // Move the submodule to a new commit: a pointer change, zero line work.
      await repo.write('sub/s.txt', 's2\n')
      run(['add', 's.txt'], `${repo.root}/sub`)
      run(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 's2'], `${repo.root}/sub`)
      repo.run(['add', 'sub'])
      const changes = await pilot.sessionChanges('s1')
      const row = changes?.files.find(candidate => candidate.path === 'sub')
      expect(row).toMatchObject({ status: 'modified', added: 0, deleted: 0 })
      expect(row?.gitlink).toBe(true)
      expect(changes?.added).toBe(0)
      expect(changes?.total).toBe(1)
    } finally {
      await repo.dispose()
      pilot.dispose()
    }
  })

  it('serves sessions opened in a subdirectory of the repository (R3-4 regression)', async () => {
    const repo = await seedRepo()
    await repo.write('sub/.keep', '')
    repo.run(['add', 'sub/.keep'])
    repo.run(['commit', '-qm', 'sub dir'])
    const pilot = service({ repo })
    try {
      const subdir = `${repo.root}/sub`
      await pilot.ensureBaseline('s1', subdir)
      await repo.write('a.txt', 'one\ntwo\nthree\n')
      await repo.write('sub/new.txt', 'hello\nworld\n')
      const changes = await pilot.sessionChanges('s1')
      expect(changes?.total).toBe(2)
      const byPath = new Map(changes?.files.map(file => [file.path, file]))
      // Root-relative paths with real counts — not "oversized", not empty.
      expect(byPath.get('a.txt')).toMatchObject({ status: 'modified', added: 1 })
      // Tree-diff classifies new files through git's own name-status letter.
      expect(byPath.get('sub/new.txt')).toMatchObject({ status: 'added', added: 2 })
      const diff = await pilot.sessionFileDiff('s1', 'a.txt')
      expect(diff?.kind).toBe('text')
    } finally {
      await repo.dispose()
      pilot.dispose()
    }
  })

  it('reports repo:false for sessions whose workspace is not a repository', async () => {
    const repo = await seedRepo()
    await import('node:fs/promises').then(fs => fs.rm(`${repo.root}/.git`, { recursive: true, force: true }))
    const pilot = service({ repo })
    try {
      await pilot.ensureBaseline('s1', repo.root)
      const changes = await pilot.sessionChanges('s1')
      expect(changes).toMatchObject({ repo: false, total: 0 })
    } finally {
      await repo.dispose()
      pilot.dispose()
    }
  })

  it('anchors the baseline under refs/git-pilot and drops it with the session', async () => {
    const repo = await seedRepo()
    const pilot = service({ repo })
    try {
      await pilot.ensureBaseline('session-with-UUID-like/id', repo.root)
      const sanitized = 'session-with-UUID-like_id'.replace(/[^A-Za-z0-9._-]/g, '_')
      const ref = `refs/git-pilot/${sanitized}`
      expect(repo.run(['rev-parse', '--verify', '--quiet', ref]).trim()).not.toBe('')
      pilot.forgetSession('session-with-UUID-like/id')
      // The ref deletion is fire-and-forget async; give it a beat.
      await new Promise(resolve => setTimeout(resolve, 300))
      // update-ref -d removes the ref; rev-parse then fails.
      let deleted = false
      try { repo.run(['rev-parse', '--verify', '--quiet', ref]) } catch { deleted = true }
      expect(deleted).toBe(true)
    } finally {
      await repo.dispose()
      pilot.dispose()
    }
  })

  it('rejects checkout of ref expressions and pathspec-looking names', async () => {
    const repo = await seedRepo()
    repo.run(['branch', 'feature/other'])
    const pilot = service({ repo })
    try {
      await repo.write('x', 'precious\n')
      const rejected = await pilot.checkout(repo.root, 'x', { confirm: ['dirty', 'busy-sessions', 'protected'] })
      expect(rejected).toMatchObject({ ok: false, reason: 'invalid-name' })
      // The precious uncommitted content is untouched.
      expect(await readFile(`${repo.root}/x`, 'utf8')).toBe('precious\n')
      const refExpr = await pilot.checkout(repo.root, 'refs/heads/feature/other', {})
      expect(refExpr).toMatchObject({ ok: false, reason: 'invalid-name' })
      const headsExpr = await pilot.checkout(repo.root, 'heads/feature/other', {})
      expect(headsExpr).toMatchObject({ ok: false, reason: 'invalid-name' })
    } finally {
      await repo.dispose()
      pilot.dispose()
    }
  })

  it('exposes ui options that mirror the config slice the client needs', async () => {
    const repo = await seedRepo()
    const pilot = service({
      repo,
      overrides: {
        remoteBranches: true,
        branchNameTemplate: 'feat/',
        autoOpenChanges: 'always',
        changesPanel: false,
        branchChip: false,
        composerBranchRow: true,
      },
    })
    try {
      expect(pilot.uiOptions()).toEqual({
        remoteBranches: true,
        branchNameTemplate: 'feat/',
        autoOpenChanges: 'always',
        changesPanel: false,
        branchChip: false,
        composerBranchRow: true,
      })
    } finally {
      await repo.dispose()
      pilot.dispose()
    }
  })
})
