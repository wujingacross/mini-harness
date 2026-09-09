# Milestones 8 ~ 12 核心架构演进路线图 (Future Roadmap)

> **当前基线**: `v1.2.0` (Milestone 7 达成：React 19 声明式 Web 控制台与轨迹流)  
> **演进方针**: 始终与官方 `deepseek-harness` 单一包/模块架构设计严格对齐，坚持基于 **Cordis 微内核**、**事件溯源 (Event Sourcing)**、**能力缝隙 (Capability Seams)** 以及 **零破坏可扩展性** 进行工程化复刻。

---

## 🗺️ 后续里程碑全景概览

| 里程碑 | 架构职责 | 对应官方包 | 核心交付成果 |
| :--- | :--- | :--- | :--- |
| **Milestone 8️⃣** | **上下文自动压缩与截断管理** | `@deepseek-ai/dsh-compaction` | `compaction` 插件、滑动窗口、多轮摘要总结、事件溯源紧缩与无损还原 |
| **Milestone 9️⃣** | **任务规划与结构化待办管理** | `@deepseek-ai/dsh-plan`<br>`@deepseek-ai/dsh-todo` | `plan_mode` 规划状态机、`todo_write` 结构化跟踪、动态进度卡片渲染 |
| **Milestone 10** | **人机协同与敏感操作干预授权** | `@deepseek-ai/dsh-interaction`<br>`@deepseek-ai/dsh-acp` | `ask_user` 双向交互工具、高危命令 (rm/kill) 确认拦截、审批决策持久化 |
| **Milestone 11** | **动态技能系统与渐进式扩展加载**| `@deepseek-ai/dsh-skill` | `skills/` 目录规范 (`SKILL.md`)、渐进式 Prompt 注入、本地动态技能沙箱 |
| **Milestone 12** | **多智能体协同与任务委派** | `@deepseek-ai/dsh-subagent` | `invoke_subagent` 派发工具、树状子会话派生、上下文隔离与汇总归并 |

---

## 📦 里程碑 8️⃣：上下文自动压缩与管理 (Compaction & Context Management)

### 1. 痛点与对标
当多轮代码编写和调试使得会话 Token 接近上下文窗口上限（如 64K 或 128K）时，模型会因窗口溢出导致推理失败，或因过长的历史上下文产生幻觉并消耗高昂成本。官方通过 `@deepseek-ai/dsh-compaction` 实现透明压缩。

### 2. 核心架构设计
- **Capability Seam: `ctx.compaction`**:
  - `CompactionStrategy`: 探测当前会话累积 Token 数与轮次深度。
  - `compact(events: SessionEvent[]): Promise<CompactionResult>`: 截断早期轮次，保留首轮 User Prompt 与关键系统设定，将中间多轮工具执行输出交由 LLM 生成紧凑的结构化 Markdown 摘要（`SummaryBlock`）。
- **事件模型扩展**:
  - 引入 `session/compact` 事件到 `SessionEventMap`：
    ```ts
    interface SessionCompactEvent {
      type: 'session/compact'
      data: {
        compactedRange: [number, number] // 被折叠的事件索引区间
        summary: string                  // 压缩生成的历史概要
        tokensSaved: number              // 节约的 Token 估算
      }
    }
    ```
- **`deriveMessages()` 投影改造**:
  - 遇到 `session/compact` 时，跳过被折叠区间的底层原始工具事件，直接将 `summary` 作为一条系统/辅助上下文前置插入，做到对后续 LLM 轮次完全无缝透明。

---

## 📋 里程碑 9️⃣：任务规划与结构化待办 (Plan Mode & Todo Management)

### 1. 痛点与对标
复杂工程任务（如跨模块重构、多文件功能增补）往往需要经历“分析需求 -> 规划步骤 -> 顺序执行 -> 逐项验证”的周期。官方通过 `@deepseek-ai/dsh-plan` 与 `@deepseek-ai/dsh-todo` 提供透明、持久化且对模型可见的状态机。

### 2. 核心架构设计
- **工具实现**:
  - `todo_write`: 模型调用此工具增删改任务条目：
    ```ts
    interface TodoItem {
      id: string
      content: string
      status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
    }
    ```
  - `plan_mode`: 显式开启/锁定深度思考规划模式。
- **系统提示词动态挂载**:
  - `SystemPrompt` 服务通过 Section 注册，将当前活跃的待办事项列表（Todo Checklist）实时动态插入到 System Prompt 尾部，时刻保持 Agent 的执行目标对齐。
- **Web UI 与 ACP 协同**:
  - 在前端 Trajectory 上方或专属 Tab（Plan 仪表盘）中，渲染实时勾选更新的 Checkbox 待办卡片，用户对 Agent 的当前进度一目了然。

---

## 🛡️ 里程碑 10：人机协同与敏感操作干预授权 (Ask User & Human-in-the-Loop)

