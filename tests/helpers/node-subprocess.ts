/** A node:child_process-backed `SubprocessLike` double for host tests. */
import { spawn as nodeSpawn } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { join } from 'node:path'
import type { SubprocessHandleLike, SubprocessLike, SubprocessSpawnSpecLike } from '../../src/git/runner.ts'

const GRACE_MS = 2_000

function spawnHandle(spec: SubprocessSpawnSpecLike): SubprocessHandleLike {
  const child = nodeSpawn(spec.argv[0] ?? '', spec.argv.slice(1), {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const collect = (stream: NodeJS.ReadableStream | null, maxBytes: number): { readFrom(): { text: string; lossy: boolean } } => {
    const chunks: Buffer[] = []
    let total = 0
    let lossy = false
    if (stream === null) return { readFrom: () => ({ text: '', lossy: false }) }
    stream.on('data', (chunk: Buffer) => {
      if (total >= maxBytes) {
        lossy = true
        return
      }
      chunks.push(chunk)
      total += chunk.length
      if (total > maxBytes) {
        lossy = true
        chunks[chunks.length - 1] = (chunk as Buffer).subarray(0, maxBytes - (total - chunk.length))
      }
    })
    return { readFrom: () => ({ text: Buffer.concat(chunks).toString('utf8'), lossy }) }
  }
  const stdout = collect(child.stdout, spec.stdio.stdout.maxBytes)
  const stderr = collect(child.stderr, spec.stdio.stderr.maxBytes)
  const done = new Promise<{ exitCode: number | null }>(resolve => {
    let settled = false
    const settle = (exitCode: number | null): void => {
      if (!settled) {
        settled = true
        resolve({ exitCode })
      }
    }
    child.on('exit', code => settle(code))
    child.on('error', () => settle(null))
    const signal = spec.signal
    const abort = (): void => {
      child.kill('SIGTERM')
      const timer = setTimeout(() => { child.kill('SIGKILL') }, GRACE_MS)
      timer.unref?.()
    }
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
  if (spec.stdio.stdin !== 'ignore') (child.stdin as unknown as { end(): void } | null)?.end()
  return {
    done,
    collected: { stdout: { readFrom: () => stdout.readFrom() }, stderr: { readFrom: () => stderr.readFrom() } },
  }
}

/** Resolve executables from PATH like the runtime service does. */
function resolveExecutableSync(command: string): string {
  if (command.includes('/')) {
    accessSync(command, constants.X_OK)
    return command
  }
  const segments = (process.env.PATH ?? '').split(':')
  for (const segment of segments) {
    if (segment === '') continue
    const candidate = join(segment, command)
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      // keep looking
    }
  }
  throw new Error(`executable not found: ${command}`)
}

/** The double. */
export function nodeSubprocess(): SubprocessLike {
  return {
    async resolveExecutable(command) {
      return resolveExecutableSync(command)
    },
    spawn(spec) {
      return spawnHandle(spec)
    },
  }
}
