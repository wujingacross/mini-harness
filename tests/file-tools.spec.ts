import { describe, it, expect, beforeEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { Context } from 'cordis'
import SystemPrompt from '../src/system-prompt/index.js'
import ToolRegistry from '../src/tools/index.js'
import { createFileTools } from '../src/tools/file.js'

const testDir = join(process.cwd(), '.tmp-test-file-tools')

describe('Milestone 6: File Read & Write Toolchain', () => {
  beforeEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true })
    await fs.mkdir(testDir, { recursive: true })
  })

  async function setupTools() {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    const fileTools = createFileTools(ctx, { workspaceDir: testDir })
    for (const t of fileTools) {
      ctx.tools.register(t)
    }
    return { ctx, fileTools }
  }

  describe('write_to_file', () => {
    it('creates new files and parent directories automatically', async () => {
      const { ctx } = await setupTools()

      const res = await ctx.tools.execute({
        callId: 'call-1',
        name: 'write_to_file',
        arguments: {
          path: 'nested/sub/hello.txt',
          content: 'Hello File Tools!\nLine 2',
        },
      })

      expect(res.isError).toBe(false)
      expect(res.content).toContain('Wrote 24 bytes')

      const saved = await fs.readFile(join(testDir, 'nested/sub/hello.txt'), 'utf-8')
      expect(saved).toBe('Hello File Tools!\nLine 2')
    })
  })

  describe('view_file', () => {
    it('views full file with line numbers and supports line slicing', async () => {
      const { ctx } = await setupTools()
      const sampleText = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5'
      await fs.writeFile(join(testDir, 'sample.txt'), sampleText, 'utf-8')

      // 1. Full view
      const fullRes = await ctx.tools.execute({
        callId: 'call-2',
        name: 'view_file',
        arguments: { path: 'sample.txt' },
      })
      expect(fullRes.content).toContain('1: Line 1')
      expect(fullRes.content).toContain('5: Line 5')

      // 2. Sliced view
      const sliceRes = await ctx.tools.execute({
        callId: 'call-3',
        name: 'view_file',
        arguments: { path: 'sample.txt', startLine: 2, endLine: 4 },
      })
      expect(sliceRes.content).toContain('Lines 2-4 of 5')
      expect(sliceRes.content).toContain('2: Line 2')
      expect(sliceRes.content).toContain('4: Line 4')
      expect(sliceRes.content).not.toContain('1: Line 1')
    })

    it('handles non-existent file gracefully', async () => {
      const { ctx } = await setupTools()
      const res = await ctx.tools.execute({
        callId: 'call-4',
        name: 'view_file',
        arguments: { path: 'missing.txt' },
      })
      expect(res.content).toContain('[Error] Failed to read file "missing.txt"')
    })
  })

  describe('replace_file_content (str_replace_editor)', () => {
    it('replaces unique target content and returns diff preview', async () => {
      const { ctx } = await setupTools()
      const original = `function add(a, b) {\n  return a - b;\n}`
      await fs.writeFile(join(testDir, 'math.js'), original, 'utf-8')

      const res = await ctx.tools.execute({
        callId: 'call-5',
        name: 'replace_file_content',
        arguments: {
          path: 'math.js',
          targetContent: '  return a - b;',
          replacementContent: '  return a + b;',
        },
      })

      expect(res.content).toContain('[Success] Successfully replaced 1 occurrence(s)')
      expect(res.content).toContain('-   return a - b;')
      expect(res.content).toContain('+   return a + b;')

      const updated = await fs.readFile(join(testDir, 'math.js'), 'utf-8')
      expect(updated).toBe(`function add(a, b) {\n  return a + b;\n}`)
    })

    it('rejects ambiguous multiple matches when allowMultiple is false', async () => {
      const { ctx } = await setupTools()
      const original = `foo\nbar\nfoo`
      await fs.writeFile(join(testDir, 'dup.txt'), original, 'utf-8')

      const res = await ctx.tools.execute({
        callId: 'call-6',
        name: 'replace_file_content',
        arguments: {
          path: 'dup.txt',
          targetContent: 'foo',
          replacementContent: 'baz',
        },
      })

      expect(res.content).toContain('matched 2 occurrences')
      expect(res.content).toContain('Please include more surrounding context')
    })

    it('replaces all matches when allowMultiple is true', async () => {
      const { ctx } = await setupTools()
      const original = `foo\nbar\nfoo`
      await fs.writeFile(join(testDir, 'dup.txt'), original, 'utf-8')

      const res = await ctx.tools.execute({
        callId: 'call-7',
        name: 'replace_file_content',
        arguments: {
          path: 'dup.txt',
          targetContent: 'foo',
          replacementContent: 'baz',
          allowMultiple: true,
        },
      })

      expect(res.content).toContain('Successfully replaced 2 occurrence(s)')
      const updated = await fs.readFile(join(testDir, 'dup.txt'), 'utf-8')
      expect(updated).toBe(`baz\nbar\nbaz`)
    })
  })
})
