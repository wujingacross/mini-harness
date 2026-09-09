# Milestone 8: 上下文自动压缩与截断管理 (Compaction & Context Management)

> **对应版本**: `v1.3.0` (开发分支: `feat/code-editing-tools`)  
> **核心对标**: 100% 对齐官方 `deepseek-harness` 中的 `@deepseek-ai/dsh-compaction` 与 `@deepseek-ai/dsh-compaction-basic` 核心架构规范。基于 **Cordis 微内核**、**事件溯源不可变日志 (Event Sourcing)**、**工具调用配对平衡 (Tool Pairing Balanced)** 与 **纯函数消息投影 (deriveMessages)**，彻底解决长时会话 Token 爆炸、窗口溢出与上下文幻觉问题。

---

## 🌟 架构对齐演进：为什么需要 Compaction？

在真实的软件工程编码场景中，智能体通常需要经历数轮乃至数十轮的多文件读取、搜索、编辑与测试运行（单次测试输出可能就占用数千 Token）。如果机械累加历史事件，会话上下文很快便会触及模型的窗口上限（如 64K / 128K），导致：
1. **Context Overflow 崩溃**：模型直接拒绝生成；
2. **推理幻觉加剧**：过长且充斥着陈旧中间报错的上下文会严重干扰模型对当前状态的判断；
3. **调用成本与延迟激增**：每个 Step 都重复发送数十 KB 的历史日志。

官方 `deepseek-harness` 在 `packages/compaction/*` 中设计了一套基于日志锁与投影替换的优雅解法，`mini-harness` 进行了 1:1 的完整工业级对齐：

| 架构维度 | 🏢 `deepseek-harness` 官方实现 | 🚀 `mini-harness` Milestone 8 实现 |
| :--- | :--- | :--- |
| **能力缝隙 (Seam)** | `CompactionEngine` 抽象服务 (`ctx.compaction`) | `CompactionEngine` Cordis 插件 (`ctx.compaction`) |
| **事件持久化** | 三段式日志锁：`compaction/start` -> `summary` -> `end` | 三段式日志锁：`compaction/start` -> `summary` -> `end` |
| **日志不可变性** | **Append-only**：历史原始事件绝不物理删除，完全可回放 | **Append-only**：纯追加模式，保证会话全息可审计与回放 |
| **投影替换** | `deriveMessages()` 动态跳过 `shadowedSeqs`，在原位注入摘要 | `deriveMessages()` 动态跳过 `shadowedSeqs`，在原位注入摘要 |
| **工具配对平衡** | `toolPairingBalancedBefore` 防止截断未闭合的 tool call | `balanceToolPairingRange` 确保 tool/call 与 tool/result 严格成对 |
| **触发策略** | 自动压力 (`pressure`) / 溢出容灾 (`overflow`) / `/compact` | 自动压力 (`pressure`) / 溢出容灾 (`overflow`) / `/compact` |
| **Web 呈现** | 蓝色优雅的 Compaction 折叠卡片与详细摘要展示 | 蓝色优雅的 Compaction 折叠卡片与详细摘要展示 |

---

## 🏛️ 核心架构与模块划分

```
src/
├── types/
│   └── session.ts                  # 声明 SessionEventMap: compaction/start, compaction/summary, compaction/end
├── session/
│   └── index.ts                    # deriveMessages() 纯函数投影：基于 shadowedSeqs 实现无损替换
├── compaction/                     # [新增] 核心压缩能力家族
│   ├── types.ts                    # CompactionResult, CompactionConfig, CompactionTrigger 类型定义
│   ├── tool-pairing.ts             # 字符/Token 估算器与工具调用配对平衡算法 (Tool Pairing Balanced)
│   ├── summarizer.ts               # 结构化多轮历史摘要提炼器 (LLM 优先 + 智能离线 Fallback)
│   ├── engine.ts                   # CompactionEngine 核心服务，注册为 ctx.compaction
│   └── index.ts                    # 统一导出
├── agent-loop/
│   └── index.ts                    # 步进前置压力检测、上下文溢出自动重试与 /compact 命令拦截
└── web/
    └── server.ts                   # 开放 POST /api/sessions/:id/compact 手动压缩接口
```

---

## 🔒 三段式日志锁与事件溯源

压缩操作在底层事件日志中通过**原子三段式事务标记**进行存证：

```
[seq 0 ~ 13] 早期多轮对话与工具调用事件
      ↓
[seq 14] compaction/start    <-- 独占锁建立，标记压缩事务开始（含 compactionId 与 turn）
[seq 15] compaction/summary  <-- 存证生成的摘要、被遮蔽的事件序号列表 (shadowedSeqs) 及节省 Token
[seq 16] compaction/end      <-- 释放独占锁，标记压缩完成
      ↓
[seq 17 ~ 20] 尾部保留的近期会话与后续轮次
```

