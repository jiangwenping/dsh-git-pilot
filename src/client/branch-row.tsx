/**
 * The composer branch control: chip or row, with the search/create/confirm
 * menu. Presentation rides the shared primitives (MenuSurface material, Input,
 * Pill, Button, the shared iconography) and the plugin stylesheet, so the
 * surface follows the app's theme tokens exactly like a shipped menu.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  Button,
  IconBranchOutlineRegular,
  IconCheckOutlineRegular,
  IconChevronDownOutlineRegular,
  IconFolderCloseMedium,
  IconPlusOutlineRegular,
  IconSearchOutlineRegular,
  Input,
  MenuGroup,
  MenuSurface,
  observeStickyMenuGroups,
  Pill,
  useAnchoredPosition,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { validateBranchName } from '../git/branches.ts'
import { DEFAULT_BRANCH_TEMPLATE, renderBranchTemplate } from '../branch-template.ts'
import type { BranchListView, BranchMutationView, GitStatusView } from '../wire.ts'
import type { GitPilotApi, GitPilotUiOptions } from './api.ts'
import type { GitPilotKey } from './locales.ts'

/** Everything the control needs beyond standard session props, injected per occurrence. */
export interface BranchControlInject {
  api: GitPilotApi
  /** The session's working directory, read fresh from the sessions store. */
  cwd?: string
  /** The workspace title to show as a display-only project chip. */
  workspaceTitle?: string
  /** Open this session's Changes tab; absent when the right Sidebar service is missing. */
  onOpenChanges?: (sessionId: string) => void
  variant: 'row' | 'chip'
}

export interface BranchControlProps extends BranchControlInject {
  sessionId?: string
  t: (key: GitPilotKey, params?: Record<string, unknown>) => string
}

type ConfirmReason = 'dirty' | 'busy-sessions' | 'protected'

interface ConfirmState {
  branch: string
  reasons: ConfirmReason[]
  message: string
}

function branchDisplayName(status: GitStatusView | undefined, t: BranchControlProps['t']): string | undefined {
  if (status === undefined || !status.isRepo) return undefined
  if (status.detached) return `${status.commit ?? ''} ${t('chip.detached')}`.trim()
  return status.branch
}

/**
 * One branch row: the shared menu cell with a trailing check for the branch
 * that is checked out. `radio` semantics let assistive tech read the current
 * branch as the selected option of the list.
 */
function BranchRow({
  name, detail, current, onSelect, t,
}: {
  name: string
  detail?: string
  current: boolean
  onSelect: (name: string) => void
  t: BranchControlProps['t']
}): ReactNode {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={current}
      className="dsh-git-pilot-row"
      title={detail ?? name}
      onClick={() => onSelect(name)}
    >
      <span className="dsh-git-pilot-rowLabel">{name}</span>
      {current ? (
        <span aria-label={t('menu.current')} style={{ display: 'inline-flex', flex: 'none' }}>
          <IconCheckOutlineRegular />
        </span>
      ) : null}
    </button>
  )
}

