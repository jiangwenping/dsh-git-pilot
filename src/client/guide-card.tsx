/**
 * The provider's guide card on the sidebar-right start page: the Cursor-style
 * always-visible entry. Live session-change totals under the title; picking
 * the card opens this session's Changes tab through the enclosing tab's own
 * resource action.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SessionChangesView } from '../wire.ts'
import { changesAddress } from './definition.ts'
import { GitPilotGuideIcon } from './guide-icon.tsx'

/** Session-bound data the card reads, closed over the guide tab's session. */
export interface GitPilotGuideInjected {
  /** The session the guide tab is mounted in. */
  readonly sessionId: string
  /** @returns the session's baseline summary; `undefined` before the first turn captured one. */
  readonly changes: () => Promise<SessionChangesView | undefined>
}

/** Guide card props: the keyed guide-entry share, the locale seat, and the session data. */
export type GitPilotGuideProps =
  & PropsRuntime<'sidebar.right.tab.guide.entry'>
  & PropsLocale<'gitPilot'>
  & InjectFace<GitPilotGuideInjected>

/** Milliseconds between background stat refreshes while the card is mounted. */
const REFRESH_INTERVAL_MS = 30_000

/**
 * The shipped guide capsules' own geometry (sidebar-right's guide entries):
 * same border, radius, layer, padding, and type scale, so this card sits in
 * the list without looking foreign.
 */
const styles = {
  entry: {
    boxSizing: 'border-box' as const,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 14,
    width: '100%',
    minWidth: 0,
    minHeight: 56,
    overflow: 'hidden',
    padding: '14px 20px',
    border: '0.5px solid var(--dsw-alias-border-l3)',
    borderRadius: 24,
    background: 'var(--dsw-alias-bg-layer-1)',
    color: 'inherit',
    cursor: 'pointer',
    textAlign: 'left' as const,
  },
  icon: { flex: 'none', display: 'flex', color: 'var(--dsw-alias-label-tertiary)' },
  text: { display: 'flex', flexDirection: 'column' as const, gap: 3, minWidth: 0 },
  title: {
    overflow: 'hidden',
    color: 'var(--dsw-alias-label-primary)',
    fontSize: 14,
    lineHeight: 1.4,
    whiteSpace: 'nowrap' as const,
    textOverflow: 'ellipsis',
  },
  description: {
    overflow: 'hidden',
    color: 'var(--dsw-alias-label-caption)',
    fontSize: 13,
    lineHeight: 1.4,
    whiteSpace: 'nowrap' as const,
    textOverflow: 'ellipsis',
  },
}

type Stats = { phase: 'loading' } | { phase: 'ready'; view: SessionChangesView | undefined }

/**
 * Render the live totals under the card title; picking the card opens the
 * Changes tab in this card's place, as the shipped capsules do for theirs.
 * @param props - guide copy, enclosing tab actions, locale seat, and session data.
 * @returns one guide card for the Changes surface.
 */
export function GitPilotGuide({ kind, title, useTabInfo, changes, sessionId, t }: GitPilotGuideProps): ReactNode {
  const { tab } = useTabInfo()
  const [state, setState] = useState<Stats>({ phase: 'loading' })
  // `null` = nothing applied yet: the first settle always moves the card out of
  // its loading state, including the "no data" answer.
  const fingerprintRef = useRef<string | null>(null)
  // The injected closure is rebuilt per parent render; reading it through a
  // ref keeps the poll on the latest session data without re-subscribing.
  const changesRef = useRef(changes)
  changesRef.current = changes
  useEffect(() => {
    let stopped = false
    // Fingerprint of the last applied view: a poll that saw no movement never
    // touches state, so the card neither flickers nor rerenders on idle reads.
    const poll = (): void => {
      void changesRef.current().then(view => {
        if (stopped) return
        const fingerprint = view === undefined
          ? 'no-data'
          : JSON.stringify([view.total, view.added, view.deleted, view.files.map(file => `${file.status}:${file.path}:${file.added}:${file.deleted}`)])
        if (fingerprint === fingerprintRef.current) return
        fingerprintRef.current = fingerprint
        setState({ phase: 'ready', view })
      }, () => {
        if (!stopped) setState({ phase: 'ready', view: undefined })
      })
    }
    poll()
    const timer = window.setInterval(poll, REFRESH_INTERVAL_MS)
    return () => { stopped = true; window.clearInterval(timer) }
  }, [])
  const line = state.phase === 'loading'
    ? t('guide.loading')
    // `undefined` means "no data yet" (git unavailable, baseline pending) — a
    // different fact from "this is not a repository".
    : state.view === undefined
      ? t('changes.noData')
      : state.view.repo === false
        ? t('changes.noRepo')
        : state.view.total === 0
          ? t('changes.empty')
          : t('changes.summary', { files: state.view.total, added: state.view.added, deleted: state.view.deleted })
  return (
    <button
      type="button"
      style={styles.entry}
      data-sidebar-right-guide-entry={kind}
      onClick={() => { tab.actions.openResource(changesAddress(sessionId), { replaceTab: true }) }}
    >
      <span style={styles.icon}><GitPilotGuideIcon size={26} /></span>
      <span style={styles.text}>
        <span style={styles.title}>{title}</span>
        <span style={styles.description}>{line}</span>
      </span>
    </button>
  )
}
