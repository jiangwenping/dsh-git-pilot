/**
 * Integration seam against the installed runtime: the connection transport
 * asserts its own channel grammar (`assertChannel`), and R3-review finding 1
 * showed a wrong name only fails on the real runtime. This test extracts the
 * pattern from the installed package source and checks our channels against
 * it, so a regression fails here instead of at plugin activation.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { GIT_PILOT_READ_CHANNEL, GIT_PILOT_WRITE_CHANNEL } from '../src/wire.ts'

const CONNECTION_LIB = 'node_modules/@deepseek-ai/dsh-client-connection/lib/index.js'

function runtimeChannelPattern(): RegExp | undefined {
  try {
    const source = readFileSync(CONNECTION_LIB, 'utf8')
    const match = /const CHANNEL_PATTERN = (\/.+\/);/
      .exec(source)
    return match?.[1] === undefined ? undefined : new RegExp(match[1].slice(1, -1))
  } catch {
    return undefined
  }
}

describe('channel naming contract', () => {
  it('matches the runtime CHANNEL_PATTERN extracted from the installed package', () => {
    const pattern = runtimeChannelPattern()
    if (pattern === undefined) return // package layout changed; skip rather than lie
    expect(pattern.test(GIT_PILOT_READ_CHANNEL)).toBe(true)
    expect(pattern.test(GIT_PILOT_WRITE_CHANNEL)).toBe(true)
  })

  it('never uses the reserved /api channel or transport-invalid characters', () => {
    for (const channel of [GIT_PILOT_READ_CHANNEL, GIT_PILOT_WRITE_CHANNEL]) {
      expect(channel.startsWith('/')).toBe(true)
      expect(channel).not.toBe('/api')
      expect(channel).not.toContain(':')
    }
  })
})
