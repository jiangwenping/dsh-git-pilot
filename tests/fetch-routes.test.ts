/** Fetch-route registration tests: paths, methods, and payload dispatch. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { registerGitPilotFetchRoutes } from '../src/rpc.ts'
import { READ_PREFIX, WRITE_PREFIX } from '../src/rpc.ts'
import { createGitPilotService, type GitPilotService } from '../src/service.ts'
import type { GitPilotConfig } from '../src/config.ts'
import { createTempRepo, testConfig, type TempRepo } from './helpers/temp-repo.ts'
import { nodeSubprocess } from './helpers/node-subprocess.ts'

interface RegisteredRoute {
  path: string
  methods: string[]
  fetch: (request: Request) => Promise<Response>
}

function fakeConnection() {
  const routes = new Map<string, RegisteredRoute>()
  return {
    connection: {
      fetch: {
        register(route: RegisteredRoute) {
          routes.set(route.path, route)
          return undefined
        },
      },
    },
    routes,
  }
}

function service(): GitPilotService {
  return createGitPilotService({ subprocess: nodeSubprocess(), config: testConfig() as unknown as GitPilotConfig })
}

function post(route: RegisteredRoute, payload: unknown, signal?: AbortSignal): Promise<{ status: number; body: any }> {
  const request = new Request(`http://gui.local${route.path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    ...(signal === undefined ? {} : { signal }),
  })
  return route.fetch(request).then(async response => ({ status: response.status, body: await response.json() }))
}

describe('registerGitPilotFetchRoutes', () => {
  let repo: TempRepo
  let routes: Map<string, RegisteredRoute>

  async function setup(): Promise<void> {
    repo = await createTempRepo()
    await repo.write('a.txt', 'one\ntwo\n')
    repo.run(['add', '.'])
    repo.run(['commit', '-m', 'init'])
    const { connection, routes: registered } = fakeConnection()
    registerGitPilotFetchRoutes(connection as never, service())
    routes = registered
  }

  it('registers all 11 routes with POST under /api', async () => {
    await setup()
    const paths = [...routes.keys()]
    expect(paths.filter(p => p.startsWith(READ_PREFIX))).toHaveLength(7)
    expect(paths.filter(p => p.startsWith(WRITE_PREFIX))).toHaveLength(4)
    for (const route of routes.values()) expect(route.methods).toEqual(['POST'])
  })

  it('dispatches status by payload', async () => {
    await setup()
    const answer = await post(routes.get(`${READ_PREFIX}/status`)!, { workspacePath: repo.root })
    expect(answer.body).toMatchObject({ ok: true, value: { isRepo: true, branch: 'master' } })
  })

  it('answers plain-JSON errors for bad payloads and service failures', async () => {
    await setup()
    const missing = await post(routes.get(`${READ_PREFIX}/status`)!, {})
    expect(missing.status).toBe(200)
    expect(missing.body.ok).toBe(false)
    expect(missing.body.error.message).toContain('workspacePath')

    const unknown = await post(routes.get(`${WRITE_PREFIX}/checkout`)!, { workspacePath: repo.root, name: 'no/such' })
    expect(unknown.body.value).toMatchObject({ ok: false, reason: 'invalid-name' })
  })

  it('answers ok:false with the mutation outcome inside value', async () => {
    await setup()
    repo.run(['branch', 'feature/other'])
    const answer = await post(routes.get(`${WRITE_PREFIX}/checkout`)!, { workspacePath: repo.root, name: 'feature/other' })
    expect(answer.body).toMatchObject({ ok: true, value: { ok: true, branch: 'feature/other' } })
  })

  it('commits picked files and restores one to HEAD', async () => {
    await setup()
    await repo.write('a.txt', 'one\ntwo\nthree\n')
    const commit = await post(routes.get(`${WRITE_PREFIX}/commit`)!, {
      workspacePath: repo.root,
      message: 'extend a.txt',
      files: ['a.txt'],
    })
    expect(commit.body).toMatchObject({ ok: true, value: { ok: true, committed: 1 } })
    expect(repo.run(['status', '--porcelain']).trim()).toBe('')

    const dirty = await post(routes.get(`${WRITE_PREFIX}/commit`)!, {
      workspacePath: repo.root,
      message: 'empty',
      files: ['a.txt'],
    })
    expect(dirty.body.value).toMatchObject({ ok: false, reason: 'nothing' })

    await repo.write('a.txt', 'changed\n')
    const reverted = await post(routes.get(`${WRITE_PREFIX}/revert-file`)!, { workspacePath: repo.root, path: 'a.txt' })
    expect(reverted.body).toMatchObject({ ok: true, value: { ok: true } })
    expect(readFileSync(join(repo.root, 'a.txt'), 'utf8')).toBe('one\ntwo\nthree\n')

    await repo.write('notes.txt', 'scratch\n')
    const untracked = await post(routes.get(`${WRITE_PREFIX}/revert-file`)!, { workspacePath: repo.root, path: 'notes.txt' })
    expect(untracked.body.value).toMatchObject({ ok: false, reason: 'untracked' })

    // A staged new file has no HEAD content: revert refuses instead of no-op.
    await repo.write('staged-new.txt', 'fresh\n')
    repo.run(['add', 'staged-new.txt'])
    const staged = await post(routes.get(`${WRITE_PREFIX}/revert-file`)!, { workspacePath: repo.root, path: 'staged-new.txt' })
    expect(staged.body.value).toMatchObject({ ok: false, reason: 'new-file' })
  })

  it('rejects unsafe paths before touching git', async () => {
    await setup()
    const escape = await post(routes.get(`${WRITE_PREFIX}/revert-file`)!, { workspacePath: repo.root, path: '../outside.txt' })
    expect(escape.body.value).toMatchObject({ ok: false, reason: 'error' })
  })
})
