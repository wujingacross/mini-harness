# Milestone 7: 现代化模块化 Web 控制台架构 (Modular Web Architecture & SSE Downlink)

> **对应版本**: `v1.2.0` (开发分支: `feat/code-editing-tools`)  
> **核心目标**: 彻底对齐 `deepseek-harness` 官方 `packages/host/frontend-static` 与 `packages/client/` 架构思想，告别单文件面条代码与模板字符串硬编码，以标准的**独立静态工程分层（HTML + CSS Tokens + 模块化 ES 组件）**构建高内聚的 Web 界面，由微内核 `WebServer` 进行真实静态托管与实时下行广播。

---

## 🌟 架构重构背景：从“模板字符串”到“模块化工程”

在早期的初步探索中，为了追求单文件快速运行，曾将 HTML/JS 作为长字符串嵌入在 TS 变量中。这种方式虽然能跑，但存在三大致命缺陷：
1. ❌ **代码组织混乱**：视图与后端服务严重耦合，失去现代前端组件化的独立性；
2. ❌ **难以维护与扩展**：所有的卡片、样式、事件处理混在数百行字符串中，无法进行样式调试与组件复用；
3. ❌ **与官方架构背离**：`deepseek-harness` 官方在 `packages/client/` 中对 UI 进行了严密的层级拆解（`ui-sidebar`, `ui-conversation`, `ui-tool`, `ui-theme`）。

在本次重构中，我们完整落地了**真正的独立模块化前端工程架构**。

---

## 🏛️ 前端目录与组件层级设计

```
web/
├── index.html                        # SPA 根挂载入口
├── styles/                           # 设计系统与样式 Token
│   ├── theme.css                     # DeepSeek 官方设计规范 (颜色变量、边框、字体)
│   └── main.css                      # 全局布局、滚动条、Diff 高亮与动画
└── src/                              # 模块化前端源码 (原生 ES Modules)
    ├── main.js                       # 主入口：初始化通信、装配各子组件
    ├── state.js                      # 响应式状态中心 (会话、文件列表、运行态)
    ├── connection.js                 # 通信层服务 (REST API 请求与 SSE 下行流)
    └── components/                   # 独立领域业务组件
        ├── sidebar.js                # 左侧栏组件 (工作区文件树 + 会话历史切换)
        ├── chat-stream.js            # 核心对话轨迹流组件 (Trajectory Timeline)
        ├── thought-card.js           # DeepSeek R1 深度思考手风琴卡片
        ├── tool-card.js              # 专业工具卡片 (Unified Diff / 终端 / 搜索)
        └── input-area.js             # 底部多行输入框、停止与中途干预 (Steering)
```

---

## 🔌 后端 WebServer 静态托管 Seam

后端微内核插件 [`src/web/server.ts`](../src/web/server.ts) 对齐官方 `@deepseek-ai/dsh-host-frontend-static` 的 SPA 托管语义：
1. **真实静态托管**：基于 `node:http` 与 `node:fs/promises`，通过正确的 MIME 格式分发 `web/` 下的 HTML、CSS、JS、SVG 等静态资产；
2. **SPA 路由回退（Fallback）**：未知路径自动回退至 `web/index.html`；
3. **下行流与控制面解耦**：
   * 下行：`/api/sessions/:id/events` 维持 SSE 长连接，实时向浏览器广播 Agent 状态机事件；
   * 上行：`/api/sessions/:id/prompt`、`/cancel`、`/steer` 接收用户指令并驱动 Agent Loop。

---

## 🚀 启动与体验

运行命令启动 Web 智能体服务：

```bash
export DEEPSEEK_API_KEY=sk-your-key-here
pnpm run demo:web
```

控制台输出：
```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃   🚀 DeepSeek Mini-Harness Web Dashboard is Live!           ┃
┃   URL:  http://127.0.0.1:3000                               ┃
┃   Model: deepseek-chat | Storage: .sessions                 ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

打开浏览器访问 `http://127.0.0.1:3000`，即可体验与官方设计语言高度一致的交互控制台！

---

## 🧪 自动化测试验证

编写了 [`tests/web.spec.ts`](../tests/web.spec.ts)：
1. 静态资产托管验证：`GET /` (HTML), `GET /styles/theme.css` (CSS), `GET /src/main.js` (JS)；
2. REST API 接口测试：会话创建、会话详情、工作区文件树扫描；
3. SSE 实时事件流与 Agent 工具执行全链路闭环断言。

```bash
pnpm test
```
* **全套 12 个测试套件、34 个测试全部 100% 绿灯通过！**
