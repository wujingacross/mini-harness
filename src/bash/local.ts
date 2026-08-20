import { spawn } from 'node:child_process'
import { BashExecutor, type BashRunOptions, type BashRunResult } from './types.js'

export interface LocalBashConfig {
  defaultCwd?: string
  defaultTimeoutMs?: number
  maxOutputBytes?: number
}

/**
 * 工业级本地 Bash 执行器：
 * 1. 进程组隔离（detached: true）与级联清理（kill -pid），杜绝孤儿/僵尸子进程；
 * 2. 内存输出上限截断（Output Truncation），保护大模型上下文窗口；
 * 3. 超时强杀（Timeout Escalation：SIGTERM -> SIGKILL）与异步取消（AbortSignal）支持。
 */
export class LocalBashExecutor extends BashExecutor {
  private defaultCwd: string
  private defaultTimeoutMs: number
  private maxOutputBytes: number

  constructor(config: LocalBashConfig = {}) {
    super()
    this.defaultCwd = config.defaultCwd || process.cwd()
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? 120_000
    this.maxOutputBytes = config.maxOutputBytes ?? 64 * 1024
  }

  async run(options: BashRunOptions): Promise<BashRunResult> {
    const cwd = options.cwd || this.defaultCwd
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs

    return new Promise<BashRunResult>((resolve, reject) => {
      let stdoutBuffer = ''
      let stderrBuffer = ''
      let truncated = false
      let timedOut = false
      let aborted = false
      let settled = false

      let child: ReturnType<typeof spawn>

      try {
        child = spawn('bash', ['-c', options.command], {
          cwd,
          detached: true, // 创建独立进程组
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, PAGER: 'cat' },
        })
      } catch (err) {
        return reject(err)
      }

      const pid = child.pid

      // 强杀整个进程组（包括子命令启动的子孙进程）
      const killProcessGroup = (signal: NodeJS.Signals = 'SIGTERM') => {
        if (!pid) return
        try {
          // 在 Unix/macOS 下，向负 PID 发信号会发送给整个进程组
          process.kill(-pid, signal)
        } catch {
          try {
            child.kill(signal)
          } catch {
            // ignore
          }
        }
      }

      // 超时定时器与梯度升级 (SIGTERM -> 2s 宽限期 -> SIGKILL)
      let timer: NodeJS.Timeout | undefined
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true
          killProcessGroup('SIGTERM')
          setTimeout(() => {
            if (!settled) killProcessGroup('SIGKILL')
          }, 2000)
        }, timeoutMs)
      }

      // 异步 AbortSignal 取消监听
      if (options.signal) {
        if (options.signal.aborted) {
          aborted = true
          killProcessGroup('SIGKILL')
        } else {
          options.signal.addEventListener('abort', () => {
            aborted = true
            killProcessGroup('SIGTERM')
            setTimeout(() => {
              if (!settled) killProcessGroup('SIGKILL')
            }, 2000)
          }, { once: true })
        }
      }

      const appendOutput = (isStderr: boolean, chunk: Buffer) => {
        const str = chunk.toString('utf-8')
        const currentLen = stdoutBuffer.length + stderrBuffer.length
        if (currentLen + str.length > this.maxOutputBytes) {
          truncated = true
          const remaining = Math.max(0, this.maxOutputBytes - currentLen)
          if (remaining > 0) {
            if (isStderr) stderrBuffer += str.slice(0, remaining)
            else stdoutBuffer += str.slice(0, remaining)
          }
        } else {
          if (isStderr) stderrBuffer += str
          else stdoutBuffer += str
        }
      }

      child.stdout?.on('data', (chunk) => appendOutput(false, chunk))
      child.stderr?.on('data', (chunk) => appendOutput(true, chunk))

      child.on('error', (err) => {
        if (timer) clearTimeout(timer)
        settled = true
        reject(err)
      })

      child.on('close', (exitCode) => {
        if (timer) clearTimeout(timer)
        settled = true

        let combined = stdoutBuffer
        if (stderrBuffer) {
          combined = combined ? `${combined}\n[stderr]\n${stderrBuffer}` : `[stderr]\n${stderrBuffer}`
        }
        if (truncated) {
          combined += `\n[output truncated: exceeded ${this.maxOutputBytes} bytes limit]`
        }

        resolve({
          exitCode,
          stdout: stdoutBuffer,
          stderr: stderrBuffer,
          output: combined,
          truncated,
          timedOut,
          aborted,
        })
      })
    })
  }
}
