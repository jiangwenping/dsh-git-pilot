/**
 * Types and channel names shared by the Host and browser halves. Everything
 * here crosses the connection-RPC boundary as plain JSON, so both halves may
 * keep structural, version-tolerant views of it.
 */

/**
 * Channel names MUST match the runtime's `/^\/[A-Za-z0-9._~-]+$/` (absolute,
 * no colon) — `connection.assertChannel` throws otherwise and the host half
 * dies at registration. Colons are explicitly not allowed.
 */

/** Read channel: never mutates the repository. */
export const GIT_PILOT_READ_CHANNEL = '/git-pilot-read'
/** Write channel: branch creation and checkout, user-initiated only. */
export const GIT_PILOT_WRITE_CHANNEL = '/git-pilot-write'

/** One RPC answer; mirrors the connection transport's own result shape. */
export interface GitPilotRpcResult<T = unknown> {
  ok: boolean
  value?: T
  error?: { code?: string; message: string; details?: Record<string, unknown> }
}

/** Minimal connection face the browser half needs. */
export interface GitPilotClientConnection {
  rpc: {
    call(channel: string, endpoint: string, payload: unknown): Promise<GitPilotRpcResult>
  }
}

/** Working-tree standing of one workspace, as the composer chips show it. */
export interface GitStatusView {
  isRepo: boolean
  /** Current branch short name; absent when detached or not a repository. */
  branch?: string
  /** Present when HEAD is detached; `commit` then names the checked-out commit. */
  detached?: true
  /** Short hash of the current commit; absent in an empty repository. */
  commit?: string
  /** Upstream short name, e.g. `origin/main`; absent without one. */
  upstream?: string
  /** Commits the upstream lacks. */
  ahead?: number
  /** Commits the local branch lacks. */
  behind?: number
  /** Changed-path count over staged, unstaged, and untracked entries. */
  dirtyFiles: number
  added: number
  deleted: number
}

/** One branch of the branch menu. */
export interface BranchInfo {
  /** Short ref name, e.g. `feature/20260923-x`. */
  name: string
  /** Short commit hash. */
  commit?: string
  /** Commit subject line. */
  subject?: string
}

/** The branch menu's data. */
export interface BranchListView {
  /** Current branch short name; absent when detached or not a repository. */
  current?: string
  detached?: true
  locals: BranchInfo[]
  remotes: BranchInfo[]
  /** True when the list hit `maxBranches` and rows were dropped. */
  truncated: boolean
}

/** Why a mutation did not run; the menu turns each into its own confirmation or copy. */
export type BranchMutationBlock = 'exists' | 'invalid-name' | 'dirty' | 'busy-sessions' | 'protected' | 'error'

/** Outcome of create/checkout. */
export type BranchMutationView =
  | { ok: true; branch: string }
  | {
    ok: false
    reason: BranchMutationBlock
    message: string
    /** Changed-path count, for the dirty confirmation. */
    dirtyFiles?: number
    /** Live session count sharing the workspace, for the busy confirmation. */
    busySessions?: number
    /** The existing branch, for the exists case. */
    existingBranch?: string
  }

/** The result of committing files picked in the Changes tab. */
export type CommitOutcomeView =
  | { ok: true; commit: string; branch?: string; committed: number }
  | { ok: false; reason: 'nothing' | 'empty-message' | 'error'; message: string }

/** The result of restoring one file to its HEAD content. */
export type RevertOutcomeView =
  | { ok: true }
  | { ok: false; reason: 'untracked' | 'new-file' | 'error'; message: string }

/** Change kind of one file against the session baseline. */
export type ChangeStatus = 'modified' | 'added' | 'deleted' | 'unmerged' | 'untracked'

/** One file the session changed. */
export interface ChangedFileView {
  /** Path relative to the workspace root, slash-separated. */
  path: string
  status: ChangeStatus
  /** Lines added; `0` for binary or oversized files. */
  added: number
  /** Lines deleted; `0` for binary or oversized files. */
  deleted: number
  /** The file holds a NUL byte; counts are absent. */
  binary?: true
  /** The file exceeded `maxFileBytes`; counts are absent. */
  oversized?: true
  /** The path is a submodule whose commit pointer moved; counts are absent. */
  gitlink?: true
}

/** Cumulative changes of one Session against its baseline. */
export interface SessionChangesView {
  /** Present-and-false when the workspace is not a git repository. */
  repo?: false
  /** Short hash of the baseline commit; absent when the repository had no commits at capture. */
  baseline?: string
  branch?: string
  detached?: true
  files: ChangedFileView[]
  /** Complete changed-file count, including files omitted by the cap. */
  total: number
  added: number
  deleted: number
  /** True when `files` hit `maxFiles` and rows were dropped. */
  truncated: boolean
}

/** One unified-diff hunk with three context lines; every line keeps its prefix. */
export interface DiffHunkView {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

/** One file's baseline-to-worktree comparison. */
export type FileDiffView =
  | { kind: 'text'; path: string; hunks: DiffHunkView[]; truncated?: true }
  | { kind: 'binary'; path: string }
  | { kind: 'oversized'; path: string }
