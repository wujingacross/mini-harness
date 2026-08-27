# 深度拆解 DeepSeek 官方 Coding Agent（DeepSeek Harness）底层架构：从 0 到 1 手写复现

> **开源项目地址**：[https://github.com/wujingacross/mini-harness](https://github.com/wujingacross/mini-harness)  
> **关键词**：`DeepSeek` / `deepseek-harness` / `dsh` / `Coding Agent` / `Cordis` / `ACP` / `Zed` / `Event Sourcing`

随着 DeepSeek-V3 与 DeepSeek-R1 推理大模型的爆发，如何构建一个真正具备工业级生产力的 **Coding Agent（代码智能体）** 成为了开发者最关注的领域。

很多人以为 Coding Agent 只是一个简单的 `LLM + Tool Call` 的死循环，但当你面对**长时间多轮探索、海量上下文超窗、执行命令引发孤儿进程、断电崩溃恢复、多编辑器接入（Zed/VSCode）**等复杂场景时，简单的脚手架会瞬间瓦解。

本文将深度拆解 DeepSeek 官方 Coding Agent（**DeepSeek Code / `deepseek-harness`**）的底层架构精髓，并通过一个从 0 到 1 纯手写的轻量级复现实战项目 —— **[Mini Harness](https://github.com/wujingacross/mini-harness)**，为你揭秘顶尖 Coding Agent 的六大核心架构设计。

---

## 🏛️ 一、架构全景：为什么采用微内核（Microkernel）？

在传统的 Agent 框架（如 LangChain/AutoGen）中，状态机往往与具体工具、UI 和模型深度耦合。而 DeepSeek Harness 采用了与操作系统类似的 **微内核架构（Cordis 4）** —— **“一切皆插件（Everything is a Plugin）”**。

```
┌─────────────────────────────────────────────────────────────┐
│                 产品集成层 (UI / IDE Surfaces)               │
│        Stdio CLI (终端打字机) │ Zed IDE (ACP 协议网关)       │
├─────────────────────────────────────────────────────────────┤
│                    ReAct Agent Loop 状态机                  │
│             (Turn ➔ Step ➔ Tool 驱动循环引擎)               │
├─────────────────────────────────────────────────────────────┤
│                    核心解耦能力 Seams (Plugins)             │
│   ┌──────────────────┐  ┌──────────────────┐  ┌───────────┐ │
│   │ DeepSeekAdapter  │  │ LocalBashExecutor│  │Persistence│ │
│   │ (SSE流/R1思考流) │  │ (进程组/超时强杀)│  │(JSONL/SQL)│ │
│   └──────────────────┘  └──────────────────┘  └───────────┘ │
├─────────────────────────────────────────────────────────────┤
│                      微内核底座 (Cordis 4)                  │
│    Context │ Events │ Tools (Waterfall流水线) │ Sessions    │
└─────────────────────────────────────────────────────────────┘
```

### 核心收益：
1. **主循环零修改**：无论是权限确认门禁、Docker 容器隔离，还是状态机审计，均通过 Cordis 的 `ctx.waterfall('tools/execute')` 中间件拦截注入，无需改动 Agent 主循环一行代码；
2. **能力可插拔（Capability Seams）**：模型适配层、Bash 执行器和持久化存储全部是标准的接口契约（Interface），可以随时在本地执行与云端沙箱之间无缝热切换。

---

## 📜 二、会话事实来源：单向追加事件溯源（Event Sourcing）

很多初级 Agent 直接在内存中维护 `messages: [{ role: 'user', content: ... }]` 数组，这在遇到中途打断、崩溃恢复或分支重放时会彻底失效。

DeepSeek Harness 采用了**不可变事件日志（Append-only Event Log）**作为系统唯一的“事实来源”：
* `turn/start` / `turn/end`：轮次生命周期边界
* `step/start` / `step/end`：ReAct 单步执行边界
* `assistant/chunk`：流式切片
* `tool/call` / `tool/result`：工具调用与结果
* `steering/message`：用户中途航向纠偏

### 动态消息投影（`deriveMessages`）
在每次向 DeepSeek API 发起推理请求前，通过纯函数 `session.deriveMessages()` 动态投影计算出符合大模型规范的请求上下文。这种设计天然具备了**崩溃恢复、会话分支（Fork）、断点重放与历史时间旅行**的能力。

---

## ⚡ 三、工业级命令执行安全：进程组隔离与超时强杀

在 Coding 场景中，让模型执行 `bash` 命令是高危操作。`mini-harness` 严格落地了三道工业级防护：

1. **进程组隔离（`detached: true` & `kill(-pid)`）**：
   子进程拉起的孙子进程（例如 `bash -c "npm test"` 启动的 node 进程）如果仅杀主进程会变成孤儿/僵尸进程滞留系统。在 Unix 下使用独立进程组，通过发送信号给负 PID（`-pid`）可将整棵进程树一网打尽。
2. **超时强杀梯级升级（Timeout Escalation）**：
   命令超时到达时先发送 `SIGTERM` 礼貌请求退出；2 秒宽限期后若仍未退出，自动升级为 `SIGKILL` 强制抹杀。
3. **64KB 内存输出截断保护**：
   防止 `cat large.log` 导致 Node.js OOM 或打爆大模型上下文窗口。

---

## 🛡️ 四、崩溃自愈：智能修补悬挂工具调用（Crash Recovery）

现实生产环境中，进程可能在模型发出 `tool_call` 后、工具执行结果到达前突然崩溃（如掉电、OOM、强杀）。

如果重新加载日志时直接把未闭合的记录送给 LLM，几乎所有大模型 API 均会直接报 `400 Invalid Transcript: Dangling tool calls` 错误！

### 智能闭合修复算法（`interruptedTurnClosers`）
在加载持久化会话时，系统会自动识别未闭合状态，**就地合成最小合法闭合事件**：
1. 为悬挂的 `tool-call` 合成 `isError` 的 `tool/result` 错误占位；
2. 若 Step 打开，合成 `step/end`；
3. 合成 `turn/end` 并标记 `aborted: 'interrupted by process crash'`；
4. 将修补结果写回磁盘，确保恢复后的历史转录 100% 合法且平衡。

---

## 💻 五、现代化 IDE 原生接入：Agent Client Protocol (ACP)

为了让 Coding Agent 走出终端黑框，进入现代开发者的主力编辑器，项目实现了由 **Zed Industries** 开源倡导的 **ACP (Agent Client Protocol)** 协议网关：

* **传输协议**：基于 `stdio` 的 Newline-Delimited JSON (NDJSON) JSON-RPC 2.0 双工通信；
* **多会话复用（Multi-Session）**：单个连接通过 `sessionId` 严格隔离路由多个项目会话；
* **富卡片流式渲染（`session/update`）**：将 DeepSeek R1 的深度思考流（`agent_thought_chunk`）、回复文本与工具执行卡片（`tool_call`）解耦推送至 Zed UI 面板。

只需在 Zed 的 `settings.json` 中添加 4 行配置，即可直接在 Zed 编辑器右侧 Assistant 面板中体验手写的 DeepSeek Coding Agent！

---

## 🚀 六、快速上手与开源实战

整个项目从 0 到 1 分为 5 个清晰递进的 Milestone，并配备了 **21 个全量绿灯通过的自动化测试套件** 与中英双语文档：

* 📖 **[Milestone 1: 骨架与内核 (Cordis, Event Sourcing, ReAct Loop)](https://github.com/wujingacross/mini-harness/blob/main/docs/01-milestone1-echo-agent.md)**
* 📖 **[Milestone 2: 真实能力 (DeepSeek 流式 API + 本地 Bash 进程组)](https://github.com/wujingacross/mini-harness/blob/main/docs/02-milestone2-coding-agent.md)**
* 📖 **[Milestone 3: 工业持久化 (JSONL/SQLite 双后端 + 崩溃恢复)](https://github.com/wujingacross/mini-harness/blob/main/docs/03-milestone3-session-persistence.md)**
* 📖 **[Milestone 4: 现代化 IDE 接入 (ACP 协议网关 + Zed 编辑器实战)](https://github.com/wujingacross/mini-harness/blob/main/docs/04-milestone4-acp-ide-integration.md)**
* 📖 **[Milestone 5: 系统韧性与控制 (Invariants 守卫 + Steering 纠偏)](https://github.com/wujingacross/mini-harness/blob/main/docs/05-milestone5-resilience-and-hardening.md)**

### 本地 3 步跑起来：
```bash
git clone https://github.com/wujingacross/mini-harness.git
cd mini-harness
pnpm install

# 运行 21 个自动化测试
pnpm test

# 启动真实 Coding Agent (需要 DEEPSEEK_API_KEY)
export DEEPSEEK_API_KEY=sk-xxxxxx
pnpm run demo:coding
```

---

欢迎前往 GitHub Star 关注与交流：👉 **[https://github.com/wujingacross/mini-harness](https://github.com/wujingacross/mini-harness)**
