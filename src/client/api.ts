/** Browser-side client for the git-pilot HTTP routes (exact /api fetch routes). */
import {
  type BranchListView, type BranchMutationView, type CommitOutcomeView, type FileDiffView,
  type GitStatusView, type RevertOutcomeView, type SessionChangesView,
} from '../wire.ts'

/** Client-relevant slice of the plugin configuration. */
export interface GitPilotUiOptions {
  remoteBranches: boolean
  branchNameTemplate: string
  autoOpenChanges: 'never' | 'firstTurn' | 'always'
  changesPanel: boolean
  branchChip: boolean
  composerBranchRow: boolean
}

type Json = Record<string, unknown>

/** Plain-JSON POST to one plugin route; unwraps the { ok, value | error } envelope. */
async function call<T>(layer: 'read' | 'write', endpoint: string, payload: Json): Promise<T> {
  const response = await fetch(`/api/git-pilot/${layer}/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await response.json().catch(() => undefined) as { ok?: boolean; value?: T; error?: { message?: string } } | undefined
  if (!response.ok || body === undefined || body.ok !== true) {
    throw new Error(body?.error?.message ?? `git-pilot ${endpoint} failed (HTTP ${response.status})`)
  }
  return body.value as T
}

/** Browser-side client for the git-pilot Host routes. */
export class GitPilotApi {
  status(workspacePath: string): Promise<GitStatusView> {
    return call('read', 'status', { workspacePath })
  }

  branches(workspacePath: string): Promise<BranchListView> {
    return call('read', 'branches', { workspacePath })
  }

  uiOptions(): Promise<GitPilotUiOptions> {
    return call<GitPilotUiOptions>('read', 'ui-options', {}).catch(() => ({
      remoteBranches: false,
      branchNameTemplate: 'feature/YYYYMMDD-',
      autoOpenChanges: 'firstTurn' as const,
      changesPanel: true,
      branchChip: true,
      composerBranchRow: true,
    }))
  }

  ensureBaseline(sessionId: string, workspacePath?: string): Promise<unknown> {
    return call('read', 'ensure-baseline', { sessionId, ...(workspacePath === undefined ? {} : { workspacePath }) })
  }

  sessionChanges(sessionId: string): Promise<SessionChangesView | undefined> {
    return call('read', 'session-changes', { sessionId })
  }

  sessionFileDiff(sessionId: string, path: string): Promise<FileDiffView | undefined> {
    return call('read', 'session-file-diff', { sessionId, path })
  }

  createBranch(workspacePath: string, name: string, from?: string): Promise<BranchMutationView> {
    return call('write', 'create-branch', { workspacePath, name, ...(from === undefined ? {} : { from }) })
  }

  checkout(workspacePath: string, name: string, opts: { confirm?: readonly string[]; sessionId?: string } = {}): Promise<BranchMutationView> {
    return call('write', 'checkout', {
      workspacePath,
      name,
      ...(opts.confirm === undefined || opts.confirm.length === 0 ? {} : { confirm: [...opts.confirm] }),
      ...(opts.sessionId === undefined ? {} : { sessionId: opts.sessionId }),
    })
  }

  /** Commit the picked files' current content; an empty list is a client-side bug, not a valid request. */
  commit(workspacePath: string, message: string, files: readonly string[]): Promise<CommitOutcomeView> {
    return call('write', 'commit', { workspacePath, message, files: [...files] })
  }

  /** Restore one tracked file to its HEAD content. */
  revertFile(workspacePath: string, path: string): Promise<RevertOutcomeView> {
    return call('write', 'revert-file', { workspacePath, path })
  }

  /** Whole working tree vs HEAD — the uncommitted scope of the Changes tab. */
  uncommitted(workspacePath: string): Promise<SessionChangesView | undefined> {
    return call('read', 'uncommitted', { workspacePath })
  }

  /** One file's worktree-vs-HEAD comparison for the uncommitted scope. */
  fileDiff(workspacePath: string, path: string): Promise<FileDiffView | undefined> {
    return call('read', 'session-file-diff', { workspacePath, path, scope: 'head' })
  }
}
