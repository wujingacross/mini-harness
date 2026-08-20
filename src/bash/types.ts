/**
 * Bash Capability Seam Interface Types.
 * Decouples WHAT bash execution is from HOW it is implemented (local, docker, remote SSH).
 */

export interface BashRunOptions {
  command: string
  cwd?: string
  timeoutMs?: number
  signal?: AbortSignal
}

export interface BashRunResult {
  exitCode: number | null
  stdout: string
  stderr: string
  output: string
  truncated: boolean
  timedOut: boolean
  aborted: boolean
}

export abstract class BashExecutor {
  abstract run(options: BashRunOptions): Promise<BashRunResult>
}
