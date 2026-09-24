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

const styles = {
  entry: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    padding: '12px 14px',
    borderRadius: 10,
    border: '1px solid var(--dsw-alias-border-subtle, #2c2c30)',
    background: 'var(--dsw-alias-surface-raised, #1b1b1e)',
    cursor: 'pointer',
    textAlign: 'left' as const,
  },
  icon: { color: 'var(--dsw-alias-label-secondary, #9a9aa0)', flexShrink: 0, display: 'flex' },
  text: { display: 'flex', flexDirection: 'column' as const, gap: 2, minWidth: 0 },
  title: { color: 'var(--dsw-alias-label-primary, #ececec)', fontSize: 13, fontWeight: 500 },
  description: { color: 'var(--dsw-alias-label-secondary, #9a9aa0)', fontSize: 12 },
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
  const fingerprintRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    let stopped = false
    // Fingerprint of the last applied view: a poll that saw no movement never
    // touches state, so the card neither flickers nor rerenders on idle reads.
    const poll = (): void => {
      void changes().then(view => {
        if (stopped) return
        const fingerprint = view === undefined
          ? undefined
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
  }, [changes])
  const line = state.phase === 'loading'
    ? t('guide.loading')
    : state.view === undefined || state.view.repo === false
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
