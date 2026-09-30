# Milestone 9：规划模式与结构化待办管理 (Plan Mode & Structured Todo Tracking)

> 🚀 **对标官方实现**：深度对齐官方 `deepseek-harness` monorepo 中的 [`packages/plan/plan-mode`](file:///Users/wj/demo/deepseek-harness/packages/plan/plan-mode) 与 [`packages/todo/tool-todo`](file:///Users/wj/demo/deepseek-harness/packages/todo/tool-todo)。

---

## 1. 为什么需要 Plan Mode 与 Todo Tracking？

在编写代码或解决复杂的长链路任务时，直接让大模型漫无目的地逐个调用 Bash 或文件修改工具往往会导致以下典型痛点：
1. **盲目修改与缺乏全局视野**：模型在没有通盘摸清代码架构前就急于动手改代码，导致越改越乱；
2. **缺乏状态可视性与确定性进度**：外部界面和人类用户不知道 Agent 当前究竟在执行哪一步、总共有哪些步骤、剩余多少任务；
3. **缺乏干预与把关时机**：对于重要重构或关键特性，用户希望**先审查模型制定的方案**，确认无误后再放行执行。

为了彻底解决以上问题，官方 `deepseek-harness` 引入了两个相辅相成的核心能力包：
* **`@deepseek-ai/dsh-plan-mode` (Plan Mode)**：通过日志状态、动态提示词策略以及人机交互审查，强制模型“先调研探索、先做设计规划，在用户审查批准后方可执行”。
* **`@deepseek-ai/dsh-tool-todo` (Todo Tracking)**：模型面向状态机通过全量置换（Whole-list replacement）维护结构化任务清单，向用户和前端实时投射任务进度。

---

## 2. 核心架构设计与映射

Mini Harness 在保留微内核架构与单向事件溯源（Event Sourcing）的前提下，完整复现了这两个关键包的设计哲学：

| 官方 `deepseek-harness` 模块 | Mini Harness 实现 | 核心职责 |
| :--- | :--- | :--- |
| `@deepseek-ai/dsh-plan-mode` | [`src/plan/`](src/plan/) | `PlanModeController` 服务、`plan:policy` 动态提示词、`exit_plan_mode` 审查工具与 `/plan` 命令拦截 |
| `@deepseek-ai/dsh-tool-todo` | [`src/todo/`](src/todo/) | `todo_write` 工具、全量置换校验、并发 `in_progress` 限制与 `deriveTodos` 纯函数快照还原 |
| `@deepseek-ai/dsh-ui-tool` / `ui-plan` | [`web/src/components/TodoList.tsx`](web/src/components/TodoList.tsx) | Web 前端任务清单折叠卡片、完成度进度条、Checkbox 状态交互 |

---

## 3. 核心机制深入解析

### 3.1 单向日志事件契约 (Append-only Event Log)

遵循系统一贯的事件溯源哲学，我们在 `SessionEventMap` 中新增了两个强类型不可变事件：

```typescript
export interface PlanModeEvent {
  active: boolean;
  reason?: 'user_command' | 'plan_approved' | 'plan_off' | 'initial';
}

export interface TodoItem {
  id?: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface TodoWriteEvent {
  todos: TodoItem[];
}
```

任何重启、断点续聊或分支会话，均可通过重新折叠事件日志（Fold the log）100% 确定性地复现当前的 Plan 状态与 Todo 列表。

---

### 3.2 Plan Mode 状态机与 Step 边界写入

在 `PlanModeController` 中：
1. **非运行时直接落盘**：如果当前处于空闲状态，调用 `planMode.set(session, active)` 会直接将 `plan/mode` 追加写入日志（返回 `'committed'`）；
2. **运行时挂起至 Step 边界**：如果当前正处于 Turn 运行期中，为了保持大模型正在生成的这批工具调用时序一致，状态变更会进入 `pendingIntents` 队列（返回 `'queued'`），并在下一个 Step 启动（`agent/step-start`）时原子落盘并生效；
3. **动态提示词小节 (`plan:policy`)**：当且仅当 `planMode.isActive(session)` 为真时，系统提示词装配层才会注入引导文本：
   ```text
   [PLAN MODE ACTIVE]
   You are currently in PLAN MODE. Follow these rules strictly:
   1. Explore the codebase and gather relevant context first.
   2. Design a detailed, actionable approach and structure your work into concrete tasks using the `todo_write` tool.
   3. Do NOT make file edits, modify code, or run destructive commands while in plan mode.
   4. When your plan is ready, present your complete proposal using the `exit_plan_mode` tool. Your plan must be in Markdown format and start with a top-level heading (# Heading).
   5. Once the plan is approved, plan mode will automatically exit and you can proceed with execution.
   ```

---

### 3.3 人机审查与方案退出工具 (`exit_plan_mode`)

大模型在规划完成后调用 `exit_plan_mode`：
```typescript
interface ExitPlanArgs {
  plan: string; // 必须是非空 Markdown 且以 # 一级标题开头
}
```
* **前置条件验证**：若当前未激活 Plan 模式，或者 `plan` 参数未以 `# ` 开头，直接抛错拦截，保证提交格式严格合规；
* **可插拔审查决策**：
  * **测试与无头模式**：默认 `autoApprove: true`，直接批准并置位 `active = false`；
  * **人机交互模式**：支持注册 `approvalHandler(plan, session)`。若用户选择修改并给出反馈，工具抛出带有反馈的异常（`The user chose to keep planning; their feedback: ...`），模型将在下一轮自主修正方案。

---

### 3.4 待办工具的全量置换与并发控制 (`todo_write`)

不同于传统的增删改查 REST 接口，官方 `tool-todo` 坚定践行 **全量置换原则（Whole-list replacement）**：
1. **杜绝状态歧义**：大模型每次都把完整的待办列表打包上传，新列表直接覆盖旧列表，免除局部 ID 错乱或差量同步冲突；
2. **严格参数校验**：
   * 必须为数组，单项 `content` 不能为空且必须全局唯一（防重复添加）；
   * `status` 必须为 `'pending' | 'in_progress' | 'completed'`；
3. **专注度并发约束 (`allowParallelInProgress`)**：
   * 默认 `false`：严格限制同时处于 `in_progress` 的任务数**不得超过 1 项**。迫使智能体完成当前步骤并标记为 `completed` 后才能开启下一步，彻底治愈模型“心猿意马同时开多个坑”的顽疾；
   * 若配置为 `true`：允许多个子任务并发执行（用于后续里程碑的子智能体分发模式）。

---

## 4. Web 控制台呈现

* **任务进度条与清单面板**：在 Web 界面主工作区上方渲染 `TodoList` 组件，实时展示任务完成比例（如 `(2/4 完成 · 50%)`）以及各项状态指示（`✅ 已完成`、`⏳ 进行中`、`⚪ 等待中`）；
* **Plan 模式状态徽标**：当规划模式激活时，顶部高亮提示 `PLAN MODE`，并提供 `/plan off` 一键退出快捷按键；
* **轨迹流工具卡片**：轨迹流中清晰高亮 `exit_plan_mode`（带方案标题）与 `todo_write` 调用卡片。

---

## 5. 验证与测试套件

新增的 `tests/plan-and-todo.spec.ts` 包含 9 项覆盖全面的单元测试：
1. `todo_write` 校验非数组、空内容、重复内容及非法状态；
2. `allowParallelInProgress = false` 严格拒绝多个并发进行中任务；
3. `allowParallelInProgress = true` 正确接纳多个并发任务；
4. 全量置换与基于 Session Log 的纯函数还原；
5. `planMode` 开启/关闭及 `plan:policy` 动态提示词注入；
6. `exit_plan_mode` 校验非 Plan 模式调用与 `# Heading` 标题约束；
7. 自定义 `approvalHandler` 人机审查反馈与修正流；
8. 智能体循环拦截 `/plan` 与 `/plan off` 交互命令；
9. 智能体循环拦截 `/plan <instruction>` 指令并无缝转为规划态任务。
