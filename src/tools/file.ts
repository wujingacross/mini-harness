import { promises as fs } from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'
import type { Context } from 'cordis'
import type { ToolDefinition } from './index.js'

export interface FileToolsConfig {
  workspaceDir?: string
  maxReadLines?: number
}

function resolvePath(filePath: string, workspaceDir: string): string {
  if (isAbsolute(filePath)) {
    return filePath
  }
  return join(workspaceDir, filePath)
}

/**
 * 产生统一格式的简易 Diff 预览 (Unified Diff Preview)
 */
function generateDiffPreview(oldContent: string, newContent: string): string {
  const oldLines = oldContent.split('\n')
  const newLines = newContent.split('\n')
  const diffLines: string[] = []

  let i = 0
  let j = 0
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      i++
      j++
    } else {
      if (i < oldLines.length) {
        diffLines.push(`- ${oldLines[i]}`)
        i++
      }
      if (j < newLines.length) {
        diffLines.push(`+ ${newLines[j]}`)
        j++
      }
    }
  }

  return diffLines.slice(0, 30).join('\n') + (diffLines.length > 30 ? '\n... (more diff lines)' : '')
}

/**
 * 创建专业代码与文件读写工具族：
 * 1. view_file: 按行号切片查看文件，支持起止行范围与大文件安全截断；
 * 2. write_to_file: 全量写入或新建文件（自动递归创建父目录）；
 * 3. replace_file_content (str_replace_editor): 基于唯一子串精准局部替换，自带唯一性检查与 Diff 预览。
 */
export function createFileTools(ctx: Context, config: FileToolsConfig = {}): ToolDefinition[] {
  const defaultWorkspace = config.workspaceDir || process.cwd()
  const maxReadLines = config.maxReadLines || 800

  // ==========================================
  // Tool 1: view_file
  // ==========================================
  const viewFileTool: ToolDefinition<{
    path: string
    startLine?: number
    endLine?: number
  }> = {
    name: 'view_file',
    description: `View the contents of a file from the workspace with line numbers.
Supports line slicing via startLine and endLine (1-indexed, inclusive).`,
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The path of the file to view (relative to workspace or absolute).',
        },
        startLine: {
          type: 'number',
          description: 'Optional 1-indexed start line number to view (inclusive).',
        },
        endLine: {
          type: 'number',
          description: 'Optional 1-indexed end line number to view (inclusive).',
        },
      },
      required: ['path'],
    },
    async execute(args) {
      const fullPath = resolvePath(args.path, defaultWorkspace)
      let raw: string
      try {
        raw = await fs.readFile(fullPath, 'utf-8')
      } catch (err: any) {
        return `[Error] Failed to read file "${args.path}": ${err.message || String(err)}`
      }

      const allLines = raw.split('\n')
      const totalLines = allLines.length

      const start = Math.max(1, args.startLine ?? 1)
      const end = Math.min(totalLines, args.endLine ?? Math.min(totalLines, start + maxReadLines - 1))

      if (start > totalLines) {
        return `[Notice] File "${args.path}" only has ${totalLines} lines (startLine ${start} is out of range).`
      }

      const slicedLines: string[] = []
      for (let lineNum = start; lineNum <= end; lineNum++) {
        slicedLines.push(`${lineNum}: ${allLines[lineNum - 1]}`)
      }

      let header = `File: ${args.path} (Lines ${start}-${end} of ${totalLines})\n`
      header += `--------------------------------------------------\n`

      let footer = ''
      if (end < totalLines && args.endLine === undefined) {
        footer = `\n... [Truncated: Showing first ${maxReadLines} lines. Use startLine=${end + 1} to read more]`
      }

      return header + slicedLines.join('\n') + footer
    },
  }

  // ==========================================
  // Tool 2: write_to_file
  // ==========================================
  const writeToFileTool: ToolDefinition<{
    path: string
    content: string
    overwrite?: boolean
  }> = {
    name: 'write_to_file',
    description: `Create a new file or completely overwrite an existing file with the specified content.
Parent directories are created automatically if they do not exist.`,
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The path of the file to write to.',
        },
        content: {
          type: 'string',
          description: 'The text content to write to the file.',
        },
        overwrite: {
          type: 'boolean',
          description: 'Whether to overwrite if the file already exists (default: true).',
        },
      },
      required: ['path', 'content'],
    },
    async execute(args) {
      const fullPath = resolvePath(args.path, defaultWorkspace)
      const overwrite = args.overwrite !== false

      if (!overwrite) {
        try {
          await fs.access(fullPath)
          return `[Error] File "${args.path}" already exists and overwrite is set to false.`
        } catch {
          // file does not exist, proceed
        }
      }

      try {
        await fs.mkdir(dirname(fullPath), { recursive: true })
        await fs.writeFile(fullPath, args.content, 'utf-8')
        const lineCount = args.content.split('\n').length
        return `[Success] Wrote ${args.content.length} bytes (${lineCount} lines) to ${args.path}`
      } catch (err: any) {
        return `[Error] Failed to write file "${args.path}": ${err.message || String(err)}`
      }
    },
  }

  // ==========================================
  // Tool 3: replace_file_content (str_replace_editor)
  // ==========================================
  const replaceFileContentTool: ToolDefinition<{
    path: string
    targetContent: string
    replacementContent: string
    allowMultiple?: boolean
  }> = {
    name: 'replace_file_content',
    description: `Precisely replace an exact target block of code in a file with new replacement content.
The targetContent must uniquely match exactly one location in the file (unless allowMultiple=true).`,
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The target file path to modify.',
        },
        targetContent: {
          type: 'string',
          description: 'The exact unique string/lines in the file to be replaced. Include surrounding lines if needed to ensure uniqueness.',
        },
        replacementContent: {
          type: 'string',
          description: 'The replacement string/lines to drop in place of targetContent.',
        },
        allowMultiple: {
          type: 'boolean',
          description: 'If true, replaces all occurrences. If false (default), errors if multiple matches are found.',
        },
      },
      required: ['path', 'targetContent', 'replacementContent'],
    },
    async execute(args) {
      const fullPath = resolvePath(args.path, defaultWorkspace)
      let original: string
      try {
        original = await fs.readFile(fullPath, 'utf-8')
      } catch (err: any) {
        return `[Error] Failed to read file "${args.path}": ${err.message || String(err)}`
      }

      const { targetContent, replacementContent, allowMultiple } = args

      if (!targetContent) {
        return `[Error] targetContent cannot be empty.`
      }

      const occurrences = original.split(targetContent).length - 1

      if (occurrences === 0) {
        return `[Error] targetContent was not found in "${args.path}". Please use view_file to confirm the exact lines and whitespace.`
      }

      if (occurrences > 1 && !allowMultiple) {
        return `[Error] targetContent matched ${occurrences} occurrences in "${args.path}". Please include more surrounding context lines in targetContent to ensure unique match, or set allowMultiple: true.`
      }

      let updated: string
      if (allowMultiple) {
        updated = original.replaceAll(targetContent, replacementContent)
      } else {
        updated = original.replace(targetContent, replacementContent)
      }

      try {
        await fs.writeFile(fullPath, updated, 'utf-8')
        const diff = generateDiffPreview(original, updated)
        return `[Success] Successfully replaced ${occurrences} occurrence(s) in "${args.path}".\n\n--- Diff Preview ---\n${diff}`
      } catch (err: any) {
        return `[Error] Failed to write updated content to "${args.path}": ${err.message || String(err)}`
      }
    },
  }

  return [viewFileTool, writeToFileTool, replaceFileContentTool]
}
