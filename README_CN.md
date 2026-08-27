# Mini Harness (DeepSeek Harness / dsh 极简架构复现实战)

[English](README.md) | [简体中文](README_CN.md)

<p align="center">
  <a href="https://github.com/wujingacross/mini-harness"><img src="https://img.shields.io/badge/GitHub-mini--harness-blue?logo=github" alt="GitHub"></a>
  <a href="https://github.com/wujingacross/mini-harness/releases"><img src="https://img.shields.io/badge/Release-v1.0.0-green" alt="Release"></a>
  <a href="https://github.com/wujingacross/mini-harness/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow" alt="License"></a>
  <a href="https://api.deepseek.com"><img src="https://img.shields.io/badge/LLM-DeepSeek--V3%20%7C%20DeepSeek--R1-4D6BFE" alt="DeepSeek"></a>
  <a href="https://zed.dev"><img src="https://img.shields.io/badge/Protocol-ACP%20(Zed%20Editor)-orange" alt="ACP"></a>
  <a href="https://cordis.moe"><img src="https://img.shields.io/badge/Framework-Cordis%204%20Microkernel-purple" alt="Cordis"></a>
</p>

> 🚀 一个从 0 到 1 纯手写复现 **DeepSeek Harness (`deepseek-harness` / `dsh` / DeepSeek Code)** 核心架构的教学与实战项目。

**Mini Harness** 是 DeepSeek 官方 Coding Agent 产品（**DeepSeek Code** / **`deepseek-harness`**）底层核心架构的轻量级、无冗余的 Clean-room 重建版本。

本项目旨在用最清晰的代码结构、详尽的中文架构解析与完整的测试套件，完整展现如何利用 **微内核架构（Cordis 4）**、**事件溯源（Event Sourcing）**、**ReAct Loop 状态机** 以及 **ACP（Agent Client Protocol）协议** 构建一个工业级的 AI 编程智能体框架。

---

## 🗺️ 与官方 `deepseek-harness (dsh)` 模块映射

Mini Harness 将官方 Monorepo 中庞杂的 `@deepseek-ai/dsh-*` 多包体系高度凝练为直观的单包架构，同时 100% 保留了其核心设计精髓：

| 官方 `deepseek-harness` 模块 | Mini Harness 对应实现 | 核心架构职责 |
| :--- | :--- | :--- |
| `@deepseek-ai/dsh-agent-loop` | [`src/agent-loop/`](src/agent-loop/) | ReAct Loop 核心状态机（Turn ➔ Step ➔ Tool 驱动循环） |
| `@deepseek-ai/dsh-session` | [`src/session/`](src/session/) | 事件溯源会话系统、`deriveMessages` 投影与崩溃恢复 |
| `@deepseek-ai/dsh-session-persistence` | [`src/session-persistence/`](src/session-persistence/) | Write-Behind 缓冲池与 JSONL / SQLite 双持久化后端 |
| `@deepseek-ai/dsh-acp` | [`src/acp/`](src/acp/) | JSON-RPC 2.0 双工网关，连接 **Zed** 等现代 IDE 编辑器 |
| `@deepseek-ai/dsh-llm-deepseek` | [`src/llm/deepseek.ts`](src/llm/deepseek.ts) | 真实 DeepSeek API SSE 流式协议与 R1 思考流解析 |
| `@deepseek-ai/dsh-tool-bash` / `bash-local` | [`src/bash/`](src/bash/) & [`src/tools/bash.ts`](src/tools/bash.ts) | Bash 进程组隔离（`detached`）、超时强杀与 64KB 截断保护 |
| `@deepseek-ai/dsh-invariants` | [`src/invariants/`](src/invariants/) | 运行时状态机不变量校验守卫与事件 `Deep Freeze` 冻结 |

---

## 🌟 核心设计哲学与架构支柱

1. **微内核与一切皆插件（Microkernel & Everything is a Plugin）**：
   - 基于 Cordis 微内核容器构建。所有的核心能力（`ctx.llm` 模型服务、`ctx.sessions` 会话存储、`ctx.sessionPersistence` 持久化、`ctx.tools` 工具流水线、`ctx.systemPrompt` 提示词装配、`ctx.bash` 本地执行器、`ctx.acpBridge` IDE 网关、`ctx.agents` Agent 注册表、`ctx.agentLoop` 循环引擎）都是解耦的独立插件。
   - 横切关注点（如用户权限二次确认、Docker 沙箱隔离、事件流审计、状态机不变式检查）均通过 Cordis 的 `waterfall` 中间件拦截注入，**无需修改主循环代码**。

