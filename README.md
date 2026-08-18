# Mini Harness

[English](README.md) | [简体中文](README_CN.md)

> A clean-room, educational implementation of the **DeepSeek Coding Agent** infrastructure (reconstructed from `deepseek-harness`).

Mini Harness is a lightweight yet architecturally faithful reconstruction of the foundation behind **DeepSeek Code**. It demonstrates how to build a production-grade coding agent framework from the ground up using **Microkernel Architecture (Cordis)**, **Event-Sourced Sessions**, and a robust **ReAct Agent Loop**.

---

## 🌟 Key Architecture Principles

1. **Microkernel Architecture (Everything is a Plugin)**:
   - Built on top of the Cordis microkernel. Core services (`ctx.llm`, `ctx.sessions`, `ctx.tools`, `ctx.systemPrompt`, `ctx.agents`, `ctx.agentLoop`) are isolated plugins.
   - Cross-cutting concerns (permissions, sandbox execution, logging, invariants) wrap around execution seams via Cordis `waterfall` without modifying core loops.

2. **Event-Sourced Session Log**:
   - The single source of truth is an append-only sequence of typed events (`user/message`, `assistant/chunk`, `tool/call`, `tool/result`, `turn/start`, `turn/end`).
   - LLM message history is dynamically derived via the pure projection function `deriveMessages()`.

3. **Streaming & Block Assembler**:
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
│   ├── llm/                 # Abstract LLM adapter interface & Mock LLM
│   ├── agent/               # Agent registry & global lifecycle events
│   ├── agent-loop/          # ReAct Loop state machine (Turn -> Step -> Tool execution)
│   ├── ui/                  # Interactive stdio CLI with ANSI streaming rendering
│   └── demo/
│       └── echo.ts          # Runnable Milestone 1 demo app
├── docs/                    # Step-by-step architecture & implementation tutorials
│   └── 01-milestone1-echo-agent.md
├── tests/
│   └── echo.spec.ts         # Vitest end-to-end ReAct loop tests
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

### 3. Start Interactive Demo
```bash
pnpm run demo:echo
```

In the interactive CLI:
- Chat normally: `hello` ➔ Mock model responds directly.
- Trigger Tool Call: `echo deepseek-code` ➔ Triggers Reasoning CoT ➔ Emits Tool Call ➔ Executes Echo Tool ➔ Derives tool result ➔ Produces final summary.

---

## 🗺️ Roadmap & Milestones

- [x] **Milestone 1**: Foundation & Echo Agent (Microkernel, Event Sourcing, ReAct Loop, Stdio CLI)
- [ ] **Milestone 2**: Coding Agent Core (DeepSeek API SSE Adapter + Local Bash Process Group Executor)
- [ ] **Milestone 3**: Persistence & Recovery (JSONL / SQLite crash-safe persistence + Session Resume)
- [ ] **Milestone 4**: Editor Integration (ACP - Agent Client Protocol JSON-RPC for Zed/IDE)
- [ ] **Milestone 5**: Hardening (Invariants contract verification, Cancellation, Mid-turn Steering)

---

## 📚 Detailed Documentation

For a deep dive into the design rationale, data structures, and sequence diagrams, see:
* [Milestone 1 Architecture & Implementation Guide](docs/01-milestone1-echo-agent.md)
