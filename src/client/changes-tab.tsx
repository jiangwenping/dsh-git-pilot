/** The right-Sidebar Changes tab: session-cumulative file and line totals with per-file diffs. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ChangedFileView, DiffHunkView, FileDiffView, SessionChangesView } from '../wire.ts'
import type { GitPilotApi } from './api.ts'
import type { GitPilotKey } from './locales.ts'

/** Injected face of the tab body. */
export interface ChangesTabInject {
  api: GitPilotApi
}

/** Defensive view of the runtime hooks this body consumes (both optional across DSH versions). */
interface TabHooks {
  useTabInfo?: () => { tab: { id: unknown; visible: boolean; revision: number } }
  useSessions?: (selector: (list: { byId: Record<string, { cwd?: string }> }) => string | undefined) => string | undefined
}

export interface ChangesTabProps extends ChangesTabInject {
  sessionId?: string
  t: (key: GitPilotKey, params?: Record<string, unknown>) => string
  /** Runtime-provided standard hooks, present as component props. */
  useTabInfo?: TabHooks['useTabInfo']
  useSessions?: TabHooks['useSessions']
}

const styles = {
  root: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    minHeight: 0,
    color: 'var(--dsw-alias-label-primary, #ececec)',
    fontSize: 13,
  },
  header: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
    padding: '12px 14px 8px',
  },
  branchLine: {
    fontSize: 12,
    color: 'var(--dsw-alias-label-secondary, #9a9a9a)',
  },
  totals: {
    fontSize: 13,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  added: { color: 'var(--dsw-alias-state-success-primary, #4ec96a)' },
  deleted: { color: 'var(--dsw-alias-state-error-primary, #ff6b6b)' },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap' as const,
    padding: '8px 14px',
  },
  ghost: {
    border: 'none',
    background: 'transparent',
    color: 'var(--dsw-alias-label-secondary, #9a9a9a)',
    fontSize: 12,
    cursor: 'pointer',
    padding: '3px 6px',
    borderRadius: 6,
    whiteSpace: 'nowrap' as const,
  },
  scope: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    background: 'rgba(128,128,128,0.12)',
    borderRadius: 8,
    padding: 2,
  },
  scopeChip: {
    border: 'none',
    background: 'transparent',
    color: 'var(--dsw-alias-label-secondary, #9a9a9a)',
    fontSize: 12,
    cursor: 'pointer',
    padding: '2px 8px',
    borderRadius: 6,
    whiteSpace: 'nowrap' as const,
  },
  scopeActive: {
    background: 'var(--dsw-alias-bg-overlay, #1f1f22)',
    color: 'var(--dsw-alias-label-primary, #ececec)',
  },
  spring: { flex: 1 },
  fileIcon: { flexShrink: 0, fontSize: 13 },
  statusSide: { fontSize: 11, flexShrink: 0, whiteSpace: 'nowrap' as const },
  refresh: {
    border: '1px solid rgba(128,128,128,0.3)',
    background: 'transparent',
    color: 'var(--dsw-alias-label-secondary, #9a9a9a)',
    fontSize: 12,
    borderRadius: 8,
    padding: '3px 10px',
    cursor: 'pointer',
  },
  list: {
    listStyle: 'none',
    margin: 0,
    padding: '2px 6px 12px',
    overflowY: 'auto' as const,
    flex: 1,
    minHeight: 0,
  },
  row: {
    borderRadius: 8,
    padding: '6px 8px',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
  },
  rowHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
  },
  path: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 12,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    flex: 1,
  },
  counts: { fontSize: 12, whiteSpace: 'nowrap' as const },
  statusBadge: {
    fontSize: 11,
    color: 'var(--dsw-alias-label-secondary, #9a9a9a)',
    border: '1px solid rgba(128,128,128,0.3)',
    borderRadius: 5,
    padding: '0 4px',
  },
  note: {
    color: 'var(--dsw-alias-label-secondary, #9a9a9a)',
    fontSize: 12,
    padding: '8px 14px',
  },
  error: {
    color: 'var(--dsw-alias-state-error-primary, #ff6b6b)',
    fontSize: 12,
    padding: '8px 14px',
  },
  checkbox: { accentColor: 'var(--dsw-alias-accent-primary, #4c8bf5)', flexShrink: 0 },
  revert: {
    border: 'none',
    background: 'transparent',
    color: 'var(--dsw-alias-label-secondary, #9a9a9a)',
    fontSize: 13,
    cursor: 'pointer',
    padding: '0 4px',
    flexShrink: 0,
  },
  commitBar: { display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px 8px' },
  commitInput: {
    flex: 1,
    background: 'var(--dsw-alias-bg-base, #141414)',
    border: '1px solid rgba(128,128,128,0.3)',
    borderRadius: 8,
    color: 'var(--dsw-alias-label-primary, #ececec)',
    fontSize: 12,
    padding: '5px 8px',
  },
  primaryButton: {
    border: 'none',
    borderRadius: 8,
    padding: '5px 12px',
    fontSize: 12,
    cursor: 'pointer',
    background: 'var(--dsw-alias-accent-primary, #4c8bf5)',
    color: '#ffffff',
    whiteSpace: 'nowrap' as const,
  },
  confirmStrip: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap' as const,
    padding: '4px 0 2px 26px',
  },
  confirmText: { color: 'var(--dsw-alias-label-secondary, #9a9a9a)', fontSize: 12 },
  dangerButton: {
    border: '1px solid var(--dsw-alias-state-error-primary, #ff6b6b)',
    borderRadius: 8,
    background: 'transparent',
    color: 'var(--dsw-alias-state-error-primary, #ff6b6b)',
    fontSize: 12,
    padding: '2px 10px',
    cursor: 'pointer',
  },
  diff: {
    margin: '4px 0 6px',
    border: '1px solid rgba(128,128,128,0.2)',
    borderRadius: 8,
    overflowX: 'auto' as const,
    background: 'var(--dsw-alias-bg-base, #141414)',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 12,
    lineHeight: '18px',
  },
  diffLine: {
    display: 'flex',
    whiteSpace: 'pre' as const,
  },
  lineNo: {
    color: 'var(--dsw-alias-label-secondary, #777)',
    userSelect: 'none' as const,
    padding: '0 6px',
    textAlign: 'right' as const,
    minWidth: 34,
    flexShrink: 0,
  },
  hunkHead: {
    color: 'var(--dsw-alias-label-secondary, #8a8a8a)',
    padding: '0 6px',
    background: 'rgba(128,128,128,0.10)',
  },
}