2. **能力 Seam 架构（Interface ➔ Implementation ➔ Consumer）**：
   - 以 Bash 执行能力与持久化存储为例，彻底解耦抽象接口、具体后端（Local/JSONL/SQLite）与大模型工具。随时支持热插拔替换为容器沙箱或远程执行后端。

3. **事件溯源会话系统（Event-Sourced Session Log）**：
   - 采用**单向追加的事件日志（Append-only Event Log）**作为唯一事实来源（`turn/start`, `assistant/chunk`, `tool/call`, `tool/result`, `context/message`, `turn/end`）。
   - 在每次向大模型发起请求前，通过纯函数 `deriveMessages()` 从事件流中**动态投影计算**出标准的消息数组。天然具备崩溃恢复、断点重放、会话分支（Fork）能力。

4. **工业级持久化与智能崩溃恢复（Persistence & Crash Recovery）**：
   - 写后缓冲池（Write-Behind Buffering）与 Turn 结束检查点（Flush Checkpoint）批量落盘，保障流式极速响应；
   - 智能崩溃修补算法（`interruptedTurnClosers`）：异常中断时自动闭合悬挂的 tool-calls，确保重新加载时历史转录 100% 合法；
   - 支持 JSONL 与原生 SQLite 双后端，提供 `ctx.agentLoop.resumeAgent()` 跨进程无缝断点续聊。

5. **现代化 IDE 原生接入（Agent Client Protocol - ACP）**：
   - 基于 JSON-RPC 2.0 stdio 双工协议构建，原生支持接入 **Zed** 等现代化编辑器；
   - 多会话多任务并发多路复用（Multi-Session Multiplexing）；
   - 结构化分流推送深度思考流（`agent_thought_chunk`）、回复正文与富交互工具执行卡片（`tool_call` / `tool_call_update`）；
   - 支持历史会话即时重载与全量卡片回放（`session/load`）。

6. **系统韧性与高级交互控制（Resilience & Hardening）**：
   - 运行时不变量守卫（`Invariants Guard`）：序号单调性校验与事件不可变深度冻结（`Deep Freeze`），杜绝历史日志被篡改；
   - 中途干预与航向纠偏（`Mid-turn Steering`）：允许用户在执行中途注入 `<steering>` 指令动态修正任务方向；
   - 优雅级联取消（`Graceful Cancellation`）：进程组级联清理与状态机安全复位。

---

## 📂 项目结构概览

```
mini-harness/
├── src/
│   ├── types/               # 核心类型词表 (ContentBlocks, StreamChunks, SessionEvents, SessionHeader)
│   ├── session/             # 事件溯源会话存储与消息派生 (deriveMessages 投影 + 崩溃修复 repair)
│   ├── session-persistence/ # 工业级会话持久化 Seam 架构 (Write-Behind 缓冲池 + 检查点)
│   │   ├── types.ts         # SessionPersistenceService 抽象契约
│   │   ├── base.ts          # SessionPersistence 基础服务类
│   │   ├── jsonl.ts         # JSONL 增量文本文件存储后端
│   │   └── sqlite.ts        # Node 24 原生 node:sqlite 关系型数据库存储后端
│   ├── acp/                 # 现代化 IDE 接入网关 (Agent Client Protocol - ACP)
│   │   ├── types.ts         # JSON-RPC 2.0 与 ACP 协议类型定义及 Codec
│   │   ├── connection.ts    # 健壮的 NDJSON 行级分帧与双工通信连接
│   │   └── bridge.ts        # AcpBridge 网关微内核服务
│   ├── invariants/          # 运行时不变量守卫 (序号连续性断言 + Deep Freeze 深度冻结)
│   ├── system-prompt/       # 提示词按优先级分段装配与 Tool Schema 注册
│   ├── tools/               # 工具注册表与 tools/execute Waterfall 拦截流水线
│   │   └── bash.ts          # 面向大模型的标准 bash 工具
│   ├── bash/                # Bash 执行能力 Seam 架构 (Interface + Local 进程组实现)
│   │   ├── types.ts         # BashExecutor 抽象定义与结果结构
│   │   ├── local.ts         # 本地进程组隔离、超时强杀与 64KB 截断保护
│   │   └── index.ts         # ctx.bash 微内核服务
│   ├── llm/                 # 统一模型服务抽象层 (Mock 适配器 + 真实 DeepSeek SSE 适配器)
│   │   ├── deepseek.ts      # 真实 DeepSeek API 流式调用与 Function Calling
│   │   └── index.ts         # ctx.llm 服务
│   ├── agent/               # Agent 接口规范、注册表与全局生命周期事件 (含 steer / cancel)
│   ├── agent-loop/          # ReAct Loop 核心状态机 (Turn -> Step -> Tool 调度 + resumeAgent 恢复)
│   ├── ui/                  # 终端 Stdio 交互界面 (打字机流式输出与彩色卡片)
│   └── demo/
│       ├── echo.ts          # Milestone 1: 最简 Echo Agent Demo
│       ├── coding.ts        # Milestone 2 & 3: 具备持久化与断点续聊的终端 Coding Agent
│       └── acp.ts           # Milestone 4: 面向 Zed / IDE 的生产级 ACP Server 服务
├── docs/                    # 分阶段演进与架构设计过程文档 (全套 5 篇教程)
│   ├── 01-milestone1-echo-agent.md
│   ├── 02-milestone2-coding-agent.md
│   ├── 03-milestone3-session-persistence.md
│   ├── 04-milestone4-acp-ide-integration.md
│   └── 05-milestone5-resilience-and-hardening.md
├── tests/                   # 自动化测试套件 (21 个测试全部绿灯通过)
├── package.json
└── tsconfig.json
```

