/**
 * Staging, committing, and per-file restore — the write plumbing under the
 * Changes tab. Commit operates on the working tree: the picked paths commit
 * their current content, matching the uncommitted-changes scope the UI shows.
 */
import type { CommitOutcomeView, RevertOutcomeView } from '../wire.ts'
import type { GitRunner } from './runner.ts'

/** Hard cap on one commit message; the input field is bounded, this is the load-bearing check. */
const MAX_COMMIT_MESSAGE_BYTES = 4_096

/**
 * A repo-relative path safe to hand to git as a pathspec after `--`: no
 * absolute form, no parent escape, no Windows separators.
 */
function safePath(path: string): boolean {
  return path !== '' && !path.startsWith('/') && !path.includes('\\') && !path.includes('..')
}

/**
 * Stage the picked paths and commit them with the given message.
 * @returns the new commit's short hash and branch, or a typed failure.
 */
export async function commitChanges(
  git: GitRunner,
  cwd: string,
  opts: { message: string; paths: readonly string[] },
  signal: AbortSignal,
): Promise<CommitOutcomeView> {
  const message = opts.message.trim()
  if (message === '') return { ok: false, reason: 'empty-message', message: 'commit message is empty' }
  if (Buffer.byteLength(message, 'utf8') > MAX_COMMIT_MESSAGE_BYTES) {
    return { ok: false, reason: 'empty-message', message: 'commit message is too long' }
  }
  const seen = new Set<string>()
  const paths = opts.paths.filter(path => {
    if (!safePath(path) || seen.has(path)) return false
    seen.add(path)
    return true
  })
  if (paths.length === 0) return { ok: false, reason: 'nothing', message: 'no files to commit' }
  const add = await git.run(['add', '--', ...paths], { cwd, signal })
  if (add.exitCode !== 0) {
    return { ok: false, reason: 'error', message: `git add failed: ${add.stderr.trim() || add.stdout.trim()}` }
  }
  const commit = await git.run(['commit', '-m', message], { cwd, signal })
  if (commit.exitCode !== 0) {
    const text = `${commit.stdout}\n${commit.stderr}`
    if (/nothing to commit|no changes added/i.test(text)) {
      return { ok: false, reason: 'nothing', message: 'nothing to commit' }
    }
    return { ok: false, reason: 'error', message: `git commit failed: ${commit.stderr.trim() || commit.stdout.trim()}` }
  }
  const head = await git.run(['rev-parse', '--short', 'HEAD'], { cwd, signal })
  const branch = await git.run(['branch', '--show-current'], { cwd, signal })
  const short = head.exitCode === 0 ? head.stdout.trim() : ''
  const current = branch.exitCode === 0 ? branch.stdout.trim() : ''
  return {
    ok: true,
    commit: short,
    ...(current === '' ? {} : { branch: current }),
    committed: paths.length,
  }
}

/**
 * Restore one tracked file to its HEAD content. HEAD is the restore source on
 * purpose: plain `git checkout -- <path>` restores from the index, which would
 * silently keep staged changes (and no-op on a staged new file). Files that
 * HEAD does not know are refused with a distinct reason: a staged new file has
 * no baseline to restore to, and deleting an untracked file on a click needs a
 * stronger confirmation than a row hover affordance.
 */
export async function revertFile(
  git: GitRunner,
  cwd: string,
  path: string,
  signal: AbortSignal,
): Promise<RevertOutcomeView> {
  if (!safePath(path)) return { ok: false, reason: 'error', message: `unsafe path: ${path}` }
  const inHead = await git.run(['ls-tree', '--name-only', 'HEAD', '--', path], { cwd, signal })
  if (inHead.exitCode === 0 && inHead.stdout.trim() !== '') {
    const restore = await git.run(['checkout', 'HEAD', '--', path], { cwd, signal })
    if (restore.exitCode !== 0) {
      return { ok: false, reason: 'error', message: `git checkout failed: ${restore.stderr.trim() || restore.stdout.trim()}` }
    }
    return { ok: true }
  }
  const staged = await git.run(['ls-files', '--error-unmatch', '--', path], { cwd, signal })
  if (staged.exitCode === 0) {
    return { ok: false, reason: 'new-file', message: 'added files cannot be reverted' }
  }
  return { ok: false, reason: 'untracked', message: 'untracked files cannot be reverted' }
}
