/** Contract smoke tests: the Host apply() wiring the Loader will exercise. */
import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

import { testConfig } from './helpers/temp-repo.ts'
import { nodeSubprocess } from './helpers/node-subprocess.ts'

function fakeHost() {
  const calls = {
    provide: [] as [string, unknown][],
    disposed: [] as ((session: { id: string }) => void)[],
    injects: [] as [readonly string[], (resolved: unknown) => void][],
    effects: 0,
    services: new Map<string, { route: { path: string; methods: string[] } }>(),
  }
  const connection = {
    fetch: {
      register(route: { path: string; methods: string[]; fetch: unknown }) {
        calls.services.set(route.path, { route })
        return undefined
      },
    },
  }
  const ctx = {
    // Services are read as properties on the real cordis context.
    subprocess: nodeSubprocess(),
    connection,
    effect(execute: () => () => void, _label?: string): void {
      calls.effects += 1
      const disposer = execute()
      if (typeof disposer === 'function') disposer()
    },
    provide(key: string, value: unknown): void {
      calls.provide.push([key, value])
    },
    on(event: 'session/disposed' | 'session/event', listener: (session: { id: string }, extra?: unknown) => void): void {
      if (event === 'session/disposed') calls.disposed.push(listener)
    },
    inject(dependencies: readonly string[], fn: (resolved: unknown) => void): void {
      calls.injects.push([dependencies, fn])
      fn(undefined)
    },
    logger: { info(): void { /* quiet */ } },
  }
  return { ctx, calls }
}

describe('apply', () => {
  it('provides the service, mounts the fetch routes, and cleans up sessions', async () => {
    const { ctx, calls } = fakeHost()
    apply(ctx as never, testConfig() as never)
    expect(calls.provide).toHaveLength(1)
    expect(calls.provide[0][0]).toBe('gitPilot')
    // Eleven exact routes: seven reads + four writes, all under /api.
    expect([...calls.services.keys()].filter(path => path.startsWith('/api/git-pilot/read'))).toHaveLength(7)
    expect([...calls.services.keys()].filter(path => path.startsWith('/api/git-pilot/write'))).toHaveLength(4)
    expect(calls.disposed).toHaveLength(1)
    const service = calls.provide[0][1] as { status(path: string): Promise<{ isRepo: boolean }> }
    await expect(service.status('/nope')).resolves.toMatchObject({ isRepo: false })
  })

  it('mounts nothing when disabled', () => {
    const { ctx, calls } = fakeHost()
    apply(ctx as never, { ...(testConfig() as Record<string, unknown>), enabled: false } as never)
    expect(calls.provide).toHaveLength(0)
    expect(calls.injects).toHaveLength(0)
  })

  it('rejects invalid bounds', () => {
    const { ctx } = fakeHost()
    expect(() => apply(ctx as never, { ...(testConfig() as Record<string, unknown>), timeoutMs: 0 } as never)).toThrow(/timeoutMs/)
  })
})
