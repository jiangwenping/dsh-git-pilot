/**
 * Runs the resolved git executable through the subprocess capability with a
 * per-command timeout, a scrubbed environment, and bounded in-memory output.
 * The subprocess face is structural, so tests can substitute a node-based
 * double without the DSH runtime.
 */

/** Milliseconds a git child gets to exit after termination starts. */
const TERMINATE_GRACE_MS = 2_000
/** Retained stderr tail for diagnostics. */
const STDERR_TAIL_BYTES = 16 * 1024

/** One collected output stream. */
export interface OutputReaderLike {
  readFrom(offset: number): { text: string; lossy: boolean }
}

/** A settled subprocess handle, as `@deepseek-ai/dsh-subprocess` yields it. */
export interface SubprocessHandleLike {
  done: Promise<{ exitCode: number | null }>
  collected: { stdout?: OutputReaderLike; stderr?: OutputReaderLike }
}

/** The spawn spec this plugin issues; mirrors the runtime's structural subset. */
export interface SubprocessSpawnSpecLike {
  argv: readonly string[]
  cwd: string
  env?: Readonly<Record<string, string>>
  stdio: {
    stdin: 'ignore' | { data: string }
    stdout: { maxBytes: number }
    stderr: { maxBytes: number }
  }
  graceMs?: number
  signal: AbortSignal
}

/** The subprocess capability this plugin uses. */
export interface SubprocessLike {
  resolveExecutable(command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<string>
  spawn(spec: SubprocessSpawnSpecLike): SubprocessHandleLike
}

/** Settled git command facts; a nonzero exit is a result, not an exception. */
export interface GitRunResult {
  exitCode: number | null
  stdout: string
  stderr: string
  /** True when stdout exceeded the output cap and lost its tail. */
  truncated: boolean
}

export interface GitRunOptions {
  cwd: string
  signal: AbortSignal
  /** Per-command stdout cap, replacing the runner's `outputMaxBytes`. */
  maxBytes?: number
}

/** Per-runner bounds. */
export interface GitLimits {
  timeoutMs: number
  outputMaxBytes: number
}

/** Runs one resolved git executable. */
export class GitRunner {
  constructor(
    private readonly subprocess: SubprocessLike,
    private readonly executable: string,
    private readonly limits: GitLimits,
  ) {}

  /**
   * Run `git <args>` to completion.
   * @throws when the command times out, is aborted, or cannot spawn.
   */
  async run(args: readonly string[], options: GitRunOptions): Promise<GitRunResult> {
    const timeout = AbortSignal.timeout(this.limits.timeoutMs)
    const signal = AbortSignal.any([options.signal, timeout])
    const handle = this.subprocess.spawn({
      argv: [this.executable, ...args],
      cwd: options.cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: options.maxBytes ?? this.limits.outputMaxBytes },
        stderr: { maxBytes: STDERR_TAIL_BYTES },
      },
      graceMs: TERMINATE_GRACE_MS,
      signal,
      // Prompting, config includes, and optional locks all become failures or
      // slowdowns in a headless context; keep every command deterministic.
      env: { GIT_CONFIG_COUNT: '0', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
    })
    const outcome = await handle.done
    if (signal.aborted) {
      throw new Error(`git ${args.join(' ')} ${timeout.aborted ? `timed out after ${this.limits.timeoutMs}ms` : 'was aborted'}`)
    }
    const stdout = handle.collected.stdout?.readFrom(0) ?? { text: '', lossy: false }
    const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
    return { exitCode: outcome.exitCode, stdout: stdout.text, stderr, truncated: stdout.lossy }
  }
}

/**
 * Resolve the git executable once. On macOS the Xcode stub at `/usr/bin/git`
 * opens an installer dialog instead of running, so it counts as absent until
 * developer tools are installed (the same probe the workspace-changes plugin makes).
 */
export async function resolveGitExecutable(subprocess: SubprocessLike, signal: AbortSignal): Promise<string | null> {
  let executable: string
  try {
    executable = await subprocess.resolveExecutable('git', undefined, signal)
  } catch {
    return null
  }
  if (process.platform !== 'darwin' || executable !== '/usr/bin/git') return executable
  try {
    const probe = subprocess.spawn({
      argv: ['/usr/bin/xcode-select', '-p'],
      cwd: process.env.HOME ?? '/',
      stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } },
      graceMs: 1_000,
      signal,
    })
    const outcome = await probe.done.catch(() => ({ exitCode: null }))
    return outcome.exitCode === 0 ? executable : null
  } catch {
    return null
  }
}
