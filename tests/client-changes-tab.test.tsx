// @vitest-environment jsdom
/** Browser smoke tests: the Changes tab body renders summaries, rows, and badges. */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ChangesTabBody } from '../src/client/changes-tab.tsx'
import type { ChangedFileView, FileDiffView, SessionChangesView } from '../src/wire.ts'
import type { GitPilotApi } from '../src/client/api.ts'

afterEach(cleanup)

const dict: Record<string, string> = {
  'changes.onBranch': 'On {branch}',
  'changes.onDetached': 'On detached HEAD',
  'changes.summary': '{files} file(s) · +{added} −{deleted}',
  'changes.empty': 'This session has not changed any file yet',
  'changes.refresh': 'Refresh',
  'changes.noRepo': 'not a repo',
  'changes.tabTitle': 'Changes',
  'changes.binary': 'binary',
  'changes.oversized': 'too large',
  'changes.gitlink': 'submodule',
  'menu.working': 'Working…',
}

const t = (key: string, params?: Record<string, unknown>): string =>
  (dict[key] ?? key).replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? ''))

function file(partial: Partial<ChangedFileView> & { path: string }): ChangedFileView {
  return { status: 'modified', added: 2, deleted: 1, ...partial }
}

function fakeApi(summary: SessionChangesView | undefined, diff?: FileDiffView): GitPilotApi {
  return {
    status: async () => ({ isRepo: true, branch: 'master', dirtyFiles: 0, added: 0, deleted: 0 }),
    branches: async () => ({ locals: [], remotes: [], truncated: false }),
    uiOptions: async () => ({ remoteBranches: false, branchNameTemplate: 'f/', autoOpenChanges: 'never', changesPanel: true, branchChip: true, composerBranchRow: true }),
    ensureBaseline: async () => undefined,
    sessionChanges: async () => summary,
    sessionFileDiff: async () => diff,
    uncommitted: async () => summary,
    fileDiff: async () => diff,
    createBranch: async () => ({ ok: false, reason: 'error', message: 'unused' }),
    checkout: async () => ({ ok: true, branch: 'x' }),
  } as unknown as GitPilotApi
}

const summary: SessionChangesView = {
  baseline: 'abc1234',
  branch: 'feature/x',
  files: [
    file({ path: 'a.txt' }),
    file({ path: 'logo.png', added: 0, deleted: 0, binary: true }),
    file({ path: 'sub', added: 0, deleted: 0, gitlink: true }),
    file({ path: 'new.txt', status: 'untracked', added: 3, deleted: 0 }),
  ],
  total: 4,
  added: 5,
  deleted: 1,
  truncated: false,
}

function renderTab(api: GitPilotApi) {
  // The body reads its runtime hooks off props; absent hooks take the fallbacks.
  // The default scope is the workspace-wide one, so the stub supplies a cwd.
  const useSessions = (selector: (list: { byId: Record<string, { cwd?: string }> }) => string | undefined): string | undefined =>
    selector({ byId: { s1: { cwd: '/ws' } } })
  return render(<ChangesTabBody api={api} sessionId="s1" t={t as never} useSessions={useSessions} />)
}

describe('ChangesTabBody', () => {
  it('renders the branch line, totals, and one row per file', async () => {
    const { container } = renderTab(fakeApi(summary))
    expect(await screen.findByText('On feature/x')).toBeDefined()
    // The toolbar composes the totals from parts: ± count +added −deleted.
    expect(container.textContent).toContain('±')
    expect(container.textContent).toContain('4')
    expect(container.textContent).toContain('+5')
    expect(container.textContent).toContain('−1')
    expect(screen.getByText('a.txt')).toBeDefined()
    expect(screen.getByText('binary')).toBeDefined()
    expect(screen.getByText('submodule')).toBeDefined()
    expect(screen.getByText('new.txt')).toBeDefined()
  })

  it('shows the empty note when nothing changed', async () => {
    renderTab(fakeApi({ ...summary, files: [], total: 0 }))
    expect(await screen.findByText('This session has not changed any file yet')).toBeDefined()
  })

  it('loads a diff when a row is expanded and re-fetches after refresh', async () => {
    const hunks = [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: [' one', '+two'] }]
    const api = fakeApi(summary, { kind: 'text', path: 'a.txt', hunks })
    const { container } = renderTab(api)
    fireEvent.click(await screen.findByText('a.txt'))
    await waitFor(() => expect(container.textContent).toContain('+two'))
    // Refresh clears the cache; the effect reloads the expanded row's diff.
    fireEvent.click(screen.getByText('Refresh'))
    await waitFor(() => expect(container.textContent).toContain('+two'))
  })

  it('renders nothing meaningful without a session or summary', async () => {
    const { container } = renderTab(fakeApi(undefined))
    await waitFor(() => expect(container.textContent).toBe(''))
  })
})
