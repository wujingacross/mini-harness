# Milestone 7: 100% 对齐官方的 React 声明式 Web 控制台 (React 19 + Vite + Trajectory)

> **对应版本**: `v1.2.0` (开发分支: `feat/code-editing-tools`)  
> **核心目标**: 100% 彻底对齐 `deepseek-harness` 官方 `packages/client/web-react` 与 `packages/client/ui-*` 架构体系。引入现代 React 19 + TypeScript (TSX) + Vite 声明式组件化与 Context 状态机，全方位复刻官方页面布局、视觉 Token、轨迹流渲染（Trajectory Stream）与一体化侧边栏交互。

---

## 🌟 架构对齐演进：从原生 DOM 到 React 声明式体系

在前序迭代中，我们逐步纠正了模板字符串与面条代码的缺陷。为了真正达到与 `deepseek-harness` 官方工程**100% 对齐**，我们引入了标准现代前端工程化方案：

| 对比维度 | 🏢 `deepseek-harness` 官方实现 | 🚀 `mini-harness` 最新实现 |
| :--- | :--- | :--- |
| **核心框架** | **React 18/19 (`.tsx` + JSX)** | **React 19 (`.tsx` + JSX)** |
| **状态机与上下文** | **`SessionProvider` Context + Hooks** | **`SessionProvider` Context + `useSession` Hook** |
| **构建工具** | **tsdown / Vite** 打包生成静态 bundle | **Vite** 毫秒级极速构建打包 |
| **组件化分层** | **`Sidebar`, `Header`, `TrajectoryStream`, `FloatingInputArea`** | **`Sidebar`, `Header`, `TrajectoryStream`, `FloatingInputArea`** |
| **布局形态** | **全高一体化贯通侧边栏（展开/极简收起双模式）** | **全高一体化贯通侧边栏（展开/极简收起双模式）** |

---

## 🏛️ React 组件树与目录架构

```
web/
├── index.html                        # SPA 挂载入口 (#root)
├── styles/                           # 官方设计规范
│   ├── theme.css                     # DeepSeek 颜色、间距与字体设计 Tokens
│   └── main.css                      # 轨迹流样式、滚动条、浮岛输入框阴影
├── src/                              # React 19 + TypeScript 源码
│   ├── main.tsx                      # createRoot 挂载入口
│   ├── App.tsx                       # AppShell 核心外壳布局 (Sidebar + Header + Stream + Input)
│   ├── context/
│   │   └── SessionContext.tsx        # 全局声明式会话状态机、SSE 连接与执行调度
│   └── components/
│       ├── Sidebar.tsx               # 官方贯通一体式侧边栏 (极简 Whale 窄条 / 展开项目树)
│       ├── Header.tsx                # 顶部导航栏 (会话名、模型 Badge、对话/轨迹 Tab、Session Log 导出)
│       ├── TrajectoryStream.tsx      # 紧凑时间线轨迹流 (Think · Read · Bash · Grep · Assistant Prose)
│       ├── FloatingInputArea.tsx     # 浮岛式圆角输入卡片 (Workspace / 模型下拉 / Steering / 遥测底栏)
│       └── MarkdownView.tsx          # 渐进式 Markdown 与代码块渲染器
├── dist/                             # Vite 生产环境构建生成的高性能静态 Bundle
vite.config.ts                        # Vite 配置文件
vitest.config.ts                      # Vitest 独立测试配置
```

---

## 🔌 后端静态分发 (对齐 host-frontend-static)

后端微内核插件 [`src/web/server.ts`](../src/web/server.ts) 自动探测 `web/dist`（生产构建产物）或 `web`，提供严格符合 SPA 规范的静态文件托管（带正确 MIME 类型分发与 404 SPA 回退）。

---

## 💎 里程碑 7 深度打磨特性 (Polished Details in v1.2.0)

在 v1.2.0 封包中，我们完成了 4 项核心交互细节与 1 项底层实时统计的深度打磨：

1. **工具调用可展开/折叠卡片 (Collapsible Tool Cards)**:
   - 轨迹流中的每个工具调用（Read / Edit / Write / Glob / Grep / Bash）均支持点击展开与收起；
   - 展开后展示由代码块高亮的**入参明细 (Arguments)** 与执行完成后的**输出结果 (Result)**，并配合旋转 Chevron 动画和执行状态指示（执行中 / 成功 / 失败）。
2. **动态模型联动选择 (Dynamic Model Switch)**:
   - 浮岛输入卡片右下角提供原生模型下拉选择菜单（支持 `deepseek-chat` / `deepseek-reasoner`）；
   - 发送 Prompt 时将所选模型透传至 `POST /api/sessions/:id/prompt`，后端 Agent 动态更新当前轮次模型选项，实现无缝动态切换。
3. **会话删除与清理机制 (Session Deletion)**:
   - 侧边栏会话列表项在鼠标悬停时显式呈现删除垃圾桶图标（`🗑️`）；
   - 支持调用 `DELETE /api/sessions/:id` 级联清理内存 SessionStore、活跃 Agent 实例以及磁盘 `.sessions/{id}.jsonl` 持久化文件。
4. **新会话空状态欢迎引导卡片 (Empty State & Prompt Capsules)**:
   - 新建会话且尚无消息时，主视区居中展示 DeepSeek 蓝色鲸鱼 Logo、系统介绍文案以及 3 个快捷提问胶囊卡片；
   - 用户轻点胶囊卡片即可立即向 Agent 发起关于仓库探索、算法编写或测试验证的指令。
5. **实时遥测统计底栏 (Live Telemetry Runtime Stats)**:
   - 修复了硬编码 0 的缺陷，在 `SessionContext` 中基于全生命周期事件流（`turn/start`、`step/start`、`tool/call` 以及 `assistant/message` 的 `usage`）纯函数聚合统计；
   - 底部实时精确展示：`X 轮 · Y 步 | 工具调用 Z 次 | 输入 A · 输出 B tokens | 首 token < 1s`。

---

## 🚀 运行与构建体验

无需额外安装配置，一条命令完成前端构建并启动 Agent Web 服务：

```bash
export DEEPSEEK_API_KEY=sk-your-key-here
pnpm run demo:web
```

* 独立前端开发模式（支持 HMR 热更新）：`pnpm run dev:web`
* 独立前端构建：`pnpm run build:web`

---

## 🧪 自动化测试验证

全套测试覆盖了后端 REST/SSE 接口、Session 状态流转、会话删除与模型切换，以及前端 Bundle 静态资产分发：

```bash
pnpm test
```
* **12 个测试套件、35 个单元与集成测试 100% 绿灯通过！**
