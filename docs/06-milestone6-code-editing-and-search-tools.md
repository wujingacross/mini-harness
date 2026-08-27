# Milestone 6: 专业代码编辑与检索工具链 (Code Editing & Search Toolchain)

> **对应版本**: `v1.1.0`  
> **核心目标**: 对齐 `deepseek-harness` 官方 `packages/fs/` 核心工具族，为 Agent 提供精准切片查看（`view_file`）、唯一子串局部替换（`replace_file_content`）、递归新建覆盖（`write_to_file`）以及高性能代码发现（`find_by_name` 与 `grep_search`）工具链，彻底摆脱单一粗粒度 `bash` 带来的幻觉与大文件撑爆窗口问题。

---

## 🌟 为什么需要专业代码读写工具链？

在早期版本中，Agent 修改代码往往依赖 `bash -c "cat << 'EOF' > file"` 或 `sed`：
* ❌ **痛点 1（上下文窗口超限）**：大文件动辄数千行，全量读取会耗尽 Token 预算并增加 API 延迟；
* ❌ **痛点 2（盲改与幻觉）**：通过 Bash 重写大文件时，模型容易遗漏原文件的关键代码或破坏缩进；
* ❌ **痛点 3（不可控副作用）**：正则表达式或 `sed` 替换如果匹配到多个位置，会误伤不相关的函数。

---

## 🏛️ 工具链架构设计与实现

```
┌─────────────────────────────────────────────────────────────┐
│                    ToolRegistry (ctx.tools)                 │
├──────────────────────────────┬──────────────────────────────┤
│ 📝 文件读写与编辑族 (file.ts) │ 🔍 代码定位与检索族 (search.ts)│
├──────────────────────────────┼──────────────────────────────┤
│ • view_file (行号切片查看)   │ • find_by_name (Glob 搜文件) │
│ • replace_file_content (替换)│ • grep_search (正则搜代码)   │
│ • write_to_file (全量写入)   │                              │
└──────────────────────────────┴──────────────────────────────┘
```

### 1. `view_file`：精准按行切片查看
* 支持 `startLine` 与 `endLine`（1-indexed 包含首尾），输出自带行号标头；
* 默认截断大文件（`maxReadLines: 800`），并在尾部附上友好的翻页引导提示。

### 2. `replace_file_content` (`str_replace_editor`)：局部精准替换
* **唯一性匹配约束（Uniqueness Guard）**：
  * 计算 `targetContent` 在文件中的出现次数；
  * 若出现 0 次：明确报错并提示用户先用 `view_file` 确认真实代码与空格；
  * 若出现 > 1 次且未开启 `allowMultiple`：明确拒绝执行，要求大模型包含更多上下文行以消除歧义；
* **内置 Diff 预览**：替换成功后自动生成 Unified Diff 变更卡片。

### 3. `write_to_file`：安全新建与覆盖
* 自动递归创建多层不存在的父目录（`mkdir({ recursive: true })`）；
* 支持 `overwrite: false` 保护重要现有文件。

### 4. `find_by_name` & `grep_search`：轻量极速代码发现
* 自动忽略 `.git`、`node_modules`、`dist`、`.sessions` 等干扰目录；
* `grep_search` 支持精确正则表达式，按 `file.ts:lineNum: snippet` 格式精准定位代码符号。

---

## 🧪 自动化测试验证

编写了 [`tests/file-tools.spec.ts`](../tests/file-tools.spec.ts) 与 [`tests/search-tools.spec.ts`](../tests/search-tools.spec.ts)，测试矩阵覆盖：
1. `write_to_file` 递归自动创建父目录；
2. `view_file` 行号标注、行范围切片与越界安全处理；
3. `replace_file_content` 唯一替换 Diff 预览、多重匹配歧义拦截与 `allowMultiple` 批量替换；
4. `find_by_name` Glob 匹配与忽略规则；
5. `grep_search` 正则表达式匹配与代码行号回显。

```bash
pnpm test
```
* **11 个测试套件、30 个单元测试全部绿灯通过！**