### 1. 痛点与对标
自动化 Agent 在执行破坏性操作（如 `rm -rf`、重写核心入口文件、执行远程网络请求）或遇到需求模糊时，不能盲目执行。官方 `@deepseek-ai/dsh-interaction` 提供了异步挂起与人工交互（Human-in-the-Loop）能力。

### 2. 核心架构设计
- **`ask_user` 交互工具**:
  - 模型在需求不明确时主动调用 `ask_user`，提供问题文本、选项列表（Options）及默认推荐。
  - Agent 进入 `waiting_for_user` 挂起状态，通过 SSE 向 Web/ACP 发出交互请求。
- **敏感工具拦截器 (Approval Waterfall Seam)**:
  - 在 `tools/execute` 管道中植入审批钩子：
    ```ts
    ctx.tools.before('execute', async ({ tool, args, next }) => {
      if (isHighRisk(tool, args)) {
        const approved = await ctx.interaction.requestApproval({ tool, args })
        if (!approved) throw new Error('User declined tool execution')
      }
      return next()
    })
    ```
- **异步响应与恢复机制**:
  - Web 端弹窗/卡片提供“允许 / 拒绝 / 输入补充说明”按钮，通过 `POST /api/sessions/:id/interaction` 提交决策，AgentLoop 接收信号后无缝从挂起点唤醒继续运行。

---

## 🧩 里程碑 11：动态技能系统与渐进式扩展 (Dynamic Skill System & Loader)

### 1. 痛点与对标
官方内置丰富的领域技能（如 `dsh-code-review`, `dsh-pre-push-checks`, `dsh-doc` 等）。技能系统允许 Agent 按需检索并动态加载专门领域的规约、脚本与知识，避免在初始 System Prompt 中堆砌所有长文本。

### 2. 核心架构设计
- **技能文件系统规范**:
  - 遵循与官方完全一致的 `.agents/skills/<skill-name>/` 结构：
    ```
    .agents/skills/
    └── <skill-name>/
        ├── SKILL.md       # YAML frontmatter + 领域标准说明
        ├── scripts/        # 专属辅助执行脚本
        └── references/     # 领域参考文档与模版
    ```
- **渐进式加载机制 (Progressive Disclosure)**:
  - 初始阶段仅向 Agent 暴露技能列表的 `name` 与简要 `description`（仅消耗极少 Token）。
  - 当 Agent 识别到当前任务相关时，调用内部工具（如 `load_skill`）按需抓取完整的 `SKILL.md` 注入上下文。
- **本地与项目级技能发现器**:
  - `SkillRegistry` 自动扫描 `~/.dsh/skills`（全局用户技能）与 `./.agents/skills`（项目特化技能），支持热加载与覆盖机制。

---

## 🤖 里程碑 12：多智能体协同与派发架构 (Subagent & Multi-Agent Delegation)

### 1. 痛点与对标
当单个任务规模庞大（例如“全面重构 5 个微服务模块并为每个模块重写测试”）时，单一 Agent 会因上下文混乱和注意力衰减陷入死循环。官方 `@deepseek-ai/dsh-subagent` 采用主智能体委派子智能体独立运行的架构。

### 2. 核心架构设计
- **`invoke_subagent` 委派工具**:
  - 主 Agent 调用此工具：
    ```ts
    invoke_subagent({
      role: 'Test Generator',
      prompt: '为 src/tools/file.ts 编写完整的边缘条件单元测试并保证 100% 覆盖',
      model: 'deepseek-chat',
      isolation: 'branch' | 'inherit'
    })
    ```
- **树状父子会话拓扑 (`Session Tree`)**:
  - 子 Agent 拥有独立的 `sessionId`、独立的内存上下文与事件流，不污染主 Agent 的上下文。
  - 父会话通过 `subagent/spawn` 与 `subagent/complete` 事件进行声明式关联。
- **并发调度与生命周期**:
  - 支持多子智能体并行启动，利用 Node.js Worker 线程或协程驱动独立的 `ReactLoopAgent` 实例。
  - 支持主智能体随时向子智能体发送消息（`send_message`）或执行取消（`kill_subagent`）。

---

## 🎯 实施路径与演进建议

1. **第 1 阶段 (Milestone 8 & 9)**：
   先完成 **上下文压缩 (Compaction)** 与 **任务规划待办 (Plan/Todo)**。这两个里程碑直接提升 Agent 在长任务、多文件编码中的上下文健康度与规划条理性，成本低且收益极高。
2. **第 2 阶段 (Milestone 10)**：
   实现 **人机协同与安全审批 (HITL Interaction)**，解决不可逆高危命令的执行安全性，提供 Web 端卡片级交互确认。
3. **第 3 阶段 (Milestone 11 & 12)**：
   进阶实现 **动态技能 (Skill)** 与 **多智能体派发 (Subagent)**，全面达成与工业级 `deepseek-harness` 完全一致的高级 Agent 特性。
