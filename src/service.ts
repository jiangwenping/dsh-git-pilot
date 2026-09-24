/**
 * The `gitPilot` service: git status and branches for workspaces, guarded
 * branch mutations, and per-session cumulative change summaries against the
 * baseline captured when the session opened. Sessions are keyed by SessionId;
 * a baseline records the repository toplevel plus a `git stash create` commit
 * (falling back to HEAD), anchored under `refs/git-pilot/<session>` so an
 * aggressive `git gc` cannot erase it, so session totals mean "this session's
 * work" — including edits made through Bash — and rewrite churn never
 * double-counts.
 */
import { randomUUID } from 'node:crypto'
import { isAbsolute, join, resolve } from 'node:path'
import { realpathSync, rmSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { GitRunner, resolveGitExecutable, type SubprocessLike } from './git/runner.ts'
import { changedFileRow, parseNameStatusZ, parseUnifiedDiff, trackedNumstat } from './git/diff.ts'
import { repositoryStatus } from './git/status.ts'
import { createBranch as gitCreateBranch, checkoutBranch as gitCheckout, listBranches as gitListBranches } from './git/branches.ts'
import { commitChanges as gitCommit, revertFile as gitRevertFile } from './git/commit.ts'
import { parseStatusEntriesZ, isGitlink } from './git/status.ts'
import type { GitPilotConfig } from './config.ts'
import type {
  BranchListView, BranchMutationView, ChangedFileView, CommitOutcomeView, FileDiffView, GitStatusView,
  RevertOutcomeView, SessionChangesView,
} from './wire.ts'

/** Structural subset of the workspace registry; optional (absent in headless profiles). */
export interface WorkspaceRegistryLike {
  list(): readonly { id: unknown; path: string; title?: string }[]
}

/** Structural subset of the live-agent registry; optional. */
export interface AgentsRegistryLike {
  list(): readonly { session?: { id?: string; header?: { cwd?: string } } }[]
  get(id: string): { session?: { id?: string; header?: { cwd?: string } } } | undefined
}

/** Confirmation tokens a mutation caller may pre-acknowledge. */
export type CheckoutConfirm = 'dirty' | 'busy-sessions' | 'protected'

export interface GitPilotDeps {
  subprocess: SubprocessLike
  config: GitPilotConfig
  /** Lazy so load order never decides whether the path guard exists. */
  getRegistry?: (() => WorkspaceRegistryLike | undefined) | undefined
  getAgents?: (() => AgentsRegistryLike | undefined) | undefined
  log?: ((message: string) => void) | undefined
}

/** Baseline facts captured once per session. */
export interface SessionBaseline {
  /** Canonical repository toplevel; every repo command runs from here. */
  cwd: string
  isRepo: boolean
  /** Commit object covering the worktree at capture; absent in an empty repository. */
  baseCommit?: string
  branch?: string
  /**
   * Private temp index (created OUTSIDE the worktree) seeded from the baseline
   * commit; every comparison materializes the current worktree through it, so
   * untracked files join the diff without the user's real index being touched.
   */
  indexFile?: string
  capturedAt: number
}

export interface GitPilotService {
  status(workspacePath: string, signal?: AbortSignal): Promise<GitStatusView>
  branches(workspacePath: string, signal?: AbortSignal): Promise<BranchListView>
  createBranch(workspacePath: string, name: string, opts: { from?: string }, signal?: AbortSignal): Promise<BranchMutationView>
  checkout(workspacePath: string, name: string, opts: { confirm?: readonly CheckoutConfirm[]; excludeSessionId?: string }, signal?: AbortSignal): Promise<BranchMutationView>
  commit(workspacePath: string, message: string, paths: readonly string[], signal?: AbortSignal): Promise<CommitOutcomeView>
  revertFile(workspacePath: string, path: string, signal?: AbortSignal): Promise<RevertOutcomeView>
  ensureBaseline(sessionId: string, workspacePath: string | undefined, signal?: AbortSignal): Promise<SessionBaseline | undefined>
  /** The configuration slice the browser half needs for its own behavior. */
  uiOptions(): {
    remoteBranches: boolean
    branchNameTemplate: string
    autoOpenChanges: 'never' | 'firstTurn' | 'always'
    changesPanel: boolean
    branchChip: boolean
    composerBranchRow: boolean
  }
  sessionChanges(sessionId: string, signal?: AbortSignal): Promise<SessionChangesView | undefined>
  sessionFileDiff(sessionId: string, path: string, signal?: AbortSignal): Promise<FileDiffView | undefined>
  /** The whole working tree vs HEAD — the uncommitted scope the Changes tab defaults to. */
  uncommittedChanges(workspacePath: string, signal?: AbortSignal): Promise<SessionChangesView | undefined>
  /** One file's worktree-vs-HEAD comparison for the uncommitted scope. */
  uncommittedFileDiff(workspacePath: string, path: string, signal?: AbortSignal): Promise<FileDiffView | undefined>
  forgetSession(sessionId: string): void
  dispose(): void
}

/** Normalize a path for comparisons: absolute, resolved, forward slashes, no trailing slash. */
function normalizePath(path: string): string {
  const absolute = isAbsolute(path) ? path : resolve(path)
  return resolve(absolute).replaceAll('\\', '/').replace(/\/+$/, '')
}

/**
 * Like {@link normalizePath}, but symlinks in the recorded path resolve first
 * so a workspace reached through a link compares equal to its canonical form;
 * an unreachable path falls back to the lexical normalization.
 */
function canonicalizePath(path: string): string {
  try {
    return normalizePath(realpathSync(path))
  } catch {
    return normalizePath(path)
  }
}

/** Glob-lite protected-branch match (case-folded): exact, or a trailing `/*` wildcard. */
export function isProtectedBranch(name: string, patterns: readonly string[]): boolean {
  const folded = name.toLowerCase()
  return patterns.some(pattern => {
    if (pattern === '') return false
    const lowered = pattern.toLowerCase()
    if (lowered.endsWith('/*')) return folded.startsWith(lowered.slice(0, -1))
    return folded === lowered
  })
}

/** Whether `candidate` is the workspace itself or lives underneath it. */
export function isInsideWorkspace(workspace: string, candidate: string): boolean {
  if (candidate === workspace) return true
  return candidate.startsWith(`${workspace}/`)
}

/**
 * The well-known empty tree object: the comparison root for baselines of
 * repositories with no commits yet (everything untracked is an addition).
 */
const EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

/** A revision operand must never be mistaken for a git option. */
function isSafeRevision(rev: string): boolean {
  return rev !== '' && !rev.startsWith('-') && !/\s/.test(rev) && rev.length <= 250
}

/** The session's anchor ref; SessionIds are sanitized to ref-safe characters. */
export function baselineRefName(sessionId: string): string {
  return `refs/git-pilot/${sessionId.replace(/[^A-Za-z0-9._-]/g, '_')}`
}

/**
 * Canonical repository toplevel of a directory, or `undefined` outside a
 * repository — the shared front door of both change scopes.
 */
async function resolveToplevel(git: GitRunner, cwd: string, signal: AbortSignal): Promise<string | undefined> {
  const inside = await git.run(['rev-parse', '--is-inside-work-tree', '--show-toplevel'], { cwd, signal })
  if (inside.exitCode !== 0 || !inside.stdout.startsWith('true')) return undefined
  return canonicalizePath(inside.stdout.split('\n')[1]?.trim() ?? cwd)
}

/**
 * Snapshot the whole worktree — tracked modifications and untracked files,
 * ignored files still excluded — into a commit object through a private temp
 * index. The user's real index is never touched, and the temp index lives
 * outside the worktree so `add -A` cannot pick it up. Returns '' when the
 * tree matches HEAD (a clean tree needs no snapshot) or when any step fails;
 * callers fall back to `stash create` and HEAD.
 */
async function snapshotWorktree(git: GitRunner, toplevel: string, indexFile: string, signal: AbortSignal): Promise<string> {
  const head = await git.run(['rev-parse', '--verify', 'HEAD'], { cwd: toplevel, signal })
  const hasHead = head.exitCode === 0
  const headHash = hasHead ? head.stdout.trim() : ''
  let headTreeHash = ''
  if (hasHead) {
    const headTree = await git.run(['rev-parse', 'HEAD^{tree}'], { cwd: toplevel, signal })
    headTreeHash = headTree.exitCode === 0 ? headTree.stdout.trim() : ''
  }
  const seeded = await git.run(hasHead ? ['read-tree', headHash] : ['read-tree', '--empty'], { cwd: toplevel, signal, env: { GIT_INDEX_FILE: indexFile } })
  if (seeded.exitCode !== 0) return ''
  const add = await git.run(['add', '-A'], { cwd: toplevel, signal, env: { GIT_INDEX_FILE: indexFile } })
  if (add.exitCode !== 0) return ''
  const tree = await git.run(['write-tree'], { cwd: toplevel, signal, env: { GIT_INDEX_FILE: indexFile } })
  if (tree.exitCode !== 0) return ''
  const worktreeTree = tree.stdout.trim()
  // A worktree identical to HEAD needs no snapshot commit — HEAD is the baseline.
  if (worktreeTree === headTreeHash) return ''
  const parent = hasHead ? ['-p', headHash] : []
  const commit = await git.run(['commit-tree', worktreeTree, ...parent, '-m', 'dsh-git-pilot session baseline'], { cwd: toplevel, signal, env: { GIT_INDEX_FILE: indexFile } })
  if (commit.exitCode !== 0) return ''
  return commit.stdout.trim()
}

/** Create the service. Git resolution is lazy and shared; failures degrade to `null`. */
export function createGitPilotService(deps: GitPilotDeps): GitPilotService {
  const lifetime = new AbortController()
  // Insertion-ordered; the oldest entry is evicted past `maxBaselines` so RPC
  // spam with synthetic session ids cannot grow the map unbounded.
  const baselines = new Map<string, Promise<SessionBaseline | undefined>>()
  const maxBaselines = 200
  let runnerPromise: Promise<GitRunner | null> | undefined

  const log = deps.log ?? ((): void => {})
  const registry = (): WorkspaceRegistryLike | undefined => deps.getRegistry?.()
  const agents = (): AgentsRegistryLike | undefined => deps.getAgents?.()

  const runner = (): Promise<GitRunner | null> => {
    runnerPromise ??= resolveGitExecutable(deps.subprocess, lifetime.signal).then(executable => {
      if (executable === null) {
        log('dsh-git-pilot: git is unavailable; surfaces stay hidden')
        return null
      }
      return new GitRunner(deps.subprocess, executable, { timeoutMs: deps.config.timeoutMs, outputMaxBytes: 8 * 1024 * 1024 })
    })
    return runnerPromise
  }

  /** True when the path is a registered workspace (always true without a registry). */
  const isRegisteredWorkspace = (normalized: string): boolean => {
    const known = registry()
    if (known === undefined) return true
    return known.list().some(workspace => canonicalizePath(workspace.path) === normalized)
  }

  /** Mutations are restricted to registered workspaces whenever a registry exists. */
  const assertRegisteredWorkspace = (workspacePath: string): string => {
    const normalized = canonicalizePath(workspacePath)
    if (isRegisteredWorkspace(normalized)) return normalized
    throw new Error('dsh-git-pilot: path is not a registered workspace')
  }

  // The ref lives in the baseline's own repository, so the deletion must run
  // there — a bare HOME cwd is not a git repository and git would refuse.
  const dropBaselineRef = (sessionId: string, cwd: string): void => {
    void (async () => {
      const git = await runner()
      if (git === null) return
      await git.run(['update-ref', '-d', baselineRefName(sessionId)], { cwd, signal: lifetime.signal }).catch(() => undefined)
    })()
  }

  /** Release a baseline's artifacts: the anchor ref is git-side, the private index is a tmpdir file. */
  const dropBaselineFiles = (baseline: SessionBaseline | undefined): void => {
    if (baseline?.indexFile !== undefined) rmSync(baseline.indexFile, { force: true })
  }

  /** Drop every baseline (and its anchor ref) whose working directory is the workspace or inside it. */
  const resetBaselinesForWorkspace = async (workspace: string): Promise<void> => {
    for (const [sessionId, baseline] of [...baselines]) {
      try {
        const captured = await baseline
        if (captured !== undefined && isInsideWorkspace(workspace, captured.cwd)) {
          baselines.delete(sessionId)
          dropBaselineRef(sessionId, captured.cwd)
          dropBaselineFiles(captured)
        }
      } catch {
        baselines.delete(sessionId)
      }
    }
  }

  const captureBaseline = async (sessionId: string, cwd: string, signal: AbortSignal): Promise<SessionBaseline> => {
    const git = await runner()
    if (git === null) return { cwd: canonicalizePath(cwd), isRepo: false, capturedAt: Date.now() }
    const inside = await git.run(['rev-parse', '--is-inside-work-tree', '--show-toplevel'], { cwd, signal })
    if (inside.exitCode !== 0 || !inside.stdout.startsWith('true')) {
      return { cwd: canonicalizePath(cwd), isRepo: false, capturedAt: Date.now() }
    }
    // Paths in status/diff output are repo-root-relative no matter which
    // subdirectory the session was opened in; anchor every repo command there.
    const toplevel = canonicalizePath(inside.stdout.split('\n')[1]?.trim() ?? cwd)
    // Baseline = a full snapshot of the worktree INCLUDING untracked files, so
    // untracked files that predate the session are baseline content, not
    // session additions (R5-1). `git stash create` cannot include untracked
    // work (its flags parse as the message), so the snapshot runs through a
    // private temp index; '' = nothing beyond HEAD, and HEAD is the baseline.
    const indexFile = join(tmpdir(), `dsh-git-pilot-index-${randomUUID()}`)
    let baseCommit = await snapshotWorktree(git, toplevel, indexFile, signal)
    if (baseCommit === '') {
      const stash = await git.run(['stash', 'create'], { cwd: toplevel, signal })
      baseCommit = stash.exitCode === 0 ? stash.stdout.trim() : ''
    }
    const branchProbe = await git.run(['branch', '--show-current'], { cwd: toplevel, signal })
    if (baseCommit === '') {
      const head = await git.run(['rev-parse', 'HEAD'], { cwd: toplevel, signal })
      baseCommit = head.exitCode === 0 ? head.stdout.trim() : ''
    }
    if (baseCommit !== '') {
      // Anchor the baseline: an unanchored stash-create commit is dangling and
      // a `git gc --prune` would turn every later diff into `bad object`.
      await git.run(['update-ref', baselineRefName(sessionId), baseCommit], { cwd: toplevel, signal }).catch(() => undefined)
    }
    return {
      cwd: toplevel,
      isRepo: true,
      ...(baseCommit === '' ? {} : { baseCommit }),
      ...(branchProbe.exitCode === 0 && branchProbe.stdout.trim() !== '' ? { branch: branchProbe.stdout.trim() } : {}),
      indexFile,
      capturedAt: Date.now(),
    }
  }

  /**
   * Re-attach a resumed session to the baseline a previous host run anchored.
   * The `refs/git-pilot/*` anchors live in the repository, so they outlive the
   * process; without this recovery a restart would re-baseline every session
   * at the current state and the session's earlier work would vanish from its
   * summary. No anchor (a fresh session) recovers nothing.
   */
  const recoverBaseline = async (sessionId: string, workspacePath: string, signal: AbortSignal): Promise<SessionBaseline | undefined> => {
    const git = await runner()
    if (git === null) return undefined
    const inside = await git.run(['rev-parse', '--is-inside-work-tree', '--show-toplevel'], { cwd: workspacePath, signal })
    if (inside.exitCode !== 0 || !inside.stdout.startsWith('true')) return undefined
    const toplevel = canonicalizePath(inside.stdout.split('\n')[1]?.trim() ?? workspacePath)
    const anchor = await git.run(['rev-parse', '--verify', '--quiet', baselineRefName(sessionId)], { cwd: toplevel, signal })
    if (anchor.exitCode !== 0) return undefined
    const baseCommit = anchor.stdout.trim()
    if (baseCommit === '') return undefined
    return { cwd: toplevel, isRepo: true, baseCommit, capturedAt: Date.now() }
  }

  const ensureBaseline = async (sessionId: string, workspacePath: string | undefined, signal?: AbortSignal): Promise<SessionBaseline | undefined> => {
    const existing = baselines.get(sessionId)
    if (existing !== undefined) {
      // True LRU, not FIFO: a hit re-queues the entry so an active old session
      // is never evicted by newer ones (its summary would silently reset).
      baselines.delete(sessionId)
      baselines.set(sessionId, existing)
      return existing
    }
    if (workspacePath === undefined || workspacePath === '') return undefined
    // Baselines of unknown directories are a read-channel DoS surface: a path
    // must be a registered workspace or the session's own recorded cwd — the
    // mere existence of the session does not vouch for an arbitrary directory.
    const agentCwd = agents()?.get(sessionId)?.session?.header?.cwd
    const pathAllowed = isRegisteredWorkspace(canonicalizePath(workspacePath))
      || (agentCwd !== undefined && canonicalizePath(agentCwd) === canonicalizePath(workspacePath))
    if (!pathAllowed) return undefined
    const effectiveSignal = signal ?? lifetime.signal
    // A previous run's anchor wins over a fresh capture: the session's work
    // from before a host restart stays in its summary.
    const recovered = await recoverBaseline(sessionId, workspacePath, effectiveSignal)
    if (recovered !== undefined) {
      admitBaseline(sessionId, Promise.resolve(recovered))
      return recovered
    }
    try {
      return await admitBaseline(sessionId, captureBaseline(sessionId, workspacePath, effectiveSignal))
    } catch (error) {
      baselines.delete(sessionId)
      log(`dsh-git-pilot: baseline capture failed for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }

  /** Evict the oldest entry past the cap, then admit one baseline promise. */
  const admitBaseline = (sessionId: string, captured: Promise<SessionBaseline | undefined>): Promise<SessionBaseline | undefined> => {
    while (baselines.size >= maxBaselines) {
      const oldest = baselines.keys().next().value
      if (oldest === undefined) break
      const evicted = baselines.get(oldest)
      baselines.delete(oldest)
      void evicted?.then(baseline => dropBaselineFiles(baseline)).catch(() => undefined)
    }
    baselines.set(sessionId, captured)
    return captured
  }

  /**
   * A dead baseline (gc'd anchor, rebased HEAD) re-captures once instead of
   * failing forever. The retried operation receives the RE-CAPTURED baseline —
   * running it again with the closure's old object would just fail again.
   */
  const withBaselineRecovery = async <T>(sessionId: string, baseline: SessionBaseline, run: (b: SessionBaseline) => Promise<T>, signal: AbortSignal): Promise<T> => {
    try {
      return await run(baseline)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/bad object|unusable repository/i.test(message)) throw error
      baselines.delete(sessionId)
      dropBaselineRef(sessionId, baseline.cwd)
      dropBaselineFiles(baseline)
      log(`dsh-git-pilot: baseline lost for ${sessionId}; re-capturing (${message})`)
      const recaptured = await captureBaseline(sessionId, baseline.cwd, lifetime.signal)
      if (!recaptured.isRepo) throw error
      baselines.set(sessionId, Promise.resolve(recaptured))
      return run(recaptured)
    }
  }

  const sessionContext = async (sessionId: string, signal?: AbortSignal): Promise<SessionBaseline | undefined> => {
    const fromAgent = agents()?.get(sessionId)?.session?.header?.cwd
    return ensureBaseline(sessionId, fromAgent, signal)
  }

  const service: GitPilotService = {
    async status(workspacePath, signal = lifetime.signal): Promise<GitStatusView> {
      const git = await runner()
      const normalized = canonicalizePath(workspacePath)
      if (git === null) return { isRepo: false, dirtyFiles: 0, added: 0, deleted: 0 }
      return repositoryStatus(git, normalized, signal)
    },

    async branches(workspacePath, signal = lifetime.signal): Promise<BranchListView> {
      const git = await runner()
      if (git === null) return { locals: [], remotes: [], truncated: false }
      const normalized = canonicalizePath(workspacePath)
      if (deps.config.autoFetch && isRegisteredWorkspace(normalized)) {
        // Best effort; a failed fetch (offline, no upstream) must not block the
        // menu. Never fetch for paths outside the registered workspaces.
        await git.run(['fetch', '--prune', '--quiet'], { cwd: normalized, signal }).catch(() => undefined)
      }
      return gitListBranches(git, normalized, { includeRemotes: deps.config.remoteBranches, maxBranches: deps.config.maxBranches }, signal)
    },

    async createBranch(workspacePath, name, opts, signal = lifetime.signal): Promise<BranchMutationView> {
      const git = await runner()
      if (git === null) return { ok: false, reason: 'error', message: 'git 不可用' }
      const normalized = assertRegisteredWorkspace(workspacePath)
      if (opts.from !== undefined && !isSafeRevision(opts.from)) {
        return { ok: false, reason: 'invalid-name', message: '起点版本不合法' }
      }
      return gitCreateBranch(git, normalized, name, opts, signal)
    },

    async checkout(workspacePath, name, opts, signal = lifetime.signal): Promise<BranchMutationView> {
      const git = await runner()
      if (git === null) return { ok: false, reason: 'error', message: 'git 不可用' }
      const normalized = assertRegisteredWorkspace(workspacePath)
      const confirm = new Set<CheckoutConfirm>(opts.confirm ?? [])

      // Only real branches may be checked out — never pathspecs, options, or
      // hashes (a `git checkout <path>` would silently revert that file).
      const localProbe = await git.run(['show-ref', '--verify', '--quiet', `refs/heads/${name}`], { cwd: normalized, signal })
      const remoteProbe = localProbe.exitCode !== 0
        ? await git.run(['rev-parse', '--verify', '--quiet', `refs/remotes/${name}`], { cwd: normalized, signal })
        // Not probed: the local hit already answered. The literal 1 reads as
        // "probe failed" at the checks below.
        : { exitCode: 1 }
      const isLocal = localProbe.exitCode === 0
      const isRemote = !isLocal && remoteProbe.exitCode === 0
      if (!isLocal && !isRemote) {
        return { ok: false, reason: 'invalid-name', message: `${name} 不是本地或远程分支` }
      }
      // The protected guard looks at the branch that will end up checked out.
      const guardName = isRemote ? (name.includes('/') ? name.split('/').slice(1).join('/') : name) : name
      if (isRemote) {
        // `origin/HEAD` resolves as a symbolic ref but is not a switchable
        // branch name.
        if (name === 'HEAD' || guardName === 'HEAD') {
          return { ok: false, reason: 'invalid-name', message: `${name} 不是可切换的分支` }
        }
        // A local branch with the same name already exists: switching to the
        // remote must not collide with `checkout -b` — offer the local twin.
        const twin = await git.run(['show-ref', '--verify', '--quiet', `refs/heads/${guardName}`], { cwd: normalized, signal })
        if (twin.exitCode === 0) {
          return { ok: false, reason: 'exists', existingBranch: guardName, message: `本地分支 ${guardName} 已存在` }
        }
      }
      if (isProtectedBranch(guardName, deps.config.protectedBranches) && !confirm.has('protected')) {
        return { ok: false, reason: 'protected', message: `${guardName} 是受保护分支` }
      }

      const standing = await repositoryStatus(git, normalized, signal)
      if (standing.isRepo && standing.dirtyFiles > 0 && !confirm.has('dirty')) {
        return { ok: false, reason: 'dirty', dirtyFiles: standing.dirtyFiles, message: '工作区有未提交的改动' }
      }
      if (agents() !== undefined && !confirm.has('busy-sessions')) {
        const normalizedCwd = canonicalizePath(normalized)
        const sharing = agents()!.list().filter(agent => {
          const session = agent.session
          if (session === undefined || session.header?.cwd === undefined) return false
          if (opts.excludeSessionId !== undefined && session.id === opts.excludeSessionId) return false
          // Sessions opened in a subdirectory of the workspace count too.
          return isInsideWorkspace(normalizedCwd, canonicalizePath(session.header.cwd))
        })
        if (sharing.length > 0) {
          return { ok: false, reason: 'busy-sessions', busySessions: sharing.length, message: '还有其他会话正在使用此项目' }
        }
      }

      const switched = isRemote
        // A remote-tracking ref with no local twin: create the local tracking
        // branch (plain `git checkout origin/x` would detach HEAD).
        ? await gitCheckout(git, normalized, name, { asTracking: { local: guardName } }, signal)
        : await gitCheckout(git, normalized, name, {}, signal)
      // §8 Q1 default: the switch resets "session work" — every session on
      // this workspace re-baselines at its next sessionChanges() call.
      if (switched.ok) await resetBaselinesForWorkspace(normalized)
      return switched
    },

    async commit(workspacePath, message, paths, signal = lifetime.signal): Promise<CommitOutcomeView> {
      const git = await runner()
      if (git === null) return { ok: false, reason: 'error', message: 'git 不可用' }
      const normalized = assertRegisteredWorkspace(workspacePath)
      return gitCommit(git, normalized, { message, paths }, signal)
    },

    async revertFile(workspacePath, path, signal = lifetime.signal): Promise<RevertOutcomeView> {
      const git = await runner()
      if (git === null) return { ok: false, reason: 'error', message: 'git 不可用' }
      const normalized = assertRegisteredWorkspace(workspacePath)
      return gitRevertFile(git, normalized, path, signal)
    },

    ensureBaseline,

    uiOptions(): {
      remoteBranches: boolean
      branchNameTemplate: string
      autoOpenChanges: 'never' | 'firstTurn' | 'always'
      changesPanel: boolean
      branchChip: boolean
      composerBranchRow: boolean
    } {
      return {
        remoteBranches: deps.config.remoteBranches,
        branchNameTemplate: deps.config.branchNameTemplate,
        autoOpenChanges: deps.config.autoOpenChanges,
        changesPanel: deps.config.changesPanel,
        branchChip: deps.config.branchChip,
        composerBranchRow: deps.config.composerBranchRow,
      }
    },

    async sessionChanges(sessionId, signal = lifetime.signal): Promise<SessionChangesView | undefined> {
      const git = await runner()
      if (git === null) return undefined
      const baseline = await sessionContext(sessionId, signal)
      if (baseline === undefined) return undefined
      if (!baseline.isRepo) {
        // Known non-repository: the tab renders the explanation instead of nothing.
        return { repo: false, files: [], total: 0, added: 0, deleted: 0, truncated: false }
      }
      return withBaselineRecovery(sessionId, baseline, (b) => collectChanges(git, b, signal), signal)
    },

    async sessionFileDiff(sessionId, path, signal = lifetime.signal): Promise<FileDiffView | undefined> {
      const git = await runner()
      if (git === null) return undefined
      const baseline = await sessionContext(sessionId, signal)
      if (baseline === undefined) return undefined
      if (!baseline.isRepo) return undefined
      return withBaselineRecovery(sessionId, baseline, (b) => buildFileDiff(git, b, path, signal), signal)
    },

    async uncommittedChanges(workspacePath, signal = lifetime.signal): Promise<SessionChangesView | undefined> {
      const git = await runner()
      if (git === null) return undefined
      // Content-level reads are registry-gated like writes: the file list and
      // per-file diffs of an arbitrary local directory must not leave through
      // an authenticated page (R5-6).
      const normalized = assertRegisteredWorkspace(workspacePath)
      const toplevel = await resolveToplevel(git, normalized, signal)
      if (toplevel === undefined) return { repo: false, files: [], total: 0, added: 0, deleted: 0, truncated: false }
      const head = await git.run(['rev-parse', 'HEAD'], { cwd: toplevel, signal })
      const baseCommit = head.exitCode === 0 ? head.stdout.trim() : undefined
      // A synthetic baseline pinned at HEAD turns the session comparator into
      // the uncommitted-scope comparator without duplicating its logic.
      return collectChanges(git, {
        cwd: toplevel,
        isRepo: true,
        ...(baseCommit === undefined || baseCommit === '' ? {} : { baseCommit }),
        capturedAt: Date.now(),
      }, signal)
    },

    async uncommittedFileDiff(workspacePath, path, signal = lifetime.signal): Promise<FileDiffView | undefined> {
      const git = await runner()
      if (git === null) return undefined
      const normalized = assertRegisteredWorkspace(workspacePath)
      const toplevel = await resolveToplevel(git, normalized, signal)
      if (toplevel === undefined) return undefined
      const head = await git.run(['rev-parse', 'HEAD'], { cwd: toplevel, signal })
      const baseCommit = head.exitCode === 0 ? head.stdout.trim() : undefined
      return buildFileDiff(git, {
        cwd: toplevel,
        isRepo: true,
        ...(baseCommit === undefined || baseCommit === '' ? {} : { baseCommit }),
        capturedAt: Date.now(),
      }, path, signal)
    },

    forgetSession(sessionId): void {
      const pending = baselines.get(sessionId)
      baselines.delete(sessionId)
      void (async () => {
        const captured = await pending?.catch(() => undefined)
        if (captured === undefined) return
        if (captured.isRepo === true) dropBaselineRef(sessionId, captured.cwd)
        dropBaselineFiles(captured)
      })()
    },

    dispose(): void {
      lifetime.abort()
      for (const [, pending] of baselines) {
        void pending.then(captured => dropBaselineFiles(captured)).catch(() => undefined)
      }
      baselines.clear()
    },
  }

  /** Materialize the current worktree as a tree through the session's private index. */
  const worktreeTree = async (git: GitRunner, baseline: SessionBaseline, signal: AbortSignal): Promise<string | undefined> => {
    if (baseline.indexFile === undefined) return undefined
    const seed = baseline.baseCommit === undefined ? ['read-tree', '--empty'] : ['read-tree', baseline.baseCommit]
    const read = await git.run(seed, { cwd: baseline.cwd, signal, env: { GIT_INDEX_FILE: baseline.indexFile } })
    if (read.exitCode !== 0) return undefined
    const add = await git.run(['add', '-A'], { cwd: baseline.cwd, signal, env: { GIT_INDEX_FILE: baseline.indexFile } })
    if (add.exitCode !== 0) return undefined
    const write = await git.run(['write-tree'], { cwd: baseline.cwd, signal, env: { GIT_INDEX_FILE: baseline.indexFile } })
    if (write.exitCode !== 0) return undefined
    return write.stdout.trim()
  }

  /**
   * The per-turn comparison for one live baseline: the baseline tree vs the
   * worktree tree materialized through the session's private index. Comparing
   * tree against tree lets untracked files join the diff with exact numstat
   * counts (pre-session untracked files are baseline content, so only real
   * session work appears), with no per-file reads beyond git's own.
   */
  async function collectChanges(git: GitRunner, baseline: SessionBaseline, signal: AbortSignal): Promise<SessionChangesView | undefined> {
    const base = baseline.baseCommit
    const tree = await worktreeTree(git, baseline, signal)
    if (tree === undefined) return undefined
    const from = base ?? EMPTY_TREE_HASH
    const statusResult = await git.run(['status', '--porcelain=v2', '-z', '--no-renames', '--ignore-submodules=dirty'], { cwd: baseline.cwd, signal })
    if (statusResult.exitCode !== 0) throw new Error(`git status failed: ${statusResult.stderr.trim()}`)
    const statusEntries = parseStatusEntriesZ(statusResult.stdout)
    const unmergedPaths = new Set(statusEntries.filter(entry => 'unmerged' in entry).map(entry => entry.path))
    const tracked = new Map<string, 'modified' | 'added' | 'deleted' | 'unmerged'>()
    const nameStatus = await git.run(['diff', '--name-status', '-z', '--no-renames', '--ignore-submodules=dirty', from, tree], { cwd: baseline.cwd, signal })
    if (nameStatus.exitCode !== 0) throw new Error(`git diff --name-status failed: ${nameStatus.stderr.trim()}`)
    for (const entry of parseNameStatusZ(nameStatus.stdout)) {
      tracked.set(entry.path, entry.letter === 'A' ? 'added' : entry.letter === 'D' ? 'deleted' : entry.letter === 'U' || unmergedPaths.has(entry.path) ? 'unmerged' : 'modified')
    }
    const counted = await trackedNumstat(git, baseline.cwd, from, tree, signal)
    const numstat = counted.entries
    const numstatTruncated = counted.truncated
    const branchProbe = await git.run(['branch', '--show-current'], { cwd: baseline.cwd, signal })
    const branch = branchProbe.exitCode === 0 ? branchProbe.stdout.trim() : ''

    const rows: ChangedFileView[] = []
    for (const [path, status] of tracked) {
      // A submodule row is a moved commit pointer, not line work: keep the
      // row, drop the misleading numstat counts.
      if (gitlinkPaths(statusEntries, path)) rows.push({ path, status, added: 0, deleted: 0, gitlink: true })
      else rows.push(changedFileRow(path, status, numstat.get(path)))
    }
    rows.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)

    // numstat covers every row (tree diff needs no per-file reads), so the
    // totals stay complete even when the list hits its cap.
    const files: ChangedFileView[] = []
    let added = 0
    let deleted = 0
    let truncated = numstatTruncated
    const cap = Math.max(0, deps.config.maxFiles)
    for (const row of rows) {
      added += row.added
      deleted += row.deleted
      if (files.length < cap) files.push(row)
      else truncated = true
    }
    return {
      ...(base === undefined ? {} : { baseline: base.slice(0, 7) }),
      ...(branch === '' ? { detached: true as const } : { branch }),
      files,
      total: rows.length,
      added,
      deleted,
      truncated,
    }
  }

  /** One file's baseline-to-worktree comparison through the worktree tree. */
  async function buildFileDiff(git: GitRunner, baseline: SessionBaseline, path: string, signal: AbortSignal): Promise<FileDiffView | undefined> {
    const base = baseline.baseCommit
    const tree = baseline.indexFile === undefined ? undefined : await worktreeTree(git, baseline, signal)
    if (tree === undefined) return undefined
    const from = base ?? EMPTY_TREE_HASH
    const counted = await trackedNumstat(git, baseline.cwd, from, tree, signal)
    const entry = counted.entries.get(path)
    if (entry === undefined) return undefined
    const absolutePath = join(baseline.cwd, path)
    if (entry.added === null && entry.deleted === null) return { kind: 'binary', path }
    if (deps.config.maxFileBytes > 0) {
      try {
        const { size } = await stat(absolutePath)
        if (size > deps.config.maxFileBytes) return { kind: 'oversized', path }
      } catch {
        // A deleted file has no worktree side; the diff still renders deletions.
      }
    }
    const result = await git.run(['diff', '--unified=3', '--no-color', from, tree, '--', path], { cwd: baseline.cwd, signal, maxBytes: 8 * 1024 * 1024 })
    if (result.exitCode !== 0) throw new Error(`git diff failed: ${result.stderr.trim()}`)
    return { kind: 'text', path, hunks: parseUnifiedDiff(result.stdout), ...(result.truncated ? { truncated: true as const } : {}) }
  }

  return service
}

/** Whether the status records mark this path as a submodule (gitlink). */
function gitlinkPaths(entries: ReturnType<typeof parseStatusEntriesZ>, path: string): boolean {
  return entries.some(entry => isGitlink(entry) && entry.path === path)
}