/** One-glyph stand-in for a file-type icon (zero-dependency; matches the plugin's glyph style). */
function fileGlyph(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.java')) return '☕'
  if (lower.endsWith('.md')) return '📝'
  if (/\.(png|jpe?g|gif|webp|svg|ico)$/.test(lower)) return '🖼'
  if (/\.(json|ya?ml|xml|properties)$/.test(lower)) return '⚙'
  return '📄'
}

/** Cursor-style status ink: new/added green, removals red, rest secondary. */
function statusInk(status: ChangedFileView['status']): { color: string } {
  if (status === 'untracked' || status === 'added') return { color: 'var(--dsw-alias-state-success-primary, #4ec96a)' }
  if (status === 'deleted' || status === 'unmerged') return { color: 'var(--dsw-alias-state-error-primary, #ff6b6b)' }
  return { color: 'var(--dsw-alias-label-secondary, #9a9a9a)' }
}

function statusLabel(status: ChangedFileView['status'], t: ChangesTabProps['t']): string {
  switch (status) {
    case 'added': return t('changes.status.added')
    case 'deleted': return t('changes.status.deleted')
    case 'unmerged': return t('changes.status.unmerged')
    case 'untracked': return t('changes.status.untracked')
    default: return t('changes.status.modified')
  }
}

function lineColor(prefix: string): { color: string; background: string } {
  if (prefix === '+') return { color: 'var(--dsw-alias-state-success-primary, #4ec96a)', background: 'rgba(78,201,106,0.10)' }
  if (prefix === '-') return { color: 'var(--dsw-alias-state-error-primary, #ff6b6b)', background: 'rgba(255,107,107,0.10)' }
  return { color: 'inherit', background: 'transparent' }
}

