# 宣传与分享文案模板（可以直接复制发布）

## 1. V2EX 发帖文案（节点：程序员 / 分享发现）

**标题**：
从 0 到 1 纯手写复现 DeepSeek 官方 Coding Agent 底层架构（Mini Harness 已开源）

**正文**：
大家好，最近深入研究了 DeepSeek 官方 Coding Agent 产品（DeepSeek Code / `deepseek-harness`）的底层架构，发现其在微内核设计、事件溯源 Session、本地进程安全与现代化 IDE 协议（ACP）上有很多非常精彩的工业级设计。

为了让大家更清晰地理解顶尖 Coding Agent 的工作原理，我从 0 到 1 做了一个 Clean-room 的轻量级教学实战项目 —— **Mini Harness**。

项目特点：
- **微内核架构（Cordis 4）**：一切皆插件，主循环零侵入；
- **事件溯源 Session**：单向追加事件日志 + 纯函数 `deriveMessages` 动态消息投影；
- **本地 Bash 进程组执行器**：`detached` 进程组隔离、超时强杀梯级升级（SIGTERM -> SIGKILL）与 64KB 内存截断保护；
- **工业级持久化与自愈**：JSONL / 原生 SQLite 双后端，遭遇断电/OOM 时自动修补悬挂 tool-calls；
- **现代化 IDE 接入（ACP 协议）**：原生接入 Zed 编辑器，实时推送思考流、打字机正文与工具交互卡片；
- **系统韧性守卫**：运行时不变量校验（Invariants）、事件不可变冻结（Deep Freeze）与中途干预（Steering）。

全套代码零冗余、配备了 21 个自动化测试与 5 篇详尽的分阶段设计文档，欢迎大家 Star、交流与体验！

👉 **GitHub 仓库**：https://github.com/wujingacross/mini-harness

---

## 2. X / Twitter 发帖文案（中英双语）

**中文推文**：
🚀 深度拆解并纯手写复现了 DeepSeek 官方 Coding Agent 底层框架 —— Mini Harness 正式开源！

基于 Cordis 微内核架构，涵盖事件溯源 Session、本地 Bash 进程组安全隔离、崩溃恢复自愈、Zed 编辑器 ACP 协议网关以及 Invariants 状态机守卫。

全套 5 篇手把手设计文档 + 21 个测试全绿灯！欢迎体验与 Star ⭐️：
https://github.com/wujingacross/mini-harness
#DeepSeek #CodingAgent #AI #TypeScript #OpenSource

**英文推文 (English Tweet)**：
🚀 Excited to open-source **Mini Harness** — a clean-room educational reconstruction of the **DeepSeek Coding Agent (deepseek-harness / dsh)** architecture!

Key Features:
✨ Microkernel architecture (Cordis 4)
✨ Event-sourced sessions & pure projection
✨ Safe Bash executor with process group isolation
✨ Native Zed IDE integration via Agent Client Protocol (ACP)
✨ Crash-recovery repair & Invariants guard

Check out the repo & docs: https://github.com/wujingacross/mini-harness
#DeepSeek #AIAgent #CodingAgent #TypeScript #Zed

---

## 3. GitHub Release v1.0.0 发布说明文案 (Release Notes)

```markdown
## 🎉 Mini-Harness v1.0.0: Full Production-grade DeepSeek Coding Agent Framework

Mini Harness is an architectural faithful, clean-room reconstruction of the core foundation behind **DeepSeek Code** (the official `deepseek-harness` monorepo).

### 🌟 What's Included:
1. **Microkernel Core (Cordis 4)**: Pure plugin-based architecture, extensible middleware for tool pipelines and event streams.
2. **Event-Sourced Session Log**: Append-only immutable log with dynamic `deriveMessages()` pure projection.
3. **DeepSeek API SSE Adapter**: Native streaming adapter supporting DeepSeek-V3 & DeepSeek-R1 CoT reasoning stream extraction.
4. **Safe Local Bash Capability Seam**: Process group isolation (`detached: true`), cascading kill, timeout escalation, and 64KB truncation.
5. **Session Persistence & Crash Recovery**: Write-behind buffer with JSONL and native `node:sqlite` backends, self-healing dangling tool calls (`interruptedTurnClosers`), and cross-process resume.
6. **Agent Client Protocol (ACP) for Zed Editor**: Native JSON-RPC 2.0 stdio gateway multiplexing multi-session chat cards and tool execution.
7. **System Resilience & Hardening**: Runtime Invariants guard, event Deep Freezing, Mid-turn Steering (`<steering>`), and cascading cancellation.

### 📚 Full Tutorial Documentation:
- [Milestone 1: Core Skeleton & ReAct Loop](docs/01-milestone1-echo-agent.md)
- [Milestone 2: Real DeepSeek API & Local Bash Executor](docs/02-milestone2-coding-agent.md)
- [Milestone 3: Industrial Persistence & Crash Recovery](docs/03-milestone3-session-persistence.md)
- [Milestone 4: Modern IDE Integration with ACP for Zed](docs/04-milestone4-acp-ide-integration.md)
- [Milestone 5: System Resilience & Hardening](docs/05-milestone5-resilience-and-hardening.md)

### 🧪 Test Suite:
- 9 test suites, 21 unit & integration tests passing 100%.
```
