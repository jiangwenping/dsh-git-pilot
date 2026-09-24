/**
 * Plugin configuration: bounds for every git command and UI surface switches.
 * Invalid values fail plugin load, mirroring the workspace-changes plugin.
 */
import z from 'schemastery'
import { DEFAULT_BRANCH_TEMPLATE } from './branch-template.ts'

/** When the Changes tab opens by itself. */
export type AutoOpenChanges = 'never' | 'firstTurn' | 'always'

export interface GitPilotConfig {
  /** Master switch; `false` unmounts every surface and RPC channel. */
  enabled: boolean
  /** Compact branch chip in the composer tool row. */
  branchChip: boolean
  /** Cursor-style branch row below the composer card. */
  composerBranchRow: boolean
  /** The right-Sidebar Changes tab type. */
  changesPanel: boolean
  /** When the Changes tab opens by itself. */
  autoOpenChanges: AutoOpenChanges
  /** List remote branches in the branch menu. */
  remoteBranches: boolean
  /** Run `git fetch --prune` when the branch menu opens. Network side effect. */
  autoFetch: boolean
  /** Milliseconds one git command may run. */
  timeoutMs: number
  /** Branch rows the menu keeps; the rest are dropped and flagged. */
  maxBranches: number
  /** Changed-file rows one summary keeps; totals stay complete. */
  maxFiles: number
  /** Bytes of one file read for line counts and comparisons. */
  maxFileBytes: number
  /** Prefill of the create-branch field; `YYYY` `MM` `DD` expand to today. */
  branchNameTemplate: string
  /** Glob-lite patterns (exact or trailing `/*`) the checkout guard protects. */
  protectedBranches: string[]
}

/** Schemastery validation for {@link GitPilotConfig}. */
export const Config = z.object({
  enabled: z.boolean().default(true),
  branchChip: z.boolean().default(true),
  composerBranchRow: z.boolean().default(true),
  changesPanel: z.boolean().default(true),
  autoOpenChanges: z.union([z.const('never'), z.const('firstTurn'), z.const('always')]).default('firstTurn'),
  remoteBranches: z.boolean().default(false),
  autoFetch: z.boolean().default(false),
  timeoutMs: z.number().default(10_000),
  maxBranches: z.number().default(200),
  maxFiles: z.number().default(500),
  maxFileBytes: z.number().default(2 * 1024 * 1024),
  branchNameTemplate: z.string().default(DEFAULT_BRANCH_TEMPLATE),
  protectedBranches: z.array(z.string()).default(['master', 'main', 'release/*']),
}) as unknown as z<GitPilotConfig>