/** The shared control behind both mounts. */
export function BranchControl(props: BranchControlProps): ReactNode {
  const { api, cwd, onOpenChanges, variant, sessionId, t } = props
  const [status, setStatus] = useState<GitStatusView | undefined>()
  const [open, setOpen] = useState(false)
  const [branches, setBranches] = useState<BranchListView | undefined>()
  const [filter, setFilter] = useState('')
  const [creating, setCreating] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [confirming, setConfirming] = useState<ConfirmState | undefined>()
  const [options, setOptions] = useState<GitPilotUiOptions | undefined>()
  const autoOpenedRef = useRef(new Set<string>())
  // Dirty-state memory keyed per session+workspace: a dirty→dirty switch
  // between two workspaces must not suppress the 'always' auto-open.
  const lastDirtyRef = useRef<Record<string, number>>({})
  const statusRequestRef = useRef(0)
  const branchesRequestRef = useRef(0)
  const anchorRef = useRef<HTMLSpanElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  // Anchored, viewport-clamped popup geometry (the shared overlay hook).
  const position = useAnchoredPosition({ open, anchorRef, panelRef, gap: 4, margin: 12 })

  const refreshStatus = useCallback((path: string | undefined) => {
    if (path === undefined || path === '') {
      statusRequestRef.current += 1
      setStatus(undefined)
      return
    }
    const request = ++statusRequestRef.current
    api.status(path)
      .then(standing => { if (request === statusRequestRef.current) setStatus(standing) })
      .catch(() => {
        if (request === statusRequestRef.current) setStatus({ isRepo: false, dirtyFiles: 0, added: 0, deleted: 0 })
      })
  }, [api])

  // Standing + baseline: re-resolve when the workspace changes, and refresh on focus.
  // A workspace/session switch invalidates everything the open menu shows:
  // stale listings, in-flight loads, and leftover create/confirm/error state.
  const cwdRef = useRef(cwd)
  cwdRef.current = cwd
  useEffect(() => {
    setBranches(undefined)
    setConfirming(undefined)
    setOpen(false)
    setError(undefined)
    setCreating(false)
    setNameDraft('')
    setFilter('')
    refreshStatus(cwd)
    if (cwd !== undefined && sessionId !== undefined) api.ensureBaseline(sessionId, cwd).catch(() => undefined)
  }, [api, cwd, sessionId, refreshStatus])
  useEffect(() => {
    const onFocus = (): void => { refreshStatus(cwd) }
    window.addEventListener('focus', onFocus)
    return () => { window.removeEventListener('focus', onFocus) }
  }, [cwd, refreshStatus])

  // The plugin's own UI options: fetched once per mount.
  useEffect(() => {
    api.uiOptions().then(setOptions).catch(() => undefined)
  }, [api])

  // Dirty observations open the Changes tab: once per session for
  // firstTurn, on every clean→dirty transition for always. Waits for the
  // options round-trip so `never` cannot be beaten by an early status.
  useEffect(() => {
    if (sessionId === undefined || onOpenChanges === undefined) return
    if (options === undefined) return
    if (!options.changesPanel) return
    if (status === undefined || !status.isRepo) return
    const dirtyKey = `${String(sessionId ?? '')}@${cwd ?? ''}`
    const dirty = status.dirtyFiles > 0
    const previous = lastDirtyRef.current[dirtyKey] ?? 0
    lastDirtyRef.current = { ...lastDirtyRef.current, [dirtyKey]: dirty ? status.dirtyFiles : 0 }
    if (!dirty) return
    if (options.autoOpenChanges === 'never') return
    if (options.autoOpenChanges === 'always') {
      // Stay quiet while the worktree stays dirty; re-arm only after clean.
      if (previous > 0) return
    } else if (autoOpenedRef.current.has(sessionId)) {
      return
    }
    autoOpenedRef.current.add(sessionId)
    onOpenChanges(sessionId)
  }, [sessionId, onOpenChanges, options, status])

  // Clicking outside the control or the card closes it; Escape does too.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent): void => {
      if (event.target instanceof Node === false) return
      if (anchorRef.current?.contains(event.target) === true) return
      if (panelRef.current?.contains(event.target) === true) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // Sticky group headings share the house observer; absent observers degrade
  // to plain sticky headings, which the shipped component already handles.
  useEffect(() => {
    const viewport = viewportRef.current
    if (!open || viewport === null) return
    return observeStickyMenuGroups(viewport)
  }, [open, confirming, creating, error, branches])

  const loadBranches = useCallback((path: string | undefined) => {
    if (path === undefined || path === '') return
    const request = ++branchesRequestRef.current
    api.branches(path)
      .then(list => {
        if (request !== branchesRequestRef.current) return
        // A response from a workspace we already left must not fill the menu.
        if (cwdRef.current !== path) return
        setBranches(list); setError(undefined)
      })
      .catch(reason => {
        if (request !== branchesRequestRef.current) return
        setError(reason instanceof Error ? reason.message : String(reason))
      })
  }, [api])

  const openMenu = (): void => {
    if (cwd === undefined) return
    if (open) {
      // The trigger toggles: a second click (or tap) dismisses the menu.
      setOpen(false)
      return
    }
    setOpen(true)
    setFilter('')
    setConfirming(undefined)
    setError(undefined)
    setCreating(false)
    setNameDraft('')
    loadBranches(cwd)
  }

  const finishMutation = (result: BranchMutationView, branch: string): boolean => {
    if (result.ok) {
      setConfirming(undefined)
      setOpen(false)
      setPending(false)
      refreshStatus(cwd)
      // The Host dropped this session's baseline with the switch; re-arm it
      // against the new branch so the next summary starts from zero.
      if (sessionId !== undefined && cwd !== undefined) api.ensureBaseline(sessionId, cwd).catch(() => undefined)
      return true
    }
    setPending(false)
    if (result.reason === 'dirty' || result.reason === 'busy-sessions' || result.reason === 'protected') {
      const reasons = [...confirming?.reasons ?? [], result.reason]
      const message = result.reason === 'dirty'
        ? t('menu.dirtyConfirm', { count: result.dirtyFiles ?? 0 })
        : result.reason === 'busy-sessions'
          ? t('menu.busyConfirm', { count: result.busySessions ?? 0 })
          : t('menu.protectedConfirm', { name: branch })
      setConfirming({ branch, reasons, message })
      return false
    }
    setError(result.message)
    return false
  }

  const switchTo = async (branch: string, extraConfirm: readonly ConfirmReason[] = []): Promise<void> => {
    if (cwd === undefined || pending) return
    setPending(true)
    setError(undefined)
    try {
      finishMutation(await api.checkout(cwd, branch, { confirm: [...extraConfirm], sessionId }), branch)
    } catch (reason) {
      setPending(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const createAndSwitch = async (): Promise<void> => {
    if (cwd === undefined || pending) return
    const name = nameDraft.trim()
    const invalid = validateBranchName(name)
    if (invalid !== undefined) {
      setError(invalid)
      return
    }
    setPending(true)
    setError(undefined)
    try {
      const result = await api.createBranch(cwd, name)
      if (!result.ok && result.reason === 'exists') {
        setPending(false)
        setConfirming({ branch: name, reasons: [], message: t('menu.switchTo') })
        return
      }
      finishMutation(result, name)
    } catch (reason) {
      setPending(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const current = branchDisplayName(status, t)
  if (current === undefined) return null
  const template = renderBranchTemplate(options?.branchNameTemplate ?? DEFAULT_BRANCH_TEMPLATE)
  const query = filter.trim().toLowerCase()
  const locals = (branches?.locals ?? []).filter(branch => query === '' || branch.name.toLowerCase().includes(query))
  const remotes = (branches?.remotes ?? []).filter(branch => query === '' || branch.name.toLowerCase().includes(query))
  const prefilledName = nameDraft !== '' ? nameDraft : (filter.trim() !== '' ? filter.trim() : template)

  // Arrow walking on the search box moves focus across the card's buttons —
  // the shared menu's four-key walk, driven from the input.
  const onSearchKeyDown = (event: ReactKeyboardEvent): void => {
    if (event.key === 'Escape') {
      setOpen(false)
      return
    }
    if (event.key === 'Enter') {
      if (!creating && filter.trim() !== '') {
        setCreating(true)
        setNameDraft(filter.trim())
        return
      }
      if (creating) void createAndSwitch()
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const buttons = Array.from(viewportRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
    if (buttons.length === 0) return
    event.preventDefault()
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : index < 0
          ? (event.key === 'ArrowDown' ? 0 : buttons.length - 1)
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    buttons[next]?.focus()
  }

  const menu = open
    ? createPortal(
      <MenuSurface
        ref={panelRef}
        className="dsh-git-pilot-menu"
        role="menu"
        aria-label={t('menu.aria')}
        style={position === null ? undefined : { left: position.left, top: position.top }}
      >
        <div className="dsh-git-pilot-menuSearch">
          <Input
            className="dsh-git-pilot-grow"
            autoFocus
            icon={<IconSearchOutlineRegular />}
            type="text"
            role="searchbox"
            aria-label={t('menu.searchPlaceholder')}
            aria-controls="git-pilot-branch-list"
            placeholder={t('menu.searchPlaceholder')}
            value={filter}
            onChange={event => setFilter(event.target.value)}
            onKeyDown={onSearchKeyDown}
          />
        </div>
        <div className="dsh-git-pilot-menuViewport" ref={viewportRef} id="git-pilot-branch-list">
          {confirming !== undefined
            ? (
              <div className="dsh-git-pilot-confirm">
                <div className="dsh-git-pilot-confirmText">{confirming.message}</div>
                <div className="dsh-git-pilot-confirmActions">
                  <Button size="sm" variant="primary" disabled={pending} onClick={() => { void switchTo(confirming.branch, confirming.reasons) }}>
                    {pending ? t('menu.working') : t('menu.switch')}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => { setConfirming(undefined); setPending(false) }}>
                    {t('menu.cancel')}
                  </Button>
                </div>
              </div>
            )
            : (
              <>
                {locals.length === 0 && remotes.length === 0
                  ? <div className="dsh-git-pilot-note">{branches === undefined ? t('menu.working') : t('menu.empty')}</div>
                  : null}
                {locals.length > 0
                  ? (
                    <MenuGroup label={t('menu.local')}>
                      {locals.map(branch => (
                        <BranchRow
                          key={branch.name}
                          name={branch.name}
                          detail={branch.subject ?? branch.name}
                          current={branch.name === current}
                          onSelect={name => { if (name !== current) void switchTo(name); else setOpen(false) }}
                          t={t}
                        />
                      ))}
                    </MenuGroup>
                  )
                  : null}
                {remotes.length > 0
                  ? (
                    <MenuGroup label={t('menu.remote')}>
                      {remotes.map(branch => (
                        <BranchRow
                          key={branch.name}
                          name={branch.name}
                          detail={branch.name}
                          current={false}
                          onSelect={name => { void switchTo(name) }}
                          t={t}
                        />
                      ))}
                    </MenuGroup>
                  )
                  : null}
                {(branches?.truncated ?? false) ? <div className="dsh-git-pilot-note">{t('menu.truncated')}</div> : null}
                {creating
                  ? (
                    <div className="dsh-git-pilot-createRow">
                      <Input
                        className="dsh-git-pilot-grow"
                        autoFocus
                        value={nameDraft}
                        placeholder={t('menu.createPlaceholder')}
                        onChange={event => setNameDraft(event.target.value)}
                        onKeyDown={event => {
                          if (event.key === 'Enter') void createAndSwitch()
                          if (event.key === 'Escape') setCreating(false)
                        }}
                      />
                      <Button size="sm" variant="primary" disabled={pending} onClick={() => { void createAndSwitch() }}>
                        {pending ? t('menu.working') : t('menu.createConfirm')}
                      </Button>
                    </div>
                  )
                  : (
                    <button type="button" role="menuitem" className="dsh-git-pilot-row dsh-git-pilot-rowCreate" onClick={() => { setCreating(true); setNameDraft(prefilledName) }}>
                      <IconPlusOutlineRegular />
                      <span className="dsh-git-pilot-rowLabel">{t('menu.createBranch')}</span>
                    </button>
                  )}
              </>
            )}
        </div>
        {error !== undefined ? <div className="dsh-git-pilot-error">{error}</div> : null}
      </MenuSurface>,
      document.body,
    )
    : null

  return (
    <span className="dsh-git-pilot-static" style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6 }} ref={anchorRef}>
      {props.workspaceTitle !== undefined && variant === 'row'
        ? (
          <span className="dsh-git-pilot-trigger dsh-git-pilot-triggerStrong" title={props.workspaceTitle}>
            <IconFolderCloseMedium />
            <span className="dsh-git-pilot-triggerLabel">{props.workspaceTitle}</span>
          </span>
        )
        : null}
      <button
        type="button"
        className="dsh-git-pilot-trigger"
        onClick={openMenu}
        title={current}
        data-testid="git-pilot-branch-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <IconBranchOutlineRegular />
        <span className="dsh-git-pilot-triggerLabel">{current}</span>
        <span className="dsh-git-pilot-chevron" data-open={open ? 'true' : undefined} aria-hidden>
          <IconChevronDownOutlineRegular />
        </span>
      </button>
      {status !== undefined && status.isRepo && status.dirtyFiles > 0 && onOpenChanges !== undefined
        ? (
          <Pill
            className="dsh-git-pilot-dirtyPill"
            onClick={() => sessionId !== undefined && onOpenChanges(sessionId)}
            title={String(status.dirtyFiles)}
            aria-label={`${t('changes.tabTitle')} ${status.dirtyFiles}`}
          >
            {`±${status.dirtyFiles}`}
          </Pill>
        )
        : null}
      {menu}
    </span>
  )
}
