/**
 * dsh-git-pilot, Host half: provides the `gitPilot` service and mounts both
 * connection-RPC channels when a web connection exists. Everything centers on
 * one subprocess capability; the optional workspace registry restricts branch
 * mutations to registered workspaces, and the optional agent registry powers
 * the busy-session guard.
 *
 * The context is typed structurally on purpose: it mirrors the plugin contract
 * the Loader enforces at runtime while keeping this package decoupled from the
 * host's exact cordis typings (the same seam dsh-mnemon uses).
 */
import { Config, type GitPilotConfig, type AutoOpenChanges } from './config.ts'
import { createGitPilotService, type GitPilotService, type WorkspaceRegistryLike, type AgentsRegistryLike } from './service.ts'
import { registerGitPilotFetchRoutes, type ConnectionFetchRegistry } from './rpc.ts'
import type { SubprocessLike } from './git/runner.ts'

export { Config }
export type { GitPilotConfig, AutoOpenChanges }
export type { GitPilotService }
export { renderBranchTemplate } from './branch-template.ts'
export * from './wire.ts'

/** Stable Loader identity. */
export const name = 'dsh-git-pilot'

/** Services this plugin provides. */
export const provide = ['gitPilot']

/**
 * Services this plugin reads. cordis enforces inject-declared access: reading an
 * undeclared service property throws, which is how the RPC channels went missing
 * on the live runtime. webServer is transitively required by the connection
 * service's channel registration; workspaceRegistry and agents power the mutation
 * guards. All except subprocess are Web-profile infrastructure — the plugin
 * targets the Web GUI (documented in the README).
 */
export const inject = ['subprocess', 'connection', 'webServer', 'workspaceRegistry', 'agents']

/** The structural view of the host context this plugin consumes. */
export interface HostContextShape {
  subprocess?: unknown
  effect(execute: () => (() => void | Promise<void>) | void, label?: string): unknown
  provide?(key: string, value: unknown): unknown
  on(event: 'session/disposed', listener: (session: { id: string }) => void): unknown
  on(event: 'session/event', listener: (session: { id: string; header?: { cwd?: string } }, event: { type?: string }) => void): unknown
  get?(key: string): unknown
  inject?(dependencies: readonly string[], fn: (resolved: unknown) => void): unknown
  logger?: { info?(message: string): void; warn?(message: string): void }
}

/**
 * Read a service by key through cordis's service-property access. The Context
 * in this runtime generation has no `get(key)` method — property access is the
 * only reliable read (the same seam `ctx.subprocess` uses).
 */
function readService(ctx: HostContextShape, key: string): unknown {
  try {
    return (ctx as unknown as Record<string, unknown>)[key]
  } catch {
    // Undeclared service access throws in cordis; treat as absent.
    return undefined
  }
}

/** Validate the numeric bounds; invalid values fail plugin load. */
function assertConfig(config: GitPilotConfig): void {
  for (const [field, value] of [
    ['timeoutMs', config.timeoutMs], ['maxBranches', config.maxBranches], ['maxFiles', config.maxFiles],
    ['maxFileBytes', config.maxFileBytes],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`dsh-git-pilot requires a positive integer ${field}`)
  }
  const autoOpen: readonly string[] = ['never', 'firstTurn', 'always']
  if (!autoOpen.includes(config.autoOpenChanges)) throw new Error(`dsh-git-pilot requires autoOpenChanges to be one of ${autoOpen.join(' | ')}`)
}

/**
 * Mount the service and its RPC channels.
 * @param rawContext - host context with `subprocess`.
 * @param config - validated plugin configuration.
 */
export function apply(rawContext: unknown, config: GitPilotConfig): void {
  try {
    applyInner(rawContext, config)
  } catch (error) {
      throw error
  }
}

function applyInner(rawContext: unknown, config: GitPilotConfig): void {
  assertConfig(config)
  const ctx = rawContext as HostContextShape
  const subprocess = ctx.subprocess as unknown as SubprocessLike
  // Both registries resolve lazily per call: load order never decides whether
  // the path guard exists (the dsh-mnemon seam).
  const service: GitPilotService = createGitPilotService({
    subprocess,
    config,
    getRegistry: () => readService(ctx, 'workspaceRegistry') as WorkspaceRegistryLike | undefined,
    getAgents: () => readService(ctx, 'agents') as AgentsRegistryLike | undefined,
    log: message => { ctx.logger?.info?.(message) },
  })

  ctx.effect(() => () => { service.dispose() }, 'dsh-git-pilot: dispose')
  ctx.provide?.('gitPilot', service)
  ctx.on('session/disposed', session => { service.forgetSession(session.id) })
  // FR-2.4's proactive arm: the baseline exists from the first turn start, so
  // a Bash edit before any client call still counts as session work.
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/start') return
    const cwd = session.header?.cwd
    if (cwd !== undefined) void service.ensureBaseline(session.id, cwd)
  })

  // This bundle composes LAST, so the connection service is already available
  // at apply time — register the routes immediately.
  const connection = readService(ctx, 'connection') as ConnectionFetchRegistry | undefined
  if (connection !== undefined) registerGitPilotFetchRoutes(connection, service)
}
