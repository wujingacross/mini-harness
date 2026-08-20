# DeepSeek Coding Agent 从 0 到 1 搭建指南

> **阶段**：Milestone 2 — 真实 DeepSeek API 与本地 Bash 进程组执行器（升级为真实 Coding Agent）  
> **代码仓库**：[mini-harness](file:///Users/wj/demo/mini-harness)  
> **参考来源**：[deepseek-harness](file:///Users/wj/demo/deepseek-harness)

---

## 一、Milestone 2 核心使命与架构跃迁

在 Milestone 1 中，我们构建了微内核容器、事件溯源 Session 与 ReAct Loop，并通过 `MockLlmAdapter` 验证了状态机。  
在 **Milestone 2** 中，我们将把整个系统升级为**真正具备生产力、能够直接在本地执行命令、读写文件、搜索代码、修复 Bug 的真实 Coding Agent**！

```
┌─────────────────────────────────────────────────────────────┐
│                    coding-agent (真实应用)                  │
├─────────────────────────────────────────────────────────────┤
│                    ReAct Agent Loop 引擎                    │
│             (Session ➔ Turn ➔ Step 状态机)                 │
├─────────────────────────────────────────────────────────────┤
│                     核心能力 Seam 扩展                      │
│                                                             │
│   ┌─────────────────────┐      ┌─────────────────────────┐  │
│   │   DeepSeekAdapter   │      │    LocalBashExecutor    │  │
│   │ (SSE流式 / R1思考 / │      │  (进程组隔离 / 超时强杀 │  │
│   │  Function Calling)  │      │   64KB输出截断防护)     │  │
│   └─────────────────────┘      └─────────────────────────┘  │
│              ▲                              ▲               │
│              │ (LlmAdapter 抽象)            │ (BashExecutor)│
├──────────────┴──────────────────────────────┴───────────────┤
│                      微内核容器 (Cordis)                     │
│               Context │ Tools │ Session │ Prompt            │
└─────────────────────────────────────────────────────────────┘
```

---

## 二、能力 Seam 架构：Interface ➔ Implementation ➔ Consumer

在 `deepseek-harness` 中，一个极为重要的架构范式是 **“三层能力解耦（Capability Seam）”**。我们以 `bash` 执行能力为例：

```mermaid
graph TD
    subgraph 1. Interface (抽象契约)
        B1["BashExecutor (抽象类)"]
        B2["BashRunOptions / BashRunResult (输入输出词表)"]
    end

    subgraph 2. Implementation (具体执行后端)
        I1["LocalBashExecutor (本地 Node.js 进程组实现)"]
        I2[/"DockerSandboxExecutor (未来容器沙箱实现)"/]
        I3[/"RemoteSshExecutor (未来远程机器执行)"/]
    end

    subgraph 3. Consumer (面向模型/用户的工具)
        C1["createBashTool(ctx) (注册到 ctx.tools)"]
        C2["System Prompt bash 工具说明指南"]
    end

    I1 -.->|继承并提供服务| B1
    I2 -.->|继承并提供服务| B1
    I3 -.->|继承并提供服务| B1
    C1 -->|仅依赖抽象服务 ctx.bash| B1
```

### 为什么必须这样拆分？
1. **模型工具层零感知**：大模型看到的 `bash` 工具入参（`command`, `workdir` 等）和返回格式是恒定的。
2. **后端可插拔**：开发阶段使用 `LocalBashExecutor`（直接在宿主机执行）；到了多租户云端环境，只需加载 `DockerSandboxExecutor` 替换 `ctx.bash`，其他所有提示词、工具定义、Agent Loop **无需修改一行代码**！

---

## 三、本地 Bash 进程组与安全防护深度拆解

本地执行任意命令（`bash -c`）是 Coding Agent 最核心的能力，但也伴随着巨大的安全与稳定性挑战。`mini-harness` 严格落地了以下三道工业级防护网：

### 1. 进程组隔离与级联清理 (`detached: true` & `process.kill(-pid)`)
* **痛点**：若用户让 Agent 执行 `npm test` 或 `python server.py`，这些进程在退出或被中断时，如果仅杀死主进程 `pid`，其衍生的子进程将变成**孤儿进程（Orphan/Zombie）**继续霸占端口和 CPU。
* **解决方案**：
  * 在 `spawn` 时设置 `detached: true`，操作系统会为该命令及其衍生子进程创建独立的**进程组（Process Group）**。
  * 当需要终止或超时时，使用 `process.kill(-pid, signal)`（负数 PID 代表向整个进程组广播信号），确保所有后代进程被一网打尽。

### 2. 超时强杀升级策略 (Timeout Escalation)
* 很多任务可能陷入死循环（如 `while true; do ...` 或等待输入）。
* 执行器内置定时器：
  1. 超时到达时，首先发送 `SIGTERM` 礼貌请求进程退出并保存数据；
  2. 若 2 秒宽限期后进程仍未退出，自动升级发送 `SIGKILL` 无条件强制抹杀。

### 3. 内存输出截断保护 (Output Truncation)
* **痛点**：如果命令输出了几百兆的日志（例如误执行了 `cat large.log` 或构建输出失控），直接灌入内存会导致 Node.js OOM，且大模型上下文窗口会瞬间爆掉。
* **解决方案**：
  * 内存输出设置严格上限（默认 `64KB`）。
  * 超过上限后立即丢弃后续字节，并在输出末尾追加 `[output truncated: exceeded 64000 bytes limit]` 提示，使大模型明确知道输出被截断，并引导其使用 `head`/`tail`/`grep` 精确过滤。

---

## 四、真实 DeepSeek API SSE 协议与流式解析

在 [`src/llm/deepseek.ts`](file:///Users/wj/demo/mini-harness/src/llm/deepseek.ts) 中，我们手写实现了针对 DeepSeek API（`https://api.deepseek.com`）的流式调用与消息序列化：

```mermaid
sequenceDiagram
    participant Adapter as DeepSeekAdapter
    participant API as DeepSeek API (/chat/completions)
    participant Loop as ReactLoopAgent (BlockAssembler)

    Adapter->>API: POST (stream=true, tools=[bash], messages=...)
    API-->>Adapter: SSE Chunk: delta { reasoning_content: "I should..." }
    Adapter-->>Loop: StreamChunk { type: "reasoning-delta", text: "..." }
    
    API-->>Adapter: SSE Chunk: delta { tool_calls: [{ id: "call_1", function: { name: "bash", arguments: "{\"comm" } }] }
    Adapter-->>Loop: StreamChunk { type: "tool-call-delta", name: "bash", argumentsDelta: "{\"comm" }

    API-->>Adapter: SSE Chunk: delta { tool_calls: [{ function: { arguments: "and\":\"ls\"}" } }] }
    Adapter-->>Loop: StreamChunk { type: "tool-call-delta", argumentsDelta: "and\":\"ls\"}" }

    API-->>Adapter: SSE Chunk: data: [DONE], usage: { prompt: 150, completion: 80 }
    Adapter-->>Loop: StreamChunk { type: "usage", usage: ... }
    Adapter-->>Loop: StreamChunk { type: "finish", reason: { kind: "tool-use" } }
```

### 关键细节处理：
1. **多模态流分流**：
   * `delta.reasoning_content` ➔ 映射为 `reasoning-delta`（对应终端中暗淡显示的思考流）；
   * `delta.content` ➔ 映射为 `text-delta`（对应终端中青色高亮的回复正文）；
   * `delta.tool_calls` ➔ 映射为 `tool-call-delta`（携带参数片段增量）。
2. **`role: 'tool'` 角色转换**：
   * 在 OpenAI / DeepSeek 规范中，工具执行结果必须作为独立消息 `{ role: 'tool', tool_call_id: '...', content: '...' }` 传回；
   * `serializeMessages()` 会自动将 Session 中的 `tool-result` 块无缝转换为合法的 API Wire 格式。

---

## 五、运行真实 Coding Agent 体验

### 1. 配置 API 密钥
在 `/Users/wj/demo/mini-harness/.env` 或环境变量中导出你的 DeepSeek API Key：
```bash
export DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 2. 运行自动化测试套件
```bash
cd /Users/wj/demo/mini-harness
pnpm test
```
* 8 个单元测试全部绿灯通过（包括进程退出码捕获、stderr 捕获、超时截断、进程组杀死、消息序列化测试）。

### 3. 启动真实 Coding Agent
```bash
cd /Users/wj/demo/mini-harness
pnpm run demo:coding
```

**你可以尝试给它真实的编程任务**，例如：
* `查看当前目录下的文件列表，并告诉我 package.json 里的依赖有哪些`
* `在 tests 目录下新建一个 test-math.spec.ts 文件，编写一个测试 1+1=2 的单测，并用 vitest 运行它验证结果`
* `搜索 src 目录下所有用到 LocalBashExecutor 的地方`

你会看到 Agent：
1. **打印 Reasoning 思考过程**（`<think>` 内部规划）；
2. **自动调用 `bash` 工具** 并传入命令；
3. **本地实时运行命令** 并捕获真实输出；
4. **根据运行结果** 给出清晰的最终答复！

---

## 六、Milestone 2 涉及的代码文件清单

| 文件路径 | 职责与作用 |
| :--- | :--- |
| [`src/bash/types.ts`](file:///Users/wj/demo/mini-harness/src/bash/types.ts) | 定义 Bash 能力抽象契约 `BashExecutor` 与 `BashRunResult` |
| [`src/bash/local.ts`](file:///Users/wj/demo/mini-harness/src/bash/local.ts) | 工业级本地 Bash 进程组执行器（超时强杀、截断防护） |
| [`src/bash/index.ts`](file:///Users/wj/demo/mini-harness/src/bash/index.ts) | 注册 `ctx.bash` 微内核服务 |
| [`src/tools/bash.ts`](file:///Users/wj/demo/mini-harness/src/tools/bash.ts) | 面向大模型的标准 `bash` 工具定义与输出格式化 |
| [`src/llm/deepseek.ts`](file:///Users/wj/demo/mini-harness/src/llm/deepseek.ts) | 真实 DeepSeek API SSE 流式协议与 Function Calling 适配器 |
| [`src/demo/coding.ts`](file:///Users/wj/demo/mini-harness/src/demo/coding.ts) | 真实 Coding Agent 终端入口 App |
| [`tests/bash.spec.ts`](file:///Users/wj/demo/mini-harness/tests/bash.spec.ts) | Bash 执行器与安全特性的自动化测试套件 |
| [`tests/deepseek-adapter.spec.ts`](file:///Users/wj/demo/mini-harness/tests/deepseek-adapter.spec.ts) | DeepSeek 适配器序列化与参数拼装单元测试 |

---
*文档生成于 `/Users/wj/demo/mini-harness` Milestone 2 演进阶段。*
