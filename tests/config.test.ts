/** Config defaults, template rendering, and locale dictionary parity. */
import { describe, expect, it } from 'vitest'
import { Config } from '../src/config.ts'
import { renderBranchTemplate } from '../src/branch-template.ts'
import { en, zh } from '../src/client/locales.ts'

/** The schema is callable at runtime; go through the untyped face for defaults. */
const resolve = Config as unknown as (data?: unknown) => Record<string, unknown>

describe('Config', () => {
  it('fills every field with its documented default', () => {
    const resolved = resolve({})
    expect(resolved.enabled).toBe(true)
    expect(resolved.branchChip).toBe(true)
    expect(resolved.composerBranchRow).toBe(true)
    expect(resolved.changesPanel).toBe(true)
    expect(resolved.autoOpenChanges).toBe('firstTurn')
    expect(resolved.remoteBranches).toBe(false)
    expect(resolved.autoFetch).toBe(false)
    expect(resolved.timeoutMs).toBe(10_000)
    expect(resolved.maxBranches).toBe(200)
    expect(resolved.maxFiles).toBe(500)
    expect(resolved.maxFileBytes).toBe(2 * 1024 * 1024)
    expect(resolved.branchNameTemplate).toBe('feature/YYYYMMDD-')
    expect(resolved.protectedBranches).toEqual(['master', 'main', 'release/*'])
  })

  it('keeps overrides', () => {
    const resolved = resolve({ maxFiles: 5, autoOpenChanges: 'never' })
    expect(resolved.maxFiles).toBe(5)
    expect(resolved.autoOpenChanges).toBe('never')
  })
})

describe('renderBranchTemplate', () => {
  it('expands YYYY MM DD with today', () => {
    const now = new Date(2026, 8, 4)
    expect(renderBranchTemplate('feature/YYYYMMDD-', now)).toBe('feature/20260904-')
    expect(renderBranchTemplate('YYYY/MM/DD', now)).toBe('2026/09/04')
    expect(renderBranchTemplate('plain', now)).toBe('plain')
  })
})

describe('locales', () => {
  it('keeps zh and en dictionaries on the same key set', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  })
})
