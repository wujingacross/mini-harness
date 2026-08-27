import { promises as fs } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import type { Context } from 'cordis'
import type { ToolDefinition } from './index.js'

export interface SearchToolsConfig {
  workspaceDir?: string
  defaultExcludes?: string[]
}

const DEFAULT_EXCLUDES = ['node_modules', '.git', 'dist', '.sessions', '.tmp-test-']

function isExcluded(relPath: string, excludes: string[]): boolean {
  return excludes.some((ex) => relPath === ex || relPath.startsWith(`${ex}/`) || relPath.includes(`/${ex}/`) || relPath.includes(ex))
}

function matchGlob(path: string, pattern: string): boolean {
  // 简易 Glob 转换器 (* ➔ .*, ? ➔ .)
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.')
  const regex = new RegExp(`^${escaped}$`, 'i')
  return regex.test(path) || regex.test(path.split('/').pop() || '')
}

async function collectFiles(dir: string, baseDir: string, excludes: string[]): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    const relPath = relative(baseDir, fullPath)

    if (isExcluded(relPath, excludes)) {
      continue
    }

    if (entry.isDirectory()) {
      const subFiles = await collectFiles(fullPath, baseDir, excludes)
      files.push(...subFiles)
    } else if (entry.isFile()) {
      files.push(fullPath)
    }
  }

  return files
}

/**
 * 创建代码与文件检索工具族：
 * 1. find_by_name: 基于文件名或 Glob 模式快速查找项目文件；
 * 2. grep_search: 在项目代码中执行毫秒级正则表达式或关键字搜索。
 */
export function createSearchTools(ctx: Context, config: SearchToolsConfig = {}): ToolDefinition[] {
  const defaultWorkspace = config.workspaceDir || process.cwd()
  const excludes = config.defaultExcludes || DEFAULT_EXCLUDES

  // ==========================================
  // Tool 1: find_by_name
  // ==========================================
  const findByNameTool: ToolDefinition<{
    pattern: string
    directory?: string
    maxResults?: number
  }> = {
    name: 'find_by_name',
    description: `Find files in the workspace matching a filename or glob pattern (e.g. "*.ts", "agent", "**/*.spec.ts").`,
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'The filename substring or glob pattern to search for.',
        },
        directory: {
          type: 'string',
          description: 'Optional subdirectory to search within (default: root workspace).',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of results to return (default: 50).',
        },
      },
      required: ['pattern'],
    },
    async execute(args) {
      const searchRoot = args.directory
        ? (isAbsolute(args.directory) ? args.directory : join(defaultWorkspace, args.directory))
        : defaultWorkspace

      let allFiles: string[]
      try {
        allFiles = await collectFiles(searchRoot, defaultWorkspace, excludes)
      } catch (err: any) {
        return `[Error] Failed to scan directory "${searchRoot}": ${err.message || String(err)}`
      }

      const pattern = args.pattern
      const matched = allFiles
        .map((f) => relative(defaultWorkspace, f))
        .filter((rel) => matchGlob(rel, pattern) || rel.toLowerCase().includes(pattern.toLowerCase()))

      const limit = args.maxResults || 50
      const results = matched.slice(0, limit)

      if (results.length === 0) {
        return `No files found matching pattern "${pattern}".`
      }

      let output = `Found ${matched.length} matching file(s)${matched.length > limit ? ` (showing first ${limit})` : ''}:\n`
      output += results.map((r) => `- ${r}`).join('\n')
      return output
    },
  }

  // ==========================================
  // Tool 2: grep_search
  // ==========================================
  const grepSearchTool: ToolDefinition<{
    query: string
    directory?: string
    isRegex?: boolean
    caseInsensitive?: boolean
    maxMatches?: number
  }> = {
    name: 'grep_search',
    description: `Search for text or regular expression patterns across files in the workspace.
Returns matching files with line numbers and matched line snippets.`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search string or regex pattern to look for.',
        },
        directory: {
          type: 'string',
          description: 'Optional directory to search within (default: root workspace).',
        },
        isRegex: {
          type: 'boolean',
          description: 'Whether to treat query as a regular expression (default: false).',
        },
        caseInsensitive: {
          type: 'boolean',
          description: 'Whether search is case-insensitive (default: true).',
        },
        maxMatches: {
          type: 'number',
          description: 'Maximum number of matching lines to return (default: 50).',
        },
      },
      required: ['query'],
    },
    async execute(args) {
      const searchRoot = args.directory
        ? (isAbsolute(args.directory) ? args.directory : join(defaultWorkspace, args.directory))
        : defaultWorkspace

      let allFiles: string[]
      try {
        allFiles = await collectFiles(searchRoot, defaultWorkspace, excludes)
      } catch (err: any) {
        return `[Error] Failed to scan directory "${searchRoot}": ${err.message || String(err)}`
      }

      const isRegex = args.isRegex === true
      const flags = args.caseInsensitive !== false ? 'i' : ''
      let regex: RegExp
      try {
        regex = isRegex ? new RegExp(args.query, flags) : new RegExp(args.query.replace(/[.+^${}()|[\]\\]/g, '\\$&'), flags)
      } catch (err: any) {
        return `[Error] Invalid regular expression "${args.query}": ${err.message || String(err)}`
      }

      const matches: string[] = []
      const maxMatches = args.maxMatches || 50

      for (const fullPath of allFiles) {
        if (matches.length >= maxMatches) break
        try {
          const content = await fs.readFile(fullPath, 'utf-8')
          const lines = content.split('\n')
          const relPath = relative(defaultWorkspace, fullPath)

          for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            if (matches.length >= maxMatches) break
            const line = lines[lineIndex]!
            if (regex.test(line)) {
              matches.push(`${relPath}:${lineIndex + 1}: ${line.trim()}`)
            }
          }
        } catch {
          // ignore binary / unreadable file
        }
      }

      if (matches.length === 0) {
        return `No matches found for query "${args.query}".`
      }

      let output = `Found ${matches.length} match(es):\n`
      output += matches.join('\n')
      return output
    },
  }

  return [findByNameTool, grepSearchTool]
}
