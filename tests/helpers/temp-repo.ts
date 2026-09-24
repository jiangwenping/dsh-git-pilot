/** Temporary git repositories for host tests, driven by plain child processes. */
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** One scratch repository. */
export interface TempRepo {
  root: string
  run(args: readonly string[], opts?: { cwd?: string }): string
  write(path: string, content: string): Promise<void>
  dispose(): Promise<void>
}

export async function createTempRepo(): Promise<TempRepo> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-git-pilot-test-'))
  const run = (args: readonly string[], opts?: { cwd?: string }): string =>
    execFileSync('git', args, {
      cwd: opts?.cwd ?? root,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
        GIT_AUTHOR_NAME: 'test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
      },
    })
  run(['init', '--initial-branch=master'])
  return {
    root,
    run,
    async write(path: string, content: string): Promise<void> {
      const absolute = join(root, path)
      await mkdir(absolute.slice(0, absolute.lastIndexOf('/')), { recursive: true })
      await writeFile(absolute, content)
    },
    async dispose(): Promise<void> {
      await rm(root, { recursive: true, force: true })
    },
  }
}

/** The default config the tests run under; override fields per test. */
export function testConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    enabled: true,
    branchChip: true,
    composerBranchRow: true,
    changesPanel: true,
    autoOpenChanges: 'firstTurn',
    remoteBranches: false,
    autoFetch: false,
    timeoutMs: 10_000,
    maxBranches: 200,
    maxFiles: 500,
    maxFileBytes: 2 * 1024 * 1024,
    branchNameTemplate: 'feature/YYYYMMDD-',
    protectedBranches: ['master', 'main', 'release/*'],
    ...overrides,
  }
}
