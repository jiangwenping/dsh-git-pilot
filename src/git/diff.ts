/** Baseline-to-worktree comparisons: numstat parsing, unified-diff parsing, and untracked line counts. */
import { stat, readFile } from 'node:fs/promises'
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

/** Tracked working-tree changes against a baseline commit, keyed by path. */
export async function trackedNumstat(
  git: GitRunner,
  cwd: string,
  base: string,
  signal: AbortSignal,
): Promise<NumstatResult> {
  const result = await git.run(['diff', '--numstat', '-z', '--no-renames', base], { cwd, signal })
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

/** File facts gathered without git, for untracked paths. */
export interface UntrackedFacts {
  lines: number
  binary: boolean
  oversized: boolean
}

/** Count the non-empty lines of an untracked file, honoring the byte cap. */
export async function untrackedFacts(absolutePath: string, maxFileBytes: number): Promise<UntrackedFacts> {
  let size: number
  try {
    size = (await stat(absolutePath)).size
  } catch {
    return { lines: 0, binary: false, oversized: true }
  }
  if (size > maxFileBytes) return { lines: 0, binary: false, oversized: true }
  let buffer: Buffer
  try {
    buffer = await readFile(absolutePath)
  } catch {
    return { lines: 0, binary: false, oversized: true }
  }
  const probeEnd = Math.min(buffer.length, 8192)
  let binary = false
  for (let index = 0; index < probeEnd; index += 1) {
    if (buffer[index] === 0) {
      binary = true
      break
    }
  }
  if (binary) return { lines: 0, binary: true, oversized: false }
  const lines = buffer.toString('utf8').split('\n').filter(line => line.trim() !== '').length
  return { lines, binary: false, oversized: false }
}

/**
 * One file's baseline-to-worktree comparison.
 * @param absolutePath - the file's absolute path, for untracked reads.
 * @param untracked - when true, the file is new to git: its whole content is one added hunk.
 */
export async function fileDiff(
  git: GitRunner,
  cwd: string,
  base: string,
  path: string,
  opts: { absolutePath: string; maxFileBytes: number; untracked: boolean },
  signal: AbortSignal,
): Promise<FileDiffView> {
  if (opts.untracked) {
    const facts = await untrackedFacts(opts.absolutePath, opts.maxFileBytes)
    if (facts.oversized) return { kind: 'oversized', path }
    if (facts.binary) return { kind: 'binary', path }
    let content = ''
    try {
      content = (await readFile(opts.absolutePath)).toString('utf8')
    } catch {
      return { kind: 'text', path, hunks: [] }
    }
    const lines = content.split('\n')
    if (lines.at(-1) === '') lines.pop()
    return {
      kind: 'text',
      path,
      hunks: lines.length === 0 ? [] : [{
        oldStart: 1,
        oldLines: 0,
        newStart: 1,
        newLines: lines.length,
        lines: lines.map(line => `+${line}`),
      }],
    }
  }
  if (opts.maxFileBytes > 0) {
    try {
      const { size } = await stat(opts.absolutePath)
      if (size > opts.maxFileBytes) return { kind: 'oversized', path }
    } catch {
      // A deleted file has no worktree side; the diff still renders deletions.
    }
  }
  const result = await git.run(['diff', '--unified=3', '--no-color', base, '--', path], { cwd, signal, maxBytes: 8 * 1024 * 1024 })
  if (result.exitCode !== 0) throw new Error(`git diff failed: ${result.stderr.trim()}`)
  return { kind: 'text', path, hunks: parseUnifiedDiff(result.stdout), ...(result.truncated ? { truncated: true as const } : {}) }
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
