/** Branch listing, validation, creation, and checkout — the plumbing under the branch menu. */
import type { GitRunner } from './runner.ts'
import type { BranchInfo, BranchListView, BranchMutationView } from '../wire.ts'

/** for-each-ref format: short name, short hash, subject, separated by an ASCII unit separator. */
const SEP = String.fromCharCode(31)
const REF_FORMAT = `%(refname:short)${SEP}%(objectname:short)${SEP}%(contents:subject)`

function parseForEachRef(output: string): BranchInfo[] {
  const branches: BranchInfo[] = []
  for (const line of output.split('\n')) {
    if (line.trim() === '') continue
    const parts = line.split(SEP)
    const name = parts[0]
    if (name === undefined || name === '') continue
    const commit = parts[1]
    const subject = parts.slice(2).join(SEP)
    branches.push({ name, ...(commit === undefined || commit === '' ? {} : { commit }), ...(subject === '' ? {} : { subject }) })
  }
  return branches
}

/**
 * List local (and optionally remote) branches, current first and never cut by
 * the cap (FR-1.5: the current branch is always in the list).
 * @throws when git fails; a non-repository cwd fails like any other git error.
 */
export async function listBranches(
  git: GitRunner,
  cwd: string,
  opts: { includeRemotes: boolean; maxBranches: number },
  signal: AbortSignal,
): Promise<BranchListView> {
  const currentResult = await git.run(['branch', '--show-current'], { cwd, signal })
  if (currentResult.exitCode !== 0) throw new Error(`git branch failed: ${currentResult.stderr.trim()}`)
  const current = currentResult.stdout.trim()
  const detached = current === ''
  const localsResult = await git.run(['for-each-ref', `--format=${REF_FORMAT}`, 'refs/heads'], { cwd, signal })
  if (localsResult.exitCode !== 0) throw new Error(`git for-each-ref failed: ${localsResult.stderr.trim()}`)
  let remotes: BranchInfo[] = []
  if (opts.includeRemotes) {
    const remotesResult = await git.run(['for-each-ref', `--format=${REF_FORMAT}`, 'refs/remotes'], { cwd, signal })
    if (remotesResult.exitCode === 0) {
      remotes = parseForEachRef(remotesResult.stdout).filter(branch => branch.name !== 'HEAD' && !branch.name.endsWith('/HEAD'))
    }
  }
  const parsed = parseForEachRef(localsResult.stdout)
  // Current branch first, then alphabetical; the cap never drops the current row.
  const ordered = current === ''
    ? parsed
    : [...parsed.filter(branch => branch.name === current), ...parsed.filter(branch => branch.name !== current)]
  const complete = parsed.length + remotes.length
  const cap = Math.max(0, opts.maxBranches)
  const keptLocals = cap === 0 ? [] : ordered.slice(0, cap)
  return {
    ...(current === '' ? {} : { current }),
    ...(detached ? { detached: true as const } : {}),
    locals: keptLocals,
    remotes: remotes.slice(0, Math.max(0, cap - keptLocals.length)),
    truncated: complete > keptLocals.length + remotes.length,
  }
}

/**
 * Client-side branch-name validation; the same rules `git check-ref-format
 * --branch` enforces, so the menu can show a precise error before round-tripping.
 * @returns the error message, or undefined when the name is acceptable.
 */
export function validateBranchName(name: string): string | undefined {
  if (name.trim() === '') return '分支名不能为空'
  if (name === '@') return '"@" 不是有效的分支名'
  if (name.startsWith('-')) return '分支名不能以 "-" 开头'
  if (name.startsWith('/') || name.endsWith('/')) return '分支名不能以 "/" 开头或结尾'
  if (name.endsWith('.')) return '分支名不能以 "." 结尾'
  if (name.split('/').some(part => part.endsWith('.lock'))) return '分支名的任何一段都不能以 ".lock" 结尾'
  if (name.split('/').some(part => part.startsWith('.'))) return '分支名的任何一段都不能以 "." 开头'
  if (/[\s~^:?*[\\\u007f]/.test(name)) return '分支名不能包含空格或 ~ ^ : ? * [ \\ 字符'
  if (name.includes('..')) return '分支名不能包含 ".."'
  if (name.includes('@{')) return '分支名不能包含 "@{"'
  if (name.includes('//')) return '分支名不能包含 "//"'
  return undefined
}

/**
 * Create a branch and check it out (`git checkout -b`).
 * @returns the structured outcome; git's own failure becomes `reason: 'error'`.
 */
export async function createBranch(
  git: GitRunner,
  cwd: string,
  name: string,
  opts: { from?: string },
  signal: AbortSignal,
): Promise<BranchMutationView> {
  const exists = await git.run(['show-ref', '--verify', '--quiet', `refs/heads/${name}`], { cwd, signal })
  if (exists.exitCode === 0) {
    return { ok: false, reason: 'exists', existingBranch: name, message: `分支 ${name} 已存在` }
  }
  const check = await git.run(['check-ref-format', '--branch', name], { cwd, signal })
  if (check.exitCode !== 0) {
    return { ok: false, reason: 'invalid-name', message: '分支名不符合 git 规范' }
  }
  const argv = opts.from === undefined ? ['checkout', '-b', name] : ['checkout', '-b', name, opts.from]
  const created = await git.run(argv, { cwd, signal })
  if (created.exitCode !== 0) {
    const stderr = created.stderr.trim()
    if (/already exists/i.test(stderr)) {
      return { ok: false, reason: 'exists', existingBranch: name, message: `分支 ${name} 已存在` }
    }
    return { ok: false, reason: 'error', message: stderr || '创建分支失败' }
  }
  return { ok: true, branch: name }
}

/**
 * Check out an existing local branch. Git's own refusal (conflicts, unknown
 * ref) becomes `reason: 'error'` with its stderr; guards live in the service
 * layer, which only ever passes verified local branch names here.
 */
export async function checkoutBranch(
  git: GitRunner,
  cwd: string,
  name: string,
  opts: { asTracking?: { local: string } },
  signal: AbortSignal,
): Promise<BranchMutationView> {
  if (opts.asTracking !== undefined) {
    // A remote-tracking ref with no local counterpart: create the local
    // tracking branch (plain `git checkout <remote/x>` would detach HEAD).
    const created = await git.run(['checkout', '-b', opts.asTracking.local, '--track', name], { cwd, signal })
    if (created.exitCode !== 0) {
      return { ok: false, reason: 'error', message: created.stderr.trim() || '切换分支失败' }
    }
    return { ok: true, branch: opts.asTracking.local }
  }
  const switched = await git.run(['checkout', name], { cwd, signal })
  if (switched.exitCode !== 0) {
    return { ok: false, reason: 'error', message: switched.stderr.trim() || '切换分支失败' }
  }
  return { ok: true, branch: name }
}
