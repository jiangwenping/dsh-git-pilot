/** Working-tree standing of one repository: branch, upstream, and dirtiness. */
import type { GitRunner } from './runner.ts'
import type { GitStatusView } from '../wire.ts'

/** Porcelain v2 header field for the checked-out branch when HEAD is detached. */
const DETACHED = '(detached)'

interface StatusParse {
  branch?: string
  detached: boolean
  commit?: string
  upstream?: string
  ahead?: number
  behind?: number
  dirtyFiles: number
}

/** Parse `git status --porcelain=v2 --branch -z --no-renames`. */
export function parseStatusV2Z(output: string): StatusParse {
  const parsed: StatusParse = { detached: false, dirtyFiles: 0 }
  for (const record of output.split('\0')) {
    if (record === '') continue
    if (record.startsWith('# branch.head ')) {
      const value = record.slice('# branch.head '.length)
      if (value === DETACHED) parsed.detached = true
      else parsed.branch = value
      continue
    }
    if (record.startsWith('# branch.oid ')) {
      const value = record.slice('# branch.oid '.length)
      if (value !== '(initial)') parsed.commit = value.slice(0, 7)
      continue
    }
    if (record.startsWith('# branch.upstream ')) {
      parsed.upstream = record.slice('# branch.upstream '.length)
      continue
    }
    if (record.startsWith('# branch.ab ')) {
      const match = /^\+(\S+) -(\S+)$/.exec(record.slice('# branch.ab '.length))
      if (match) {
        parsed.ahead = Number(match[1])
        parsed.behind = Number(match[2])
      }
      continue
    }
    if (record.startsWith('1 ') || record.startsWith('2 ') || record.startsWith('u ') || record.startsWith('? ')) {
      parsed.dirtyFiles += 1
    }
  }
  return parsed
}

/** Sum the added/deleted lines of a `git diff --numstat -z --no-renames` output. */
export function sumNumstatZ(output: string): { added: number; deleted: number } {
  let added = 0
  let deleted = 0
  for (const record of output.split('\0')) {
    if (record === '') continue
    const fields = record.split('\t')
    const addedField = fields[0]
    const deletedField = fields[1]
    if (addedField === undefined || deletedField === undefined) continue
    if (addedField !== '-') added += Number(addedField) || 0
    if (deletedField !== '-') deleted += Number(deletedField) || 0
  }
  return { added, deleted }
}

/** One per-path record of `git status --porcelain=v2 -z --no-renames`. */
export type StatusEntry =
  | { path: string; index: string; worktree: string; /** Index/worktree modes, e.g. `100644` or `160000` (a submodule). */ modes?: [string, string, string] }
  | { path: string; untracked: true }
  | { path: string; unmerged: true }

/** The mode trio that marks a submodule (gitlink) record. */
const GITLINK_MODE = '160000'

/** Whether a tracked record points at a submodule commit rather than file content. */
export function isGitlink(entry: StatusEntry): boolean {
  if ('modes' in entry && entry.modes !== undefined) {
    return entry.modes.some(mode => mode === GITLINK_MODE)
  }
  return false
}

/** Extract per-path statuses; `--no-renames` keeps every record single-path. */
export function parseStatusEntriesZ(output: string): StatusEntry[] {
  const entries: StatusEntry[] = []
  for (const record of output.split('\0')) {
    if (record === '' || record.startsWith('#')) continue
    if (record.startsWith('? ')) {
      const path = record.slice(2)
      if (path !== '') entries.push({ path, untracked: true })
      continue
    }
    const tokens = record.split(' ')
    const kind = tokens[0]
    if (kind === '1') {
      const xy = tokens[1] ?? '??'
      const path = tokens.slice(8).join(' ')
      if (path !== '') {
        // `1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>`
        const modes: [string, string, string] = [tokens[3] ?? '', tokens[4] ?? '', tokens[5] ?? '']
        entries.push({ path, index: xy[0] ?? '?', worktree: xy[1] ?? '?', modes })
      }
      continue
    }
    if (kind === 'u') {
      const path = tokens.slice(10).join(' ')
      if (path !== '') entries.push({ path, unmerged: true })
    }
  }
  return entries
}



/**
 * Read the working-tree standing of one directory.
 * @returns `isRepo: false` outside a repository; every other git failure throws.
 */
export async function repositoryStatus(git: GitRunner, cwd: string, signal: AbortSignal): Promise<GitStatusView> {
  const inside = await git.run(['rev-parse', '--is-inside-work-tree'], { cwd, signal })
  if (inside.exitCode !== 0 || inside.stdout.trim() !== 'true') {
    return { isRepo: false, dirtyFiles: 0, added: 0, deleted: 0 }
  }
  // symbolic-ref is the detached-HEAD authority: the porcelain sentinel string
  // "(detached)" is a legal branch name.
  const symbolic = await git.run(['symbolic-ref', '--quiet', 'HEAD'], { cwd, signal })
  const detached = symbolic.exitCode !== 0
  const status = await git.run(['status', '--porcelain=v2', '--branch', '-z', '--no-renames', '--ignore-submodules=dirty'], { cwd, signal })
  if (status.exitCode !== 0) throw new Error(`git status failed: ${status.stderr.trim()}`)
  const parsed = parseStatusV2Z(status.stdout)
  let added = 0
  let deleted = 0
  // A repository with no commits has nothing tracked; skip the diff entirely.
  if (parsed.commit !== undefined) {
    // Tracked changes against HEAD, staged and unstaged together. Dirty
    // submodule content is phantom work; pointer moves still show.
    const numstat = await git.run(['diff', '--numstat', '-z', '--no-renames', '--ignore-submodules=dirty', 'HEAD'], { cwd, signal })
    if (numstat.exitCode === 0) ({ added, deleted } = sumNumstatZ(numstat.stdout))
  }
  const branch = detached ? undefined : parsed.branch
  return {
    isRepo: true,
    ...(branch === undefined ? {} : { branch }),
    ...(detached ? { detached: true as const } : {}),
    ...(parsed.commit === undefined ? {} : { commit: parsed.commit }),
    ...(parsed.upstream === undefined ? {} : { upstream: parsed.upstream }),
    ...(parsed.ahead === undefined ? {} : { ahead: parsed.ahead }),
    ...(parsed.behind === undefined ? {} : { behind: parsed.behind }),
    dirtyFiles: parsed.dirtyFiles,
    added,
    deleted,
  }
}