function HunkBody({ hunk }: { hunk: DiffHunkView }): ReactNode {
  let oldLine = hunk.oldStart
  let newLine = hunk.newStart
  return (
    <>
      <div style={{ ...styles.diffLine, ...styles.hunkHead }}>{`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`}</div>
      {hunk.lines.map((line, index) => {
        const prefix = line.slice(0, 1)
        const paint = lineColor(prefix)
        // A "\ No newline" marker belongs to the previous line: it renders
        // as a note and must not advance either counter.
        if (prefix === '\\') {
          return (
            <div key={index} style={{ ...styles.diffLine, ...styles.hunkHead }}>
              <span style={styles.lineNo}>{' '}</span>
              <span style={{ flex: 1 }}>{line}</span>
            </div>
          )
        }
        const numbers = prefix === '+'
          ? `  ${newLine}`
          : prefix === '-'
            ? `${oldLine}  `
            : `${oldLine} ${newLine}`
        if (prefix === '+') newLine += 1
        else if (prefix === '-') oldLine += 1
        else { oldLine += 1; newLine += 1 }
        return (
          <div key={index} style={{ ...styles.diffLine, ...paint }}>
            <span style={styles.lineNo}>{numbers}</span>
            <span style={{ flex: 1 }}>{line === '' ? ' ' : line}</span>
          </div>
        )
      })}
    </>
  )
}

/** One file row: selection, counts, revert affordance, and its diff on expansion. */
function FileRow({
  file, expanded, diff, selected, revertState, revertBusy, onToggle, onSelect, onRevertAsk, onRevertConfirm, onRevertCancel, t,
}: {
  file: ChangedFileView
  expanded: boolean
  diff: FileDiffView | 'loading' | 'failed' | undefined
  selected: boolean
  revertState: 'idle' | 'confirm' | 'working'
  /** A revert is already running: every other revert button stands down. */
  revertBusy: boolean
  onToggle: () => void
  onSelect: (selected: boolean) => void
  onRevertAsk: () => void
  onRevertConfirm: () => void
  onRevertCancel: () => void
  t: ChangesTabProps['t']
}): ReactNode {
  const counts = file.binary === true
    ? <span style={styles.note}>{t('changes.binary')}</span>
    : file.oversized === true
      ? <span style={styles.note}>{t('changes.oversized')}</span>
      : file.gitlink === true
        ? <span style={styles.note}>{t('changes.gitlink')}</span>
        : (
          <span style={styles.counts}>
            <span style={styles.added}>{`+${file.added}`}</span>
            {' '}
            <span style={styles.deleted}>{`−${file.deleted}`}</span>
          </span>
        )
  return (
    <li
      style={styles.row}
      onClick={onToggle}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onKeyDown={event => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onToggle()
      }}
    >
      <div style={styles.rowHead}>
        <span style={styles.fileIcon} aria-hidden>{fileGlyph(file.path)}</span>
        <span style={styles.path} title={file.path}>{file.path}</span>
        {counts}
        <span style={{ ...styles.statusSide, ...statusInk(file.status) }}>{statusLabel(file.status, t)}</span>
        {revertState === 'idle' && file.status !== 'untracked'
          ? (
            <button
              type="button"
              style={styles.revert}
              title={t('revert.action')}
              disabled={revertBusy}
              onClick={event => { event.stopPropagation(); onRevertAsk() }}
            >
              ↩
            </button>
          )
          : null}
        <input
          type="checkbox"
          style={styles.checkbox}
          checked={selected}
          onClick={event => event.stopPropagation()}
          onChange={event => onSelect(event.target.checked)}
          aria-label={file.path}
        />
      </div>
      {revertState !== 'idle'
        ? (
          <div style={styles.confirmStrip} onClick={event => event.stopPropagation()}>
            {revertState === 'confirm'
              ? (
                <>
                  <span style={styles.confirmText}>{t('revert.confirmTitle')}</span>
                  <button type="button" style={styles.dangerButton} onClick={onRevertConfirm}>{t('revert.confirm')}</button>
                  <button type="button" style={styles.refresh} onClick={onRevertCancel}>{t('revert.cancel')}</button>
                </>
              )
              : <span style={styles.confirmText}>{t('revert.working')}</span>}
          </div>
        )
        : null}
      {expanded
        ? (
          <div style={styles.diff} onClick={event => event.stopPropagation()}>
            {diff === undefined || diff === 'loading'
              ? <div style={styles.note}>{t('menu.working')}</div>
              : diff === 'failed'
                ? <div style={styles.error}>{t('changes.loadFailed')}</div>
                : diff.kind === 'binary'
                  ? <div style={styles.note}>{t('changes.binary')}</div>
                  : diff.kind === 'oversized'
                    ? <div style={styles.note}>{t('changes.oversized')}</div>
                    : diff.hunks.length === 0
                      ? <div style={styles.note}>{t('changes.empty')}</div>
                      : <>
                          {diff.hunks.map((hunk, index) => <HunkBody key={index} hunk={hunk} />)}
                          {diff.truncated === true ? <div style={styles.note}>{t('changes.truncatedNote')}</div> : null}
                        </>}
          </div>
        )
        : null}
    </li>
  )
}

