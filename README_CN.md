# Mini Harness (轻量级 Coding Agent 框架)

[English](README.md) | [简体中文](README_CN.md)

> 一个从 0 到 1 纯手写复现 **DeepSeek Coding Agent** 核心架构（`deepseek-harness`）的教学与实战项目。

Mini Harness 是 DeepSeek 官方 Coding Agent 产品（DeepSeek Code）底层架构的轻量级、无冗余的 Clean-room 重建版本。本项目旨在用最清晰的代码结构，完整展现如何利用 **微内核架构（Cordis）**、**事件溯源（Event Sourcing）** 以及 **ReAct Agent Loop 状态机** 构建一个工业级的 Coding Agent。

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
│   ├── agent/               # Agent 接口规范、注册表与全局生命周期事件
│   ├── agent-loop/          # ReAct Loop 核心状态机 (Turn -> Step -> Tool 调度 + resumeAgent 恢复)
│   ├── ui/                  # 终端 Stdio 交互界面 (打字机流式输出与彩色卡片)
│   └── demo/
│       ├── echo.ts          # Milestone 1: 最简 Echo Agent Demo
│       ├── coding.ts        # Milestone 2 & 3: 具备持久化与断点续聊的终端 Coding Agent
│       └── acp.ts           # Milestone 4: 面向 Zed / IDE 的生产级 ACP Server 服务
├── docs/                    # 分阶段演进与架构设计过程文档
│   ├── 01-milestone1-echo-agent.md
│   ├── 02-milestone2-coding-agent.md
│   ├── 03-milestone3-session-persistence.md
│   └── 04-milestone4-acp-ide-integration.md
├── tests/                   # 自动化测试套件 (16 个测试全部绿灯通过)
│   ├── echo.spec.ts         # ReAct 循环状态机测试
│   ├── bash.spec.ts         # Bash 执行器与安全特性测试
│   ├── deepseek-adapter.spec.ts # DeepSeek 协议解析测试
│   ├── session-persistence.spec.ts # JSONL / SQLite 双后端契约测试
│   ├── resume.spec.ts       # 跨进程持久化与无缝断点续聊测试
│   └── acp.spec.ts          # ACP 协议网关与 IDE 交互测试
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

### 3. 体验 Demo

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

## 🗺️ 阶段路线图 (Roadmap)

- [x] **Milestone 1**: 骨架、内核与最简 Echo Agent 闭环（Cordis 容器、事件溯源 Session、ReAct 状态机、Stdio CLI）
- [x] **Milestone 2**: 真实能力注入（真实 DeepSeek API SSE 适配器 + 本地 Bash 进程组执行器 + Coding Agent）
- [x] **Milestone 3**: 工业级持久化（JSONL / SQLite 追加日志、崩溃恢复修补与 `ctx.agentLoop.resumeAgent()`）
- [x] **Milestone 4**: 现代化 IDE 接入（基于 JSON-RPC 的 ACP - Agent Client Protocol，对接 Zed 编辑器）
- [ ] **Milestone 5**: 系统韧性与高级控制（Invariants 不变量契约校验、中途打断 Steering、优雅取消 Cancellation）

---

## 📚 详细设计文档

每个阶段的技术细节、时序图与设计决策已沉淀在文档中：
* 📖 [Milestone 1 详细架构设计与实现指南](docs/01-milestone1-echo-agent.md)
* 📖 [Milestone 2 真实 DeepSeek 接入与本地 Bash 执行器指南](docs/02-milestone2-coding-agent.md)
* 📖 [Milestone 3 工业级持久化、双后端与崩溃恢复指南](docs/03-milestone3-session-persistence.md)
* 📖 [Milestone 4 现代化 IDE 接入与 ACP 协议网关指南](docs/04-milestone4-acp-ide-integration.md)
