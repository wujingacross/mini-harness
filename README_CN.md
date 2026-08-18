# Mini Harness (轻量级 Coding Agent 框架)

[English](README.md) | [简体中文](README_CN.md)

> 一个从 0 到 1 纯手写复现 **DeepSeek Coding Agent** 核心架构（`deepseek-harness`）的教学与实战项目。

Mini Harness 是 DeepSeek 官方 Coding Agent 产品（DeepSeek Code）底层架构的轻量级、无冗余的 Clean-room 重建版本。本项目旨在用最清晰的代码结构，完整展现如何利用 **微内核架构（Cordis）**、**事件溯源（Event Sourcing）** 以及 **ReAct Agent Loop 状态机** 构建一个工业级的 Coding Agent。

---

## 🌟 核心设计哲学与架构支柱

1. **微内核与一切皆插件（Microkernel & Everything is a Plugin）**：
   - 基于 Cordis 微内核容器构建。所有的核心能力（`ctx.llm` 模型服务、`ctx.sessions` 会话存储、`ctx.tools` 工具流水线、`ctx.systemPrompt` 提示词装配、`ctx.agents` Agent 注册表、`ctx.agentLoop` 循环引擎）都是解耦的独立插件。
   - 横切关注点（如用户权限二次确认、Docker 沙箱隔离、事件流审计、状态机不变式检查）均通过 Cordis 的 `waterfall` 中间件拦截注入，**无需修改主循环代码**。

2. **事件溯源会话系统（Event-Sourced Session Log）**：
   - 摒弃了传统的裸 `messages[]` 数组存储方式，采用**单向追加的事件日志（Append-only Event Log）**作为唯一事实来源（`turn/start`, `assistant/chunk`, `tool/call`, `tool/result`, `context/message`, `turn/end`）。
   - 在每次向大模型发起请求前，通过纯函数 `deriveMessages()` 从事件流中**动态投影计算**出标准的消息数组。天然具备崩溃恢复、断点重放、会话分支（Fork）能力。

3. **流式分片协议与多模态块缝合（Streaming Chunk & BlockAssembler）**：
   - 细粒度支持 DeepSeek R1/V3 的深度思考流（Reasoning / CoT）、文本增量与结构化工具调用（Tool Call Delta）。
   - 内部集成增量状态机 `BlockAssembler`，在保证流式极速响应的同时，自动将碎片 Chunk 组装为合法的完整 Block。

---

## 📂 项目结构概览

```
mini-harness/
├── src/
│   ├── types/               # 核心类型词表 (ContentBlocks, StreamChunks, SessionEvents)
│   ├── session/             # 事件溯源会话存储与消息派生 (deriveMessages 投影)
│   ├── system-prompt/       # 提示词按优先级分段装配与 Tool Schema 注册
│   ├── tools/               # 工具注册表与 tools/execute Waterfall 拦截流水线
│   ├── llm/                 # 统一模型服务抽象层与 Mock 适配器
│   ├── agent/               # Agent 接口规范、注册表与全局生命周期事件
│   ├── agent-loop/          # ReAct Loop 核心状态机 (Turn -> Step -> Tool 调度)
│   ├── ui/                  # 终端 Stdio 交互界面 (打字机流式输出与彩色卡片)
│   └── demo/
│       └── echo.ts          # Milestone 1 可运行 Demo 入口
├── docs/                    # 分阶段演进与架构设计过程文档
│   └── 01-milestone1-echo-agent.md
├── tests/
│   └── echo.spec.ts         # Vitest 端到端自动化测试
├── package.json
└── tsconfig.json
```

---

## 🚀 快速开始

### 1. 安装依赖
```bash
pnpm install
```

### 2. 运行自动化测试
```bash
pnpm test
```

### 3. 启动交互式终端 Demo
```bash
pnpm run demo:echo
```

在终端交互中：
- 输入普通聊天（如 `hello`）：模型直接生成回复。
- 输入工具触发指令（如 `echo deepseek-code`）：
  - 自动触发 **深度思考（Thinking / Reasoning）**
  - 发起结构化 **工具调用（Tool Call）**
  - 本地执行 `echo` 工具并返回结果
  - 模型接收结果并生成最终总结

---

## 🗺️ 阶段路线图 (Roadmap)

- [x] **Milestone 1**: 骨架、内核与最简 Echo Agent 闭环（Cordis 容器、事件溯源 Session、ReAct 状态机、Stdio CLI）
- [ ] **Milestone 2**: 真实能力注入（真实 DeepSeek API SSE 适配器 + 本地 Bash 进程组执行器 + Coding Agent）
- [ ] **Milestone 3**: 工业级持久化（JSONL / SQLite 追加日志与崩溃恢复 `ctx.agents.resume()`）
- [ ] **Milestone 4**: 现代化 IDE 接入（基于 JSON-RPC 的 ACP - Agent Client Protocol，对接 Zed 编辑器）
- [ ] **Milestone 5**: 系统韧性与高级控制（Invariants 不变量契约校验、中途打断 Steering、优雅取消 Cancellation）

---

## 📚 详细设计文档

每个阶段的技术细节、时序图与设计决策已沉淀在文档中：
* 📖 [Milestone 1 详细架构设计与实现指南](docs/01-milestone1-echo-agent.md)