---

## 🚀 快速开始

### 1. 安装依赖
```bash
pnpm install
```

### 2. 运行全套自动化测试
```bash
pnpm test
```

### 3. 体验各种模式 Demo

#### 方式 A：运行离线 Echo Agent (无需 API Key)
```bash
pnpm run demo:echo
```

#### 方式 B：启动终端 Coding Agent (需要 DEEPSEEK_API_KEY)
```bash
export DEEPSEEK_API_KEY=sk-your-key-here
pnpm run demo:coding
```

#### 方式 C：在 Zed 编辑器中使用 ACP 服务
在 Zed 的 `settings.json` 中配置：
```json
{
  "agent_servers": {
    "Mini Harness (DeepSeek)": {
      "command": "pnpm",
      "args": ["--dir", "/path/to/mini-harness", "run", "demo:acp"]
    }
  }
}
```

---

## 🗺️ 阶段路线图 (Roadmap) - 100% 全部达成！

- [x] **Milestone 1**: 骨架、内核与最简 Echo Agent 闭环（Cordis 容器、事件溯源 Session、ReAct 状态机、Stdio CLI）
- [x] **Milestone 2**: 真实能力注入（真实 DeepSeek API SSE 适配器 + 本地 Bash 进程组执行器 + Coding Agent）
- [x] **Milestone 3**: 工业级持久化（JSONL / SQLite 追加日志、崩溃恢复修补与 `ctx.agentLoop.resumeAgent()`）
- [x] **Milestone 4**: 现代化 IDE 接入（基于 JSON-RPC 的 ACP - Agent Client Protocol，对接 Zed 编辑器）
- [x] **Milestone 5**: 系统韧性与高级控制（Invariants 不变量契约校验、中途打断 Steering、优雅取消 Cancellation 与生产收尾）

---

## 📚 详细设计文档全集

每个阶段的技术细节、时序图与设计决策已沉淀在文档中：
* 📖 [Milestone 1 详细架构设计与实现指南](docs/01-milestone1-echo-agent.md)
* 📖 [Milestone 2 真实 DeepSeek 接入与本地 Bash 执行器指南](docs/02-milestone2-coding-agent.md)
* 📖 [Milestone 3 工业级持久化、双后端与崩溃恢复指南](docs/03-milestone3-session-persistence.md)
* 📖 [Milestone 4 现代化 IDE 接入与 ACP 协议网关指南](docs/04-milestone4-acp-ide-integration.md)
* 📖 [Milestone 5 系统韧性、Invariants 不变量与高级控制指南](docs/05-milestone5-resilience-and-hardening.md)

---

## ⚖️ 免责声明 (Disclaimer)

**Mini Harness** 是一个由社区发起的独立教学与技术研究开源项目，旨在探索与传播微内核 Coding Agent 的底层架构设计。本项目非 DeepSeek 官方产品，与 DeepSeek AI 官方无任何商业隶属或背书关系。
