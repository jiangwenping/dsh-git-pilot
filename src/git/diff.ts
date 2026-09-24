/** Baseline-to-worktree comparisons: numstat parsing and unified-diff parsing. */
import { stat } from 'node:fs/promises'
import type { GitRunner } from './runner.ts'
import type { ChangedFileView, DiffHunkView, FileDiffView } from '../wire.ts'

/** One `git diff --numstat` entry; `null` counts mark a binary file. */
export interface NumstatEntry {
  added: number | null
  deleted: number | null
  path: string
}

/** Parse `git diff --numstat -z --no-renames`. */
export function parseNumstatZ(output: string): NumstatEntry[] {
  const entries: NumstatEntry[] = []
  for (const record of output.split('\0')) {
    if (record === '') continue
    const fields = record.split('\t')
    const addedField = fields[0]
    const deletedField = fields[1]
    if (addedField === undefined || deletedField === undefined || fields.length < 3) continue
    const path = fields.slice(2).join('\t')
    entries.push({
      added: addedField === '-' ? null : Number(addedField) || 0,
      deleted: deletedField === '-' ? null : Number(deletedField) || 0,
      path,
    })
  }
  return entries
}

/** Tracked working-tree changes against a baseline commit, keyed by path. */
export interface NumstatResult {
  entries: Map<string, NumstatEntry>
  /** True when git's output hit the 8MB cap; totals under-count. */
  truncated: boolean
}

/**
 * Line-count changes from `base` to the current worktree — or, when `tree` is
 * given (a materialized worktree tree), from `base` to that tree, which lets
 * untracked files participate in the comparison.
 */
export async function trackedNumstat(
  git: GitRunner,
  cwd: string,
  base: string,
  tree: string | undefined,
  signal: AbortSignal,
): Promise<NumstatResult> {
  const result = await git.run(['diff', '--numstat', '-z', '--no-renames', base, ...(tree === undefined ? [] : [tree])], { cwd, signal })
  if (result.exitCode !== 0) throw new Error(`git diff --numstat failed: ${result.stderr.trim()}`)
  const entries = new Map(parseNumstatZ(result.stdout).map(entry => [entry.path, entry]))
  return { entries, truncated: result.truncated }
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/** Parse the hunks of a unified diff; everything before the first hunk is dropped. */
export function parseUnifiedDiff(text: string): DiffHunkView[] {
  const hunks: DiffHunkView[] = []
  let current: DiffHunkView | undefined
  for (const line of text.split('\n')) {
    const header = HUNK_HEADER.exec(line)
    if (header) {
      current = {
        oldStart: Number(header[1]),
        oldLines: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]),
        newLines: header[4] === undefined ? 1 : Number(header[4]),
        lines: [],
      }
      hunks.push(current)
      continue
    }
    if (current === undefined) continue
    // `\ No newline at end of file` may sit mid-hunk; it is hunk content, not
    // a terminator. A bare empty line is the split artifact of git's trailing
    // newline, never a body line (empty context lines carry a space prefix).
    if (line === '' || line.startsWith('diff --git ')) {
      current = undefined
      continue
    }
    if (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ') || line.startsWith('\\')) {
      current.lines.push(line)
    }
  }
  return hunks
}

/** One `git diff --name-status` record: the change letter and its path. */
export interface NameStatusEntry {
  letter: 'A' | 'D' | 'M' | 'T' | 'U' | string
  path: string
}

/** Parse `git diff --name-status -z --no-renames <base>`: NUL-separated letter/path pairs. */
export function parseNameStatusZ(output: string): NameStatusEntry[] {
  const parts = output.split('\0')
  const entries: NameStatusEntry[] = []
  for (let index = 0; index < parts.length - 1; index += 1) {
    const letter = parts[index]
    if (letter === undefined || letter.length !== 1) continue
    const path = parts[index + 1]
    if (path === undefined || path === '') continue
    entries.push({ letter, path })
    index += 1
  }
  return entries
}

/** Merge status letters and numstat counts into one changed-file row. */
export function changedFileRow(
  path: string,
  status: ChangedFileView['status'],
  numstat: NumstatEntry | undefined,
): ChangedFileView {
  const binary = numstat !== undefined && numstat.added === null && numstat.deleted === null
  if (binary) return { path, status, added: 0, deleted: 0, binary: true }
  const row: ChangedFileView = {
    path,
    status,
    added: numstat?.added ?? 0,
    deleted: numstat?.deleted ?? 0,
  }
  return row
}
