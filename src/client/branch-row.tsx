/** The composer branch control: chip or row, with the search/create/confirm menu. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
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

const styles = {
  row: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  },
  trigger: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    border: 'none',
    background: 'transparent',
    color: 'var(--dsw-alias-label-secondary, #9a9a9a)',
    fontSize: 12,
    lineHeight: '18px',
    padding: '3px 6px',
    borderRadius: 6,
    cursor: 'pointer',
    maxWidth: 320,
    whiteSpace: 'nowrap' as const,
  },
  badge: {
    border: 'none',
    background: 'transparent',
    color: 'var(--dsw-alias-label-secondary, #9a9a9a)',
    fontSize: 12,
    padding: '3px 6px',
    borderRadius: 6,
    cursor: 'pointer',
  },
  menu: {
    position: 'absolute' as const,
    top: 'calc(100% + 6px)',
    left: 0,
    zIndex: 60,
    width: 340,
    maxHeight: 420,
    overflowY: 'auto' as const,
    background: 'var(--dsw-alias-bg-overlay, #1f1f22)',
    color: 'var(--dsw-alias-label-primary, #ececec)',
    border: '1px solid rgba(128,128,128,0.25)',
    borderRadius: 10,
    boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
    padding: 6,
  },
  search: {
    width: '100%',
    boxSizing: 'border-box' as const,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: 'inherit',
    fontSize: 13,
    padding: '8px 10px',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    width: '100%',
    border: 'none',
    background: 'transparent',
    color: 'inherit',
    textAlign: 'left' as const,
    fontSize: 13,
    padding: '7px 10px',
    borderRadius: 8,
    cursor: 'pointer',
  },
  section: {
    fontSize: 11,
    color: 'var(--dsw-alias-label-secondary, #8a8a8a)',
    padding: '6px 10px 2px',
  },
  note: {
    fontSize: 12,
    color: 'var(--dsw-alias-label-secondary, #8a8a8a)',
    padding: '6px 10px',
  },
  warn: {
    fontSize: 12,
    lineHeight: '18px',
    color: 'var(--dsw-alias-label-primary, #ececec)',
    background: 'rgba(255,180,80,0.10)',
    border: '1px solid rgba(255,180,80,0.35)',
    borderRadius: 8,
    padding: '8px 10px',
    margin: 4,
  },
  error: {
    fontSize: 12,
    color: 'var(--dsw-alias-state-error-primary, #ff6b6b)',
    padding: '4px 10px',
    wordBreak: 'break-word' as const,
  },
  createRow: {
    display: 'flex',
    gap: 6,
    padding: '6px 4px',
  },
  createInput: {
    flex: 1,
    background: 'transparent',
    border: '1px solid rgba(128,128,128,0.3)',
    borderRadius: 8,
    outline: 'none',
    color: 'inherit',
    fontSize: 13,
    padding: '6px 10px',
  },
  button: {
    border: '1px solid rgba(128,128,128,0.3)',
    background: 'transparent',
    color: 'var(--dsw-alias-brand-primary, #4c8dff)',
    fontSize: 12,
    borderRadius: 8,
    padding: '5px 10px',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
}

function branchDisplayName(status: GitStatusView | undefined, t: BranchControlProps['t']): string | undefined {
  if (status === undefined || !status.isRepo) return undefined
  if (status.detached) return `${status.commit ?? ''} ${t('chip.detached')}`.trim()
  return status.branch
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
  const rootRef = useRef<HTMLSpanElement | null>(null)

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

  // Clicking outside the control closes the menu; Escape does too, from anywhere.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent): void => {
      if (rootRef.current !== null && event.target instanceof Node && rootRef.current.contains(event.target)) return
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

  const trigger = (
    <button type="button" style={styles.trigger} onClick={openMenu} title={current} data-testid="git-pilot-branch-trigger" aria-haspopup="menu" aria-expanded={open}>
      <span aria-hidden>⎇</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{current}</span>
      <span aria-hidden style={{ fontSize: 10, opacity: 0.7 }}>{open ? '▲' : '▼'}</span>
    </button>
  )

  return (
    <span style={{ ...styles.row, position: 'relative', display: 'inline-flex' }} ref={rootRef}>
      {props.workspaceTitle !== undefined && variant === 'row'
        ? (
          <span
            style={{ ...styles.trigger, cursor: 'default', color: 'var(--dsw-alias-label-primary, #ececec)', fontWeight: 500 }}
            title={props.workspaceTitle}
          >
            <span aria-hidden>📁</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{props.workspaceTitle}</span>
          </span>
        )
        : null}
      {trigger}
      {status !== undefined && status.isRepo && status.dirtyFiles > 0 && onOpenChanges !== undefined
        ? (
          <button
            type="button"
            style={{ ...styles.badge, color: 'var(--dsw-alias-state-warn-primary, #e0a34a)' }}
            onClick={() => sessionId !== undefined && onOpenChanges(sessionId)}
            title={String(status.dirtyFiles)}
            aria-label={`${t('changes.tabTitle')} ${status.dirtyFiles}`}
          >
            ±{status.dirtyFiles}
          </button>
        )
        : null}
      {open
        ? (
          <div style={styles.menu} role="menu">
            <input
              style={styles.search}
              autoFocus
              value={filter}
              placeholder={t('menu.searchPlaceholder')}
              onChange={event => setFilter(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Escape') setOpen(false)
                if (event.key === 'Enter' && !creating && filter.trim() !== '') {
                  setCreating(true)
                  setNameDraft(filter.trim())
                  return
                }
                if (event.key === 'Enter' && creating) void createAndSwitch()
              }}
            />
            {confirming !== undefined
              ? (
                <div>
                  <div style={styles.warn}>{confirming.message}</div>
                  <div style={styles.createRow}>
                    <button
                      type="button"
                      style={styles.button}
                      disabled={pending}
                      onClick={() => { void switchTo(confirming.branch, confirming.reasons) }}
                    >
                      {pending ? t('menu.working') : t('menu.switch')}
                    </button>
                    <button type="button" style={styles.button} disabled={pending} onClick={() => { setConfirming(undefined); setPending(false) }}>
                      {t('menu.cancel')}
                    </button>
                  </div>
                </div>
              )
              : (
                <>
                  {locals.length === 0 && remotes.length === 0
                    ? <div style={styles.note}>{branches === undefined ? t('menu.working') : t('menu.empty')}</div>
                    : null}
                  {locals.map(branch => (
                    <button
                      key={branch.name}
                      type="button"
                      role="menuitem"
                      style={{ ...styles.item, background: branch.name === current ? 'rgba(128,128,128,0.12)' : 'transparent' }}
                      title={branch.subject ?? branch.name}
                      onClick={() => { if (branch.name !== current) void switchTo(branch.name); else setOpen(false) }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{branch.name}</span>
                      {branch.name === current ? <span aria-hidden>✓</span> : null}
                    </button>
                  ))}
                  {remotes.length > 0
                    ? (
                      <>
                        <div style={styles.section}>{t('menu.remote')}</div>
                        {remotes.map(branch => (
                          <button key={branch.name} type="button" role="menuitem" style={styles.item} title={branch.name}
                            onClick={() => { void switchTo(branch.name) }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{branch.name}</span>
                          </button>
                        ))}
                      </>
                    )
                    : null}
                  {(branches?.truncated ?? false) ? <div style={styles.note}>{t('menu.truncated')}</div> : null}
                  {creating
                    ? (
                      <div style={styles.createRow}>
                        <input
                          style={styles.createInput}
                          autoFocus
                          value={nameDraft}
                          placeholder={t('menu.createPlaceholder')}
                          onChange={event => setNameDraft(event.target.value)}
                          onKeyDown={event => {
                            if (event.key === 'Enter') void createAndSwitch()
                            if (event.key === 'Escape') setCreating(false)
                          }}
                        />
                        <button type="button" style={styles.button} disabled={pending} onClick={() => { void createAndSwitch() }}>
                          {pending ? t('menu.working') : t('menu.createConfirm')}
                        </button>
                      </div>
                    )
                    : (
                      <button
                        type="button"
                        style={{ ...styles.item, color: 'var(--dsw-alias-brand-primary, #4c8dff)' }}
                        onClick={() => { setCreating(true); setNameDraft(prefilledName) }}
                      >
                        <span>＋ {t('menu.createBranch')}</span>
                      </button>
                    )}
                </>
              )}
            {error !== undefined ? <div style={styles.error}>{error}</div> : null}
          </div>
        )
        : null}
    </span>
  )
}
