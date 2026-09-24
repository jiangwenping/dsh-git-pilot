// @vitest-environment jsdom
/** Browser smoke tests: the branch control renders per standing and opens its menu. */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { BranchControl, type BranchControlProps } from '../src/client/branch-row.tsx'
import type { BranchListView, GitStatusView } from '../src/wire.ts'

afterEach(cleanup)

const t = (key: string): string => key

function fakeApi(status: GitStatusView, branches?: BranchListView) {
  return {
    status: async () => status,
    branches: async () => branches ?? { locals: [], remotes: [], truncated: false },
    uiOptions: async () => ({ remoteBranches: false, branchNameTemplate: 'feature/YYYYMMDD-', autoOpenChanges: 'never' as const, changesPanel: true }),
    ensureBaseline: async () => undefined,
    sessionChanges: async () => undefined,
    sessionFileDiff: async () => undefined,
    createBranch: async () => ({ ok: false, reason: 'error' as const, message: 'unused' }),
    checkout: async () => ({ ok: true, branch: 'x' }),
  }
}

const clean: GitStatusView = { isRepo: true, branch: 'master', dirtyFiles: 0, added: 0, deleted: 0 }
const dirty: GitStatusView = { isRepo: true, branch: 'feature/x', dirtyFiles: 3, added: 5, deleted: 1 }
const outside: GitStatusView = { isRepo: false, dirtyFiles: 0, added: 0, deleted: 0 }

function renderControl(status: GitStatusView, branches?: BranchListView) {
  const props: BranchControlProps = {
    api: fakeApi(status, branches) as never,
    cwd: '/repo',
    variant: 'row',
    sessionId: 's1',
    t: t as never,
  }
  return render(<BranchControl {...props} />)
}

describe('BranchControl', () => {
  it('renders nothing outside a repository', () => {
    const { container } = renderControl(outside)
    expect(container.textContent).toBe('')
  })

  it('shows the current branch and a dirty badge that opens Changes', async () => {
    const opened: string[] = []
    const { container } = render(<BranchControl
      api={fakeApi(dirty) as never}
      cwd="/repo"
      variant="row"
      sessionId="s1"
      t={t as never}
      onOpenChanges={sessionId => { opened.push(sessionId) }}
    />)
    expect(await screen.findByText('feature/x')).toBeDefined()
    const badge = container.querySelector('button[title="3"]')
    expect(badge).not.toBeNull()
    fireEvent.click(badge!)
    expect(opened).toEqual(['s1'])
  })

  it('opens the menu, lists branches, marks the current one', async () => {
    const list: BranchListView = {
      current: 'master',
      locals: [
        { name: 'feature/one', commit: 'aaa' },
        { name: 'master', commit: 'bbb' },
      ],
      remotes: [],
      truncated: false,
    }
    const { container } = renderControl(clean, list)
    fireEvent.click(await screen.findByTestId('git-pilot-branch-trigger'))
    expect(await screen.findByPlaceholderText('menu.searchPlaceholder')).toBeDefined()
    expect(screen.getByText('feature/one')).toBeDefined()
    // The current branch carries the check mark inside the menu list.
    expect(container.textContent).toContain('✓')
  })

  it('shows a display-only project chip when a workspace title is available', async () => {
    const props: BranchControlProps = {
      api: fakeApi(clean) as never,
      cwd: '/repo',
      workspaceTitle: 'ins-bd-internal',
      variant: 'row',
      sessionId: 's1',
      t: t as never,
    }
    render(<BranchControl {...props} />)
    expect(await screen.findByText('ins-bd-internal')).toBeDefined()
    expect(await screen.findByTestId('git-pilot-branch-trigger')).toBeDefined()
  })

  it('toggles the menu closed when the trigger is clicked again', async () => {
    renderControl(clean)
    const trigger = await screen.findByTestId('git-pilot-branch-trigger')
    fireEvent.click(trigger)
    expect(screen.getByPlaceholderText('menu.searchPlaceholder')).toBeDefined()
    fireEvent.click(trigger)
    expect(screen.queryByPlaceholderText('menu.searchPlaceholder')).toBeNull()
  })

  it('closes the menu when clicking outside the control', async () => {
    const props: BranchControlProps = {
      api: fakeApi(clean) as never,
      cwd: '/repo',
      variant: 'row',
      sessionId: 's1',
      t: t as never,
    }
    render(<><div data-testid="outside" /><BranchControl {...props} /></>)
    fireEvent.click(await screen.findByTestId('git-pilot-branch-trigger'))
    expect(screen.getByPlaceholderText('menu.searchPlaceholder')).toBeDefined()
    fireEvent.mouseDown(screen.getByTestId('outside'))
    expect(screen.queryByPlaceholderText('menu.searchPlaceholder')).toBeNull()
  })

  it('hides the badge when the Changes panel is unreachable', () => {
    const { container } = renderControl(dirty)
    expect(container.querySelector('button[title="3"]')).toBeNull()
  })
})
