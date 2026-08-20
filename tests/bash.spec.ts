import { describe, it, expect } from 'vitest'
import { Context } from 'cordis'
import { LocalBashExecutor } from '../src/bash/local.js'
import BashService from '../src/bash/index.js'
import ToolRegistry from '../src/tools/index.js'
import SystemPrompt from '../src/system-prompt/index.js'
import { createBashTool } from '../src/tools/bash.js'

describe('Milestone 2: Bash Capability Seam & Local Executor', () => {
  it('executes a standard bash command and captures stdout', async () => {
    const executor = new LocalBashExecutor()
    const result = await executor.run({ command: 'echo "hello-bash"' })

    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('hello-bash')
    expect(result.truncated).toBe(false)
    expect(result.timedOut).toBe(false)
  })

  it('captures non-zero exit code and stderr correctly without throwing', async () => {
    const executor = new LocalBashExecutor()
    const result = await executor.run({ command: 'echo "error msg" >&2; exit 42' })

    expect(result.exitCode).toBe(42)
    expect(result.stderr.trim()).toBe('error msg')
    expect(result.output).toContain('[stderr]\nerror msg')
  })

  it('truncates output exceeding maxOutputBytes', async () => {
    const executor = new LocalBashExecutor({ maxOutputBytes: 50 })
    const result = await executor.run({
      command: 'node -e "console.log(\'a\'.repeat(200))"',
    })

    expect(result.truncated).toBe(true)
    expect(result.output).toContain('[output truncated: exceeded 50 bytes limit]')
  })

  it('enforces timeout and kills process group', async () => {
    const executor = new LocalBashExecutor({ defaultTimeoutMs: 200 })
    const start = Date.now()
    const result = await executor.run({ command: 'sleep 10' })
    const elapsed = Date.now() - start

    expect(result.timedOut).toBe(true)
    expect(elapsed).toBeLessThan(2000) // Should terminate quickly, not wait 10s
  })

  it('integrates with ToolRegistry via createBashTool', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(BashService)

    const bashTool = createBashTool(ctx)
    ctx.tools.register(bashTool)

    const execResult = await ctx.tools.execute({
      callId: 'call-1',
      name: 'bash',
      arguments: { command: 'echo "tool-execution-ok"' },
    })

    expect(execResult.isError).toBe(false)
    expect(execResult.content).toBe('tool-execution-ok')
  })
})
