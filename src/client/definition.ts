/** Stage-one registration of the Changes tab type: what it IS and which addresses it claims. */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { GitPilotKey } from './locales.ts'
import { GitPilotGuideIcon } from './guide-icon.tsx'

/** The tab kind this plugin owns. */
export const GIT_PILOT_CHANGES_KIND = 'git-pilot-changes'

/** This implementation's identity, and the key the body registers under. */
export const GIT_PILOT_CHANGES_ID = 'dsh-git-pilot'

/** The address of one session's Changes tab. */
export function changesAddress(sessionId: string): string {
  return `dsh-resource://${GIT_PILOT_CHANGES_KIND}/session/${encodeURIComponent(sessionId)}`
}

/** Extract the session id from a claimed address, or undefined when foreign. */
export function parseChangesAddress(address: string): string | undefined {
  const prefix = `dsh-resource://${GIT_PILOT_CHANGES_KIND}/session/`
  if (!address.startsWith(prefix)) return undefined
  try {
    const sessionId = decodeURIComponent(address.slice(prefix.length))
    return sessionId === '' ? undefined : sessionId
  } catch {
    return undefined
  }
}

/**
 * The registry definition; copy thunks read fresh so a language change needs
 * no re-register. The guide entry puts a Changes capsule on the sidebar-right
 * start page; its card renderer (keyed by this id) opens the session's tab.
 */
export function changesTabDefinition(t: (key: GitPilotKey, params?: Record<string, unknown>) => string): SidebarRightTabDefinition {
  return {
    id: GIT_PILOT_CHANGES_ID,
    kind: GIT_PILOT_CHANGES_KIND,
    patterns: [`dsh-resource://${GIT_PILOT_CHANGES_KIND}/**`],
    priority: 'extension',
    canOpen: address => parseChangesAddress(address) !== undefined,
    title: () => t('changes.tabTitle'),
    guide: [{
      id: 'changes',
      order: 30,
      title: () => t('changes.tabTitle'),
      description: () => t('guide.description'),
      icon: GitPilotGuideIcon,
    }],
  }
}