* **防止并发竞争**：任何进行中的压缩操作都会持有锁，期间若有并发请求（如手动触发），系统直接安全拒绝，避免日志交织破坏。
* **崩溃检测 (Orphaned Lock)**：若压缩在生成摘要中途意外中断，日志中仅存在 `start` 而无 `end`，重启后系统能够明确侦测到该未完成的尝试，杜绝虚假声称成功。

---

## 🔄 `deriveMessages()` 纯函数投影模型

大模型看到的上下文并不是数据库里的原始日志，而是通过 `deriveMessages()` 投影后的视图：

```ts
// 当 deriveMessages() 执行时：
1. 收集所有 compaction/summary 中的 shadowedSeqs（例如 [0, 1, 2... 13]）；
2. 记录压缩区间的起始位置 startSeq；
3. 顺序遍历原始日志：
   - 遇到 startSeq 时，在当前位置注入 <context source="compaction"> 结构化摘要消息；
   - 遇到任何被包含在 shadowedSeqs 中的事件，一律直接跳过；
   - 保留未被遮蔽的尾部近期事件（保留短时工作记忆）；
4. 输出给大模型的 messages 列表。
```

这种方案带来了巨大的技术优势：
* **模型体验完全无缝**：后续轮次的大模型看到的是一条清晰的早期工作摘要，紧接着当前正在推进的任务，完全感知不到底层的折叠过程。
* **时序自然连续**：摘要严格出现在被折叠历史的起始物理位置，不倒装时序，完全符合自回归语言模型的因果注意力机制。

---

## ⚖️ 工具调用配对平衡保护 (Tool Pairing Balanced)

OpenAI 及 DeepSeek 协议规定：**如果上下文中存在 `tool-call`，则紧随其后的消息必须包含对应的 `tool-result`；反之亦然**。

`balanceToolPairingRange` 算法在选定压缩区间时执行严苛的配对校验：
* 若区间包含了 `tool/call` 但其 `tool/result` 处于保留区间之外（例如被切到了边界另一侧）；
* 算法自动将截断边界**安全后退**，把未闭合的 `tool/call` 移出被遮蔽集合；
* 彻底杜绝由于暴力截断导致的协议校验报错（`invalid_request_error: tool_call without result`）。

---

## 🚀 两种触发模式

### 1. 自动触发 (Automatic Pressure & Overflow Retry)
在 `agent-loop` 的 `runTurn` 阶段：
* **步进前检测 (`pre-step`)**：每个 Step 开始前探测当前会话累积 Token 数与轮次，一旦达到阈值（默认 `thresholdTokens: 8000` 或 `thresholdTurns: 8`），自动执行压缩；
* **溢出重试 (`context-overflow`)**：若大模型在调用时返回上下文超限错误，Agent 自动捕获该异常，触发紧急压缩，成功释放 Token 后自动重试当前 Step，无需人工介入。

### 2. 人工按需触发 (`/compact` 或 Web API)
* **命令行 / 聊天输入**：用户在任何时候只需在输入框中发送 `/compact`，智能体立即对当前会话执行一次手动压缩并汇报压缩报告；
* **REST API**：调用 `POST /api/sessions/:id/compact`，由外部系统或前端按钮触发。

---

## 🖥️ Web 控制台可视化呈现

在 Web 控制台的 **【对话】** 与 **【轨迹】** 视图中，压缩事件会自动渲染为精致优雅的通知卡片：
* **摘要卡片**：展示蓝色信箱图标、已折叠的事件数量与估算节约的 Token 数；
* **展开抽屉**：点击“查看压缩摘要”，即可展开阅读由 LLM 提炼的核心目标、已完成步骤、涉及文件与遗留状态；
* **实时状态胶囊**：在智能体执行期间，底部呈现波动的实时步数提示（`智能体正在思考与执行循环 (第 X 轮 · 第 Y 步)...`），彻底消除等待盲区。

---

## 🧪 自动化测试验证

全套自动化测试新增针对 Compaction 的全面断言（`tests/compaction.spec.ts`）：

```bash
pnpm test
```

* **13 个测试套件、43 个测试用例 100% 全绿通过！**
  * ✅ `registers CompactionEngine on Context with expected default configs`
  * ✅ `protects tool-pairing boundaries with balanceToolPairingRange`
  * ✅ `performs on-demand compactNow() and transforms deriveMessages() projection`
  * ✅ `rejects concurrent compaction attempts on the same session`
  * ✅ `intercepts /compact slash command and responds with confirmation`
  * ✅ `provides POST /api/sessions/:id/compact in WebServer`
  * ✅ `triggers automatic compaction during agent runTurn when reaching pressure threshold`
