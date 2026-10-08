/**
 * The provider's guide card on the sidebar-right start page: the Cursor-style
 * always-visible entry. Live session-change totals under the title; picking
 * the card opens this session's Changes tab through the enclosing tab's own
 * resource action. Geometry mirrors the shipped capsules' current stylesheet
 * (width 380, radius xl, 0.5px l3 stroke, hover fill) so the card sits in the
 * list without looking foreign.
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
          ? t('changes.emptyUncommitted')
          : t('guide.uncommittedSummary', { files: state.view.total, added: state.view.added, deleted: state.view.deleted })
  return (
    <button
      type="button"
      className="dsh-git-pilot-guideEntry"
      data-sidebar-right-guide-entry={kind}
      onClick={() => { tab.actions.openResource(changesAddress(sessionId), { replaceTab: true }) }}
    >
      <span className="dsh-git-pilot-guideIcon"><GitPilotGuideIcon size={26} /></span>
      <span className="dsh-git-pilot-guideText">
        <span className="dsh-git-pilot-guideTitle">{title}</span>
        <span className="dsh-git-pilot-guideDescription">{line}</span>
      </span>
    </button>
  )
}
