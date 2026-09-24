/**
 * Route registration on the connection service's exact-fetch registry — the
 * same official mechanism `/api/changes.summary` uses. The generic
 * `connection.rpc.handle(channel, …)` path is avoided on purpose: in
 * 0.1.7-alpha.2 its registration touches `webServer` through the connection
 * service's own context, which cordis rejects ("without inject") for any
 * external plugin. Exact routes under `/api` are the supported surface.
 *
 * Every route is POST, takes a plain JSON payload, and answers plain JSON:
 * `{ ok: true, value }` or `{ ok: false, error: { message } }`.
 */
import { appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CheckoutConfirm, GitPilotService } from './service.ts'

/** Debug logger (temporary): mirrors registration state to the tmpdir. */
function debugLog(message: string): void {
  try {
    appendFileSync(join(tmpdir(), 'dsh-git-pilot-debug.log'), `${new Date().toISOString()} ${message}\n`)
  } catch { /* ignore */ }
}

/** Structural face of the connection service this plugin registers routes on. */
export interface ConnectionFetchRegistry {
  fetch: {
    register(route: {
      path: string
      methods: string[]
      requestBody?: string
      fetch: (request: Request) => Promise<Response>
    }): unknown
  }
}

export const READ_PREFIX = '/api/git-pilot/read'
export const WRITE_PREFIX = '/api/git-pilot/write'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('payload must be an object')
  return value as Record<string, unknown>
}

function requiredString(payload: Record<string, unknown>, field: string): string {
  const value = payload[field]
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`payload.${field} must be a non-empty string`)
  return value
}

function optionalString(payload: Record<string, unknown>, field: string): string | undefined {
  const value = payload[field]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`payload.${field} must be a non-empty string when present`)
  return value
}

function optionalStringArray(payload: Record<string, unknown>, field: string): string[] {
  const value = payload[field]
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    throw new Error(`payload.${field} must be an array of strings when present`)
  }
  return value as string[]
}

const CONFIRM_TOKENS: readonly CheckoutConfirm[] = ['dirty', 'busy-sessions', 'protected']

function optionalConfirm(payload: Record<string, unknown>): readonly CheckoutConfirm[] {
  const value = payload.confirm
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('payload.confirm must be an array when present')
  return value.filter((token): token is CheckoutConfirm => typeof token === 'string' && (CONFIRM_TOKENS as readonly string[]).includes(token))
}

/** Register one exact POST route whose handler answers with plain JSON. */
function route(
  connection: ConnectionFetchRegistry,
  path: string,
  run: (payload: Record<string, unknown>, signal: AbortSignal) => unknown,
): void {
  connection.fetch.register({
    path,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request: Request): Promise<Response> => {
      const payload = await request.json().catch(() => ({}))
      try {
        if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw new Error('payload must be an object')
        return json({ ok: true, value: await run(payload as Record<string, unknown>, request.signal) })
      } catch (error) {
        return json({ ok: false, error: { message: error instanceof Error ? error.message : String(error) } })
      }
    },
  })
  debugLog(`route registered: ${path}`)
}

/** Register every plugin route on the connection service's fetch registry. */
export function registerGitPilotFetchRoutes(connection: ConnectionFetchRegistry, service: GitPilotService): void {
  debugLog('registerGitPilotFetchRoutes: registering 10 routes')
  // Read routes
  route(connection, `${READ_PREFIX}/status`, (payload, signal) => service.status(requiredString(payload, 'workspacePath'), signal))
  route(connection, `${READ_PREFIX}/branches`, (payload, signal) => service.branches(requiredString(payload, 'workspacePath'), signal))
  route(connection, `${READ_PREFIX}/ui-options`, () => service.uiOptions())
  route(connection, `${READ_PREFIX}/ensure-baseline`, (payload, signal) => service.ensureBaseline(
    requiredString(payload, 'sessionId'),
    optionalString(payload, 'workspacePath'),
    signal,
  ))
  route(connection, `${READ_PREFIX}/session-changes`, (payload, signal) => service.sessionChanges(requiredString(payload, 'sessionId'), signal))
  route(connection, `${READ_PREFIX}/session-file-diff`, (payload, signal) => {
    const path = requiredString(payload, 'path')
    if (payload.scope === 'head') {
      return service.uncommittedFileDiff(requiredString(payload, 'workspacePath'), path, signal)
    }
    return service.sessionFileDiff(requiredString(payload, 'sessionId'), path, signal)
  })
  route(connection, `${READ_PREFIX}/uncommitted`, (payload, signal) => service.uncommittedChanges(
    requiredString(payload, 'workspacePath'),
    signal,
  ))
  // Write routes — user-initiated only (each UI call site is a click)
  route(connection, `${WRITE_PREFIX}/create-branch`, (payload, signal) => service.createBranch(
    requiredString(payload, 'workspacePath'),
    requiredString(payload, 'name'),
    { from: optionalString(payload, 'from') },
    signal,
  ))
  route(connection, `${WRITE_PREFIX}/checkout`, (payload, signal) => service.checkout(
    requiredString(payload, 'workspacePath'),
    requiredString(payload, 'name'),
    { confirm: optionalConfirm(payload), excludeSessionId: optionalString(payload, 'sessionId') },
    signal,
  ))
  route(connection, `${WRITE_PREFIX}/commit`, (payload, signal) => service.commit(
    requiredString(payload, 'workspacePath'),
    requiredString(payload, 'message'),
    optionalStringArray(payload, 'files'),
    signal,
  ))
  route(connection, `${WRITE_PREFIX}/revert-file`, (payload, signal) => service.revertFile(
    requiredString(payload, 'workspacePath'),
    requiredString(payload, 'path'),
    signal,
  ))
}
