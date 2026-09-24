/**
 * dsh-git-pilot, browser half: registers the locale dictionaries, the branch
 * control under the composer seats, and the right-Sidebar Changes tab type.
 * Every registration is defensive: when the host lacks the right-Sidebar or
 * connection services, the affected surface stays off instead of failing boot.
 *
 * The context is structural (the dsh-mnemon seam): the slots runtime merges the
 * inject face, the standard `sessionId`, and the locale `t` into one props
 * object, so the components register directly. Route calls use plain page
 * fetch() against the /api exact routes — no connection face needed.
 */
import { GitPilotApi } from './api.ts'
import { BranchControl, type BranchControlInject } from './branch-row.tsx'
import { ChangesTabBody } from './changes-tab.tsx'
import { changesAddress, changesTabDefinition, GIT_PILOT_CHANGES_ID } from './definition.ts'
import { GitPilotGuide, type GitPilotGuideInjected } from './guide-card.tsx'
import { en, NS, zh, type GitPilotKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Branch control and Changes tab copy. */
    gitPilot: GitPilotKey
  }
}

/**
 * Services whose presence this half waits on. `connection` is deliberately not
 * here: route calls use plain page fetch(). The sidebar faces and the session
 * stores are read defensively at use sites, but they stay declared because the
 * one-time registrations (the Changes type) need them activated, not absent.
 */
export const inject = ['slots', 'locale', 'sessions', 'workspaces', 'sidebarRightTabs', 'sidebarRight']

type Translate = (key: GitPilotKey, params?: Record<string, unknown>) => string

/** Structural client context: the surfaces this plugin touches, all optional. */
interface GitPilotClientContext {
  locale?: {
    register(namespace: string, dictionaries: Record<string, Record<GitPilotKey, string>>): () => void
    bind(namespace: string): Translate
  }
  slots?: {
    register(declaration: Record<string, unknown>, component: unknown): () => void
    inject(name: string, factory: () => () => void): () => void
  }
  sessions?: {
    list: {
      getSnapshot(): { current?: string; byId: Record<string, { cwd?: string }> }
    }
  }
  workspaces?: {
    list: {
      getSnapshot(): { items: readonly { title: string; path: string }[] }
    }
  }
  sidebarRightTabs?: { register(definition: unknown): () => void }
  sidebarRight?: { openResource(address: string, options?: Record<string, unknown>): void }
  effect(execute: () => (() => void) | void, label?: string): unknown
}

/**
 * Client plugin body: dictionaries, the two branch-control seats, and the
 * Changes tab type plus body.
 * @param rawContext - browser root context.
 */
export function apply(rawContext: unknown): void {
  const ctx = rawContext as GitPilotClientContext
  console.info('[dsh-git-pilot] client apply entered')
  const slots = ctx.slots
  const locale = ctx.locale
  if (slots === undefined || locale === undefined) {
    console.warn('[dsh-git-pilot] missing slots/locale service, client half inert')
    return
  }

  const api = new GitPilotApi()
  const openChanges = ctx.sidebarRight === undefined
    ? undefined
    : (sessionId: string) => { ctx.sidebarRight?.openResource(changesAddress(sessionId)) }

  ctx.effect(() => locale.register(NS, { zh, en }), 'dsh-git-pilot: dictionaries')

  const cwdOf = (sessionId: unknown): string | undefined => {
    const key = sessionId === undefined ? '' : String(sessionId)
    if (key === '') return undefined
    const snapshot = ctx.sessions?.list?.getSnapshot()
    return snapshot?.byId?.[key]?.cwd
  }
  const titleOf = (sessionId: unknown): string | undefined => {
    const cwd = cwdOf(sessionId)
    if (cwd === undefined) return undefined
    const items = ctx.workspaces?.list?.getSnapshot()?.items ?? []
    return items.find(item => item.path === cwd)?.title
  }

  // Every surface gates on the Host's own config slice; one fetch decides all
  // three mounts, and a failed read falls back to the api defaults (all on).
  // The disposed flag keeps a slow round-trip from touching a torn-down fiber
  // (HMR reload / live disable), whose ctx.effect would throw INACTIVE_EFFECT.
  let disposed = false
  ctx.effect(() => () => { disposed = true }, 'dsh-git-pilot: dispose flag')
  void api.uiOptions().then(options => {
    if (disposed) return
    console.info('[dsh-git-pilot] uiOptions resolved', JSON.stringify(options))
    // The right-Sidebar Changes tab: stage one (the type) and stage two (the body).
    const hasSidebar = ctx.sidebarRightTabs !== undefined && ctx.sidebarRight !== undefined
    console.info('[dsh-git-pilot] sidebar faces', hasSidebar)
    if (options.changesPanel && hasSidebar) {
      const t = locale.bind(NS)
      const tabDefinition = changesTabDefinition(t)
      const bodyInject = (): { api: GitPilotApi } => ({ api })
      ctx.effect(() => { ctx.sidebarRightTabs?.register(tabDefinition) }, 'dsh-git-pilot: changes type')
      ctx.effect(() => slots.inject('sidebar.right.pane.tab', () => slots.register(
        { name: 'sidebar.right.pane.tab', key: GIT_PILOT_CHANGES_ID, locale: NS, inject: bodyInject },
        ChangesTabBody,
      )), 'dsh-git-pilot: changes body')
      ctx.effect(() => slots.inject('sidebar.right.tab.guide.entry', () => slots.register(
        {
          name: 'sidebar.right.tab.guide.entry', key: GIT_PILOT_CHANGES_ID, locale: NS,
          inject: (sessionId: string): GitPilotGuideInjected => ({
            sessionId,
            changes: () => api.sessionChanges(sessionId),
          }),
        },
        GitPilotGuide,
      )), 'dsh-git-pilot: guide entry')
      console.info('[dsh-git-pilot] changes tab registered')
    }

    // The branch control: a Cursor-style row under the composer card and a
    // compact chip in the composer tool row. The inject factory runs per render
    // occurrence, so the workspace path is read fresh each time.
    const rowInject = (sessionId: unknown): BranchControlInject => ({
      api,
      cwd: cwdOf(sessionId),
      ...(openChanges === undefined ? {} : { onOpenChanges: openChanges }),
      variant: 'row',
    })
    const chipInject = (sessionId: unknown): BranchControlInject => ({
      api,
      cwd: cwdOf(sessionId),
      ...(openChanges === undefined ? {} : { onOpenChanges: openChanges }),
      variant: 'chip',
    })
    if (options.composerBranchRow) {
      ctx.effect(() => slots.inject('conversation.composer.dock', () => slots.register(
        { name: 'conversation.composer.dock', id: 'git-pilot.row', order: 20, locale: NS, inject: rowInject },
        BranchControl,
      )), 'dsh-git-pilot: composer row')
    }
    if (options.branchChip) {
      ctx.effect(() => slots.inject('conversation.input.left', () => slots.register(
        { name: 'conversation.input.left', id: 'git-pilot.chip', order: 20, locale: NS, inject: chipInject },
        BranchControl,
      )), 'dsh-git-pilot: composer chip')
      console.info('[dsh-git-pilot] chip registered')
    }
  }).catch(reason => { console.error('[dsh-git-pilot] registration failed:', reason) })
}