/** The tab body. */
export function ChangesTabBody(props: ChangesTabProps): ReactNode {
  const { api, sessionId, t, useTabInfo, useSessions } = props
  const fallbackTabInfo = useCallback(() => ({ tab: { id: undefined, visible: true, revision: 0 } }), [])
  const tabInfo = (useTabInfo ?? fallbackTabInfo)()
  const fallbackSessions = useCallback((_selector: (list: { byId: Record<string, { cwd?: string }> }) => string | undefined) => undefined, [])
  const cwd = (useSessions ?? fallbackSessions)(list => {
    const key = sessionId === undefined ? '' : String(sessionId)
    return key === '' ? undefined : list.byId[key]?.cwd
  })
  const visible = tabInfo?.tab?.visible ?? true

  const [summary, setSummary] = useState<SessionChangesView | undefined>()
  const [failed, setFailed] = useState(false)
  // True after the first settle: distinguishes "still loading" from "loaded
  // but the scope has no data" (different UI states).
  const [loaded, setLoaded] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [diffs, setDiffs] = useState<Record<string, FileDiffView | 'loading' | 'failed'>>({})
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [scope, setScope] = useState<'uncommitted' | 'session'>('uncommitted')
  const [commitPhase, setCommitPhase] = useState<'idle' | 'input' | 'working'>('idle')
  const [message, setMessage] = useState('')
  const [actionError, setActionError] = useState<string | undefined>()
  const [revertTarget, setRevertTarget] = useState<string | undefined>()
  const [revertWorking, setRevertWorking] = useState(false)
  // Monotonic request ids: stale responses never overwrite newer state.
  const refreshEpochRef = useRef(0)
  const diffEpochRef = useRef(0)
  // Fingerprint of the last applied summary: the safety-net poll only touches
  // state when the working tree actually moved, so reading an open diff never
  // blinks on a no-op refresh.
  const fingerprintRef = useRef<string | undefined>(undefined)

  const sessionKey = sessionId === undefined ? '' : String(sessionId)
  const refresh = useCallback((opts?: { force?: boolean }): void => {
    const epoch = ++refreshEpochRef.current
    const settle = (view: SessionChangesView | undefined): void => {
      if (epoch !== refreshEpochRef.current) return
      setLoaded(true)
      const fingerprint = view === undefined
        ? undefined
        : JSON.stringify([view.branch, view.detached, view.total, view.added, view.deleted, view.truncated, view.files.map(file => `${file.status}:${file.path}:${file.added}:${file.deleted}`)])
      if (opts?.force !== true && fingerprint === fingerprintRef.current) return
      fingerprintRef.current = fingerprint
      setSummary(view); setFailed(false); setDiffs({})
    }
    const failRows = (): void => {
      if (epoch !== refreshEpochRef.current) return
      setFailed(true)
      // A failed refresh must not leave expanded rows stuck on "Working…".
      setDiffs(previous => Object.fromEntries(Object.entries(previous).map(([key, value]) => [key, value === 'loading' ? 'failed' : value])))
    }
    if (scope === 'uncommitted') {
      // Workspace scope needs no session; without a workspace the tab stays empty.
      if (cwd === undefined || cwd === '') return
      api.uncommitted(cwd).then(settle).catch(() => { if (epoch === refreshEpochRef.current) failRows() })
      return
    }
    if (sessionKey === '') return
    api.sessionChanges(sessionKey)
      .then(settle)
      .catch(() => { if (epoch === refreshEpochRef.current) failRows() })
  }, [api, sessionKey, scope, cwd])

  useEffect(() => {
    fingerprintRef.current = undefined
    setSummary(undefined)
    setExpanded({})
    setDiffs({})
    setSelected({})
    setLoaded(false)
    setCommitPhase('idle')
    setMessage('')
    setActionError(undefined)
    setRevertTarget(undefined)
    refresh()
  }, [refresh, cwd])

  // Expanded rows always have a current comparison: any refresh cleared the
  // cache, so missing entries reload on their own.
  useEffect(() => {
    if (summary === undefined) return
    const epoch = refreshEpochRef.current
    for (const file of summary.files) {
      if (expanded[file.path] !== true) continue
      if (diffs[file.path] !== undefined) continue
      setDiffs(previous => ({ ...previous, [file.path]: 'loading' }))
      const load = scope === 'uncommitted' && cwd !== undefined && cwd !== ''
        ? api.fileDiff(cwd, file.path)
        : api.sessionFileDiff(sessionKey, file.path)
      load
        .then(view => {
          if (epoch !== refreshEpochRef.current) return
          setDiffs(previous => ({ ...previous, [file.path]: view ?? 'failed' }))
        })
        .catch(() => {
          if (epoch !== refreshEpochRef.current) return
          setDiffs(previous => ({ ...previous, [file.path]: 'failed' }))
        })
    }
  }, [api, sessionKey, scope, cwd, summary, expanded, diffs])

  // Refresh while visible: on navigation, on focus, and on a soft interval.
  useEffect(() => {
    if (!visible || sessionKey === '') return
    const onFocus = (): void => { refresh() }
    const timer = window.setInterval(() => { if (document.hidden) return; refresh() }, 30_000)
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [visible, sessionKey, refresh])

  const toggle = (path: string): void => {
    setExpanded(previous => ({ ...previous, [path]: !previous[path] }))
  }

  const doCommit = (): void => {
    // Commit always writes the picked files' current worktree content — it is
    // an uncommitted-scope action, whatever list the user launched it from.
    if (scope !== 'uncommitted' || cwd === undefined || cwd === '' || summary === undefined || commitPhase === 'working') return
    const picked = summary.files.filter(file => selected[file.path] === true).map(file => file.path)
    const paths = picked.length > 0 ? picked : summary.files.map(file => file.path)
    setCommitPhase('working')
    setActionError(undefined)
    api.commit(cwd, message, paths)
      .then(outcome => {
        if (outcome.ok) {
          setMessage(''); setSelected({}); setCommitPhase('idle'); refresh({ force: true })
        } else {
          setCommitPhase('input')
          setActionError(outcome.reason === 'nothing' ? t('commit.nothing') : `${t('commit.failed')}: ${outcome.message}`)
        }
      })
      .catch((reason: unknown) => {
        setCommitPhase('input')
        setActionError(`${t('commit.failed')}: ${reason instanceof Error ? reason.message : String(reason)}`)
      })
  }

  const doRevert = (path: string): void => {
    if (cwd === undefined || cwd === '' || revertWorking) return
    setRevertWorking(true)
    setActionError(undefined)
    api.revertFile(cwd, path)
      .then(outcome => {
        setRevertWorking(false)
        setRevertTarget(undefined)
        if (outcome.ok) {
          refresh({ force: true })
        } else {
          setActionError(
            outcome.reason === 'untracked'
              ? t('revert.unsupported')
              : outcome.reason === 'new-file'
                ? t('revert.newFile')
                : `${t('revert.failed')}: ${outcome.message}`,
          )
        }
      })
      .catch((reason: unknown) => {
        setRevertWorking(false)
        setRevertTarget(undefined)
        setActionError(`${t('revert.failed')}: ${reason instanceof Error ? reason.message : String(reason)}`)
      })
  }

  const anyCollapsed = summary !== undefined && summary.files.some(file => expanded[file.path] !== true)
  const setAll = (open: boolean): void => {
    if (summary === undefined) return
    const next: Record<string, boolean> = {}
    if (open) for (const file of summary.files) next[file.path] = true
    setExpanded(next)
    setDiffs(previous => (open ? previous : {}))
  }

  const selectedCount = summary === undefined
    ? 0
    : summary.files.reduce((count, file) => count + (selected[file.path] === true ? 1 : 0), 0)

  if (sessionKey === '' || summary === undefined) {
    return (
      <div style={styles.root}>
        {failed ? <div style={styles.note}>{t('changes.loadFailed')}</div> : loaded ? <div style={styles.note}>{t('changes.noData')}</div> : <div style={styles.note}>{t('menu.working')}</div>}
      </div>
    )
  }
  const branchLine = summary.detached === true ? t('changes.onDetached') : t('changes.onBranch', { branch: summary.branch ?? '' })
  const totals = t('changes.summary', { files: summary.total, added: summary.added, deleted: summary.deleted })
  // collectChanges always answers branch or detached for a repository, so the
  // presence marker alone decides.
  const repo = summary.repo !== false
  return (
    <div style={styles.root}>
      {repo
        ? (
          <div style={styles.toolbar}>
            <div style={styles.scope} role="tablist">
              <button type="button" style={{ ...styles.scopeChip, ...(scope === 'uncommitted' ? styles.scopeActive : {}) }} onClick={() => setScope('uncommitted')}>{t('scope.uncommitted')}</button>
              <button type="button" style={{ ...styles.scopeChip, ...(scope === 'session' ? styles.scopeActive : {}) }} onClick={() => setScope('session')}>{t('scope.session')}</button>
            </div>
            <span style={styles.totals} title={totals}>
              <span aria-hidden>±</span>
              <span>{summary.total}</span>
              <span style={styles.added}>{`+${summary.added}`}</span>
              <span style={styles.deleted}>{`−${summary.deleted}`}</span>
            </span>
            <span style={styles.branchLine}>{branchLine}</span>
            <span style={styles.spring} />
            <button type="button" style={styles.ghost} onClick={() => setAll(anyCollapsed)}>{anyCollapsed ? t('changes.expandAll') : t('changes.collapseAll')}</button>
            <button type="button" style={styles.ghost} onClick={() => refresh({ force: true })} title={t('changes.refresh')}>⟳</button>
            {scope === 'uncommitted' && cwd !== undefined && cwd !== '' && summary.files.length > 0 && commitPhase === 'idle'
              ? (
                <button type="button" style={styles.primaryButton} onClick={() => { setCommitPhase('input'); setActionError(undefined) }}>
                  {selectedCount > 0 ? `${t('commit.action')} ${selectedCount}/${summary.files.length}` : t('commit.action')}
                </button>
              )
              : null}
          </div>
        )
        : (
          <div style={styles.header}>
            <span style={styles.branchLine}>{t('changes.noRepo')}</span>
          </div>
        )}
      {scope === 'uncommitted' && repo && cwd !== undefined && cwd !== '' && summary.files.length > 0 && (commitPhase === 'input' || commitPhase === 'working')
        ? (
          <div style={styles.commitBar}>
            <input
              style={styles.commitInput}
              value={message}
              autoFocus
              placeholder={t('commit.placeholder')}
              onChange={event => setMessage(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter' && message.trim() !== '') doCommit() }}
              disabled={commitPhase === 'working'}
            />
            {commitPhase === 'working'
              ? <span style={styles.confirmText}>{t('commit.working')}</span>
              : (
                <>
                  <button type="button" style={styles.primaryButton} disabled={message.trim() === ''} onClick={doCommit}>{t('commit.confirm')}</button>
                  <button type="button" style={styles.ghost} onClick={() => { setCommitPhase('idle'); setActionError(undefined) }}>{t('revert.cancel')}</button>
                </>
              )}
          </div>
        )
        : null}
      {actionError ? <div style={styles.error}>{actionError}</div> : null}
      {failed ? <div style={styles.note}>{t('changes.loadFailed')}</div> : null}
      {!repo
        ? <div style={styles.note}>{t('changes.noRepo')}</div>
        : summary.files.length === 0
        ? <div style={styles.note}>{scope === 'uncommitted' ? t('changes.emptyUncommitted') : t('changes.empty')}</div>
        : (
          <ul style={styles.list}>
            {summary.files.map(file => (
              <FileRow
                key={file.path}
                file={file}
                expanded={expanded[file.path] === true}
                diff={diffs[file.path]}
                selected={selected[file.path] === true}
                revertState={revertWorking && revertTarget === file.path ? 'working' : revertTarget === file.path ? 'confirm' : 'idle'}
                revertBusy={revertWorking}
                onToggle={() => toggle(file.path)}
                onSelect={value => setSelected(previous => ({ ...previous, [file.path]: value }))}
                onRevertAsk={() => setRevertTarget(file.path)}
                onRevertConfirm={() => doRevert(file.path)}
                onRevertCancel={() => setRevertTarget(undefined)}
                t={t}
              />
            ))}
          </ul>
        )}
      {summary.truncated
        ? <div style={styles.note}>{t('changes.truncated', { shown: summary.files.length, total: summary.total })}</div>
        : null}
    </div>
  )
}
