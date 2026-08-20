# Mini Harness

[English](README.md) | [简体中文](README_CN.md)

> A clean-room, educational implementation of the **DeepSeek Coding Agent** infrastructure (reconstructed from `deepseek-harness`).

Mini Harness is a lightweight yet architecturally faithful reconstruction of the foundation behind **DeepSeek Code**. It demonstrates how to build a production-grade coding agent framework from the ground up using **Microkernel Architecture (Cordis)**, **Capability Seams**, **Event-Sourced Sessions**, and a robust **ReAct Agent Loop**.

---

## 🌟 Key Architecture Principles

1. **Microkernel Architecture (Everything is a Plugin)**:
   - Built on top of the Cordis microkernel. Core services (`ctx.llm`, `ctx.sessions`, `ctx.tools`, `ctx.systemPrompt`, `ctx.bash`, `ctx.agents`, `ctx.agentLoop`) are isolated plugins.
   - Cross-cutting concerns (permissions, sandbox execution, logging, invariants) wrap around execution seams via Cordis `waterfall` without modifying core loops.

2. **Capability Seam Architecture (Interface ➔ Implementation ➔ Consumer)**:
   - Capability layers like Bash execution decouple abstract interface (`BashExecutor`), concrete execution backend (`LocalBashExecutor`), and model tool (`bash` tool). Swappable with Docker sandbox or remote execution without changing model prompts.

3. **Event-Sourced Session Log**:
   - The single source of truth is an append-only sequence of typed events (`user/message`, `assistant/chunk`, `tool/call`, `tool/result`, `turn/start`, `turn/end`).
   - LLM message history is dynamically derived via the pure projection function `deriveMessages()`.

4. **Streaming & Block Assembler**:
   - Handles multi-modal streams (Reasoning / CoT thinking, Text deltas, and Tool call deltas) and incrementally assembles them into structured content blocks.

---

## 📂 Project Structure

```
mini-harness/
├── src/
│   ├── types/               # Core vocabulary (ContentBlocks, StreamChunks, SessionEvents)
│   ├── session/             # Event-sourced session store & message projection
│   ├── system-prompt/       # Ordered section prompt assembly & tool schema providers
│   ├── tools/               # Tool registry & tools/execute waterfall pipeline
│   │   └── bash.ts          # Model-facing bash tool definition
│   ├── bash/                # Bash Capability Seam (Interface + Local process group impl)
│   │   ├── types.ts         # BashExecutor abstract contract & result types
│   │   ├── local.ts         # Process group isolation, timeout kill, 64KB truncation
│   │   └── index.ts         # ctx.bash service
│   ├── llm/                 # Model adapters (Mock LLM + Real DeepSeek SSE adapter)
│   │   ├── deepseek.ts      # Real DeepSeek API SSE streaming & Function Calling
│   │   └── index.ts         # ctx.llm service
│   ├── agent/               # Agent registry & global lifecycle events
│   ├── agent-loop/          # ReAct Loop state machine (Turn -> Step -> Tool execution)
│   ├── ui/                  # Interactive stdio CLI with ANSI streaming rendering
│   └── demo/
│       ├── echo.ts          # Milestone 1: Echo Agent Demo
│       └── coding.ts        # Milestone 2: Real DeepSeek Coding Agent Demo
├── docs/                    # Architecture & implementation tutorials
│   ├── 01-milestone1-echo-agent.md
│   └── 02-milestone2-coding-agent.md
├── tests/                   # Automated test suites
│   ├── echo.spec.ts         # ReAct loop test
│   ├── bash.spec.ts         # Bash executor & safety tests
│   └── deepseek-adapter.spec.ts # DeepSeek protocol serialization tests
├── package.json
└── tsconfig.json
```

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
pnpm install
```

### 2. Run Tests
```bash
pnpm test
```

### 3. Run Demos

#### Option A: Offline Echo Demo (No API key needed)
```bash
pnpm run demo:echo
```

#### Option B: Real DeepSeek Coding Agent (Requires DEEPSEEK_API_KEY)
```bash
export DEEPSEEK_API_KEY=sk-your-key-here
pnpm run demo:coding
```

---

## 🗺️ Roadmap & Milestones

- [x] **Milestone 1**: Foundation & Echo Agent (Microkernel, Event Sourcing, ReAct Loop, Stdio CLI)
- [x] **Milestone 2**: Coding Agent Core (DeepSeek API SSE Adapter + Local Bash Process Group Executor)
- [ ] **Milestone 3**: Persistence & Recovery (JSONL / SQLite crash-safe persistence + Session Resume)
- [ ] **Milestone 4**: Editor Integration (ACP - Agent Client Protocol JSON-RPC for Zed/IDE)
- [ ] **Milestone 5**: Hardening (Invariants contract verification, Cancellation, Mid-turn Steering)

---

## 📚 Detailed Documentation

* 📖 [Milestone 1 Architecture & Implementation Guide](docs/01-milestone1-echo-agent.md)
* 📖 [Milestone 2 Coding Agent & Bash Capability Guide](docs/02-milestone2-coding-agent.md)
