/**
 * The right-Sidebar Changes tab: session-cumulative file and line totals with
 * per-file diffs. Presentation rides the shared primitives (SegmentedControl,
 * Input, Button, Checkbox, Tag, PathLabel, FileTypeIcon, the shared
 * iconography) and the plugin stylesheet, so it reads like a shipped sidebar.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Button,
  Checkbox,
  FileTypeIcon,
  IconRefreshOutlineRegular,
  IconTrashOutlineRegular,
  Input,
  PathLabel,
  SegmentedControl,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
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

/** Cursor-style status ink as a Tag tone: new/added green, removals red, rest neutral. */
function statusTone(status: ChangedFileView['status']): 'success' | 'danger' | 'outline' {
  if (status === 'untracked' || status === 'added') return 'success'
  if (status === 'deleted' || status === 'unmerged') return 'danger'
  return 'outline'
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

function lineSign(prefix: string): 'added' | 'deleted' | 'context' {
  if (prefix === '+') return 'added'
  if (prefix === '-') return 'deleted'
  return 'context'
}

function HunkBody({ hunk }: { hunk: DiffHunkView }): ReactNode {
  let oldLine = hunk.oldStart
  let newLine = hunk.newStart
  return (
    <>
      <div className="dsh-git-pilot-diffLine dsh-git-pilot-hunkHead">{`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`}</div>
      {hunk.lines.map((line, index) => {
        const prefix = line.slice(0, 1)
        // A "\ No newline" marker belongs to the previous line: it renders
        // as a note and must not advance either counter.
        if (prefix === '\\') {
          return (
            <div key={index} className="dsh-git-pilot-diffLine dsh-git-pilot-hunkHead">
              <span className="dsh-git-pilot-lineNo">{' '}</span>
              <span className="dsh-git-pilot-lineText">{line}</span>
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
          <div key={index} className="dsh-git-pilot-diffLine" data-sign={lineSign(prefix)}>
            <span className="dsh-git-pilot-lineNo">{numbers}</span>
            <span className="dsh-git-pilot-lineText">{line === '' ? ' ' : line}</span>
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
    ? <span className="dsh-git-pilot-note">{t('changes.binary')}</span>
    : file.oversized === true
      ? <span className="dsh-git-pilot-note">{t('changes.oversized')}</span>
      : file.gitlink === true
        ? <span className="dsh-git-pilot-note">{t('changes.gitlink')}</span>
        : (
          <span className="dsh-git-pilot-counts">
            <span className="dsh-git-pilot-added">{`+${file.added}`}</span>
            {' '}
            <span className="dsh-git-pilot-deleted">{`−${file.deleted}`}</span>
          </span>
        )
  return (
    <li
      className="dsh-git-pilot-fileRow"
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
      <div className="dsh-git-pilot-fileHead">
        <span className="dsh-git-pilot-fileIcon" aria-hidden><FileTypeIcon path={file.path} size={16} /></span>
        <PathLabel path={file.path} className="dsh-git-pilot-grow" />
        {counts}
        <Tag className="dsh-git-pilot-statusSide" tone={statusTone(file.status)}>{statusLabel(file.status, t)}</Tag>
        {revertState === 'idle' && file.status !== 'untracked'
          ? (
            <button
              type="button"
              className="dsh-git-pilot-iconButton"
              title={t('revert.action')}
              aria-label={t('revert.action')}
              disabled={revertBusy}
              onClick={event => { event.stopPropagation(); onRevertAsk() }}
            >
              <IconTrashOutlineRegular />
            </button>
          )
          : null}
        {/* Checkbox takes no click props; the wrapper keeps the pick from
            toggling the row's own expansion. */}
        <span onClick={event => event.stopPropagation()}>
          <Checkbox
            className="dsh-git-pilot-static"
            checked={selected}
            label=""
            title={file.path}
            onChange={onSelect}
          />
        </span>
      </div>
      {revertState !== 'idle'
        ? (
          <div className="dsh-git-pilot-confirmStrip" onClick={event => event.stopPropagation()}>
            {revertState === 'confirm'
              ? (
                <>
                  <span className="dsh-git-pilot-confirmStripText">{t('revert.confirmTitle')}</span>
                  <Button size="sm" variant="primary" onClick={onRevertConfirm}>{t('revert.confirm')}</Button>
                  <Button size="sm" variant="ghost" onClick={onRevertCancel}>{t('revert.cancel')}</Button>
                </>
              )
              : <span className="dsh-git-pilot-confirmStripText">{t('revert.working')}</span>}
          </div>
        )
        : null}
      {expanded
        ? (
          <div className="dsh-git-pilot-diff" onClick={event => event.stopPropagation()}>
            {diff === undefined || diff === 'loading'
              ? <div className="dsh-git-pilot-note">{t('menu.working')}</div>
              : diff === 'failed'
                ? <div className="dsh-git-pilot-error">{t('changes.loadFailed')}</div>
                : diff.kind === 'binary'
                  ? <div className="dsh-git-pilot-note">{t('changes.binary')}</div>
                  : diff.kind === 'oversized'
                    ? <div className="dsh-git-pilot-note">{t('changes.oversized')}</div>
                    : diff.hunks.length === 0
                      ? <div className="dsh-git-pilot-note">{t('changes.empty')}</div>
                      : <>
                          {diff.hunks.map((hunk, index) => <HunkBody key={index} hunk={hunk} />)}
                          {diff.truncated === true ? <div className="dsh-git-pilot-note">{t('changes.truncatedNote')}</div> : null}
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
      <div className="dsh-git-pilot-tab">
        {failed ? <div className="dsh-git-pilot-note">{t('changes.loadFailed')}</div> : loaded ? <div className="dsh-git-pilot-note">{t('changes.noData')}</div> : <div className="dsh-git-pilot-note">{t('menu.working')}</div>}
      </div>
    )
  }
  const branchLine = summary.detached === true ? t('changes.onDetached') : t('changes.onBranch', { branch: summary.branch ?? '' })
  const totals = t('changes.summary', { files: summary.total, added: summary.added, deleted: summary.deleted })
  // collectChanges always answers branch or detached for a repository, so the
  // presence marker alone decides.
  const repo = summary.repo !== false
  return (
    <div className="dsh-git-pilot-tab">
      {repo
        ? (
          <div className="dsh-git-pilot-toolbar">
            <SegmentedControl
              id="git-pilot-scope"
              label={t('changes.scope')}
              value={scope}
              onChange={setScope}
              options={[
                { value: 'uncommitted', label: t('scope.uncommitted') },
                { value: 'session', label: t('scope.session') },
              ]}
            />
            <span className="dsh-git-pilot-totals" title={totals}>
              <span aria-hidden>±</span>
              <span>{summary.total}</span>
              <span className="dsh-git-pilot-added">{`+${summary.added}`}</span>
              <span className="dsh-git-pilot-deleted">{`−${summary.deleted}`}</span>
            </span>
            <span className="dsh-git-pilot-branchLine">{branchLine}</span>
            <span className="dsh-git-pilot-spring" />
            <Button size="sm" variant="ghost" onClick={() => setAll(anyCollapsed)}>{anyCollapsed ? t('changes.expandAll') : t('changes.collapseAll')}</Button>
            <button type="button" className="dsh-git-pilot-iconButton" onClick={() => refresh({ force: true })} title={t('changes.refresh')} aria-label={t('changes.refresh')}>
              <IconRefreshOutlineRegular />
            </button>
            {scope === 'uncommitted' && cwd !== undefined && cwd !== '' && summary.files.length > 0 && commitPhase === 'idle'
              ? (
                <Button size="sm" variant="primary" onClick={() => { setCommitPhase('input'); setActionError(undefined) }}>
                  {selectedCount > 0 ? `${t('commit.action')} ${selectedCount}/${summary.files.length}` : t('commit.action')}
                </Button>
              )
              : null}
          </div>
        )
        : (
          <div className="dsh-git-pilot-toolbar">
            <span className="dsh-git-pilot-branchLine">{t('changes.noRepo')}</span>
          </div>
        )}
      {scope === 'uncommitted' && repo && cwd !== undefined && cwd !== '' && summary.files.length > 0 && (commitPhase === 'input' || commitPhase === 'working')
        ? (
          <div className="dsh-git-pilot-commitBar">
            <Input
              className="dsh-git-pilot-commitInput"
              value={message}
              autoFocus
              type="text"
              placeholder={t('commit.placeholder')}
              aria-label={t('commit.placeholder')}
              onChange={event => setMessage(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter' && message.trim() !== '') doCommit() }}
              disabled={commitPhase === 'working'}
            />
            {commitPhase === 'working'
              ? <span className="dsh-git-pilot-confirmStripText">{t('commit.working')}</span>
              : (
                <>
                  <Button size="sm" variant="primary" disabled={message.trim() === ''} onClick={doCommit}>{t('commit.confirm')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setCommitPhase('idle'); setActionError(undefined) }}>{t('revert.cancel')}</Button>
                </>
              )}
          </div>
        )
        : null}
      {actionError ? <div className="dsh-git-pilot-error">{actionError}</div> : null}
      {failed ? <div className="dsh-git-pilot-note">{t('changes.loadFailed')}</div> : null}
      {!repo
        ? <div className="dsh-git-pilot-note">{t('changes.noRepo')}</div>
        : summary.files.length === 0
        ? <div className="dsh-git-pilot-note">{scope === 'uncommitted' ? t('changes.emptyUncommitted') : t('changes.empty')}</div>
        : (
          <ul className="dsh-git-pilot-list">
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
        ? <div className="dsh-git-pilot-note">{t('changes.truncated', { shown: summary.files.length, total: summary.total })}</div>
        : null}
    </div>
  )
}
