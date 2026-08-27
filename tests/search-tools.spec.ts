import { describe, it, expect, beforeEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { Context } from 'cordis'
import SystemPrompt from '../src/system-prompt/index.js'
import ToolRegistry from '../src/tools/index.js'
import { createSearchTools } from '../src/tools/search.js'

const testDir = join(process.cwd(), '.tmp-test-search-tools')

describe('Milestone 6: Code & File Search Toolchain', () => {
  beforeEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true })
    await fs.mkdir(join(testDir, 'src/sub'), { recursive: true })
    await fs.mkdir(join(testDir, 'node_modules/ignore-pkg'), { recursive: true })

    await fs.writeFile(join(testDir, 'src/agent.ts'), 'export class Agent {\n  name = "deepseek";\n}', 'utf-8')
    await fs.writeFile(join(testDir, 'src/sub/helper.ts'), 'export function helper() {\n  return "deepseek-helper";\n}', 'utf-8')
    await fs.writeFile(join(testDir, 'README.md'), '# Mini Harness Documentation', 'utf-8')
    await fs.writeFile(join(testDir, 'node_modules/ignore-pkg/index.js'), 'export const secret = "ignore-me";', 'utf-8')
  })

  async function setupTools() {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    const searchTools = createSearchTools(ctx, { workspaceDir: testDir })
    for (const t of searchTools) {
      ctx.tools.register(t)
    }
    return { ctx, searchTools }
  }

  describe('find_by_name', () => {
    it('finds files matching glob pattern while excluding node_modules', async () => {
      const { ctx } = await setupTools()

      const res = await ctx.tools.execute({
        callId: 'call-s1',
        name: 'find_by_name',
        arguments: { pattern: '*.ts' },
      })

      expect(res.content).toContain('Found 2 matching file(s)')
      expect(res.content).toContain('src/agent.ts')
      expect(res.content).toContain('src/sub/helper.ts')
      expect(res.content).not.toContain('node_modules')
    })
  })

  describe('grep_search', () => {
    it('searches text across files and reports line numbers and snippets', async () => {
      const { ctx } = await setupTools()

      const res = await ctx.tools.execute({
        callId: 'call-s2',
        name: 'grep_search',
        arguments: { query: 'deepseek' },
      })

      expect(res.content).toContain('Found 2 match(es)')
      expect(res.content).toContain('src/agent.ts:2: name = "deepseek";')
      expect(res.content).toContain('src/sub/helper.ts:2: return "deepseek-helper";')
      expect(res.content).not.toContain('node_modules')
    })

    it('supports regular expressions and returns empty notice if no match', async () => {
      const { ctx } = await setupTools()

      const regexRes = await ctx.tools.execute({
        callId: 'call-s3',
        name: 'grep_search',
        arguments: { query: 'export\\s+class\\s+\\w+', isRegex: true },
      })
      expect(regexRes.content).toContain('src/agent.ts:1: export class Agent {')

      const noMatchRes = await ctx.tools.execute({
        callId: 'call-s4',
        name: 'grep_search',
        arguments: { query: 'non-existent-keyword-999' },
      })
      expect(noMatchRes.content).toContain('No matches found for query "non-existent-keyword-999"')
    })
  })
})
