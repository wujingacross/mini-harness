# Mini Harness

[English](README.md) | [简体中文](README_CN.md)

> A clean-room, educational implementation of the **DeepSeek Coding Agent** infrastructure (reconstructed from `deepseek-harness`).

Mini Harness is a lightweight yet architecturally faithful reconstruction of the foundation behind **DeepSeek Code**. It demonstrates how to build a production-grade coding agent framework from the ground up using **Microkernel Architecture (Cordis)**, **Capability Seams**, **Event-Sourced Sessions**, and a robust **ReAct Agent Loop**.

---

## 🌟 Key Architecture Principles

1. **Microkernel Architecture (Everything is a Plugin)**:
   - Built on top of the Cordis microkernel. Core services (`ctx.llm`, `ctx.sessions`, `ctx.sessionPersistence`, `ctx.acpBridge`, `ctx.tools`, `ctx.systemPrompt`, `ctx.bash`, `ctx.agents`, `ctx.agentLoop`) are isolated plugins.
   - Cross-cutting concerns wrap around execution seams via Cordis `waterfall` without modifying core loops.

2. **Capability Seam Architecture (Interface ➔ Implementation ➔ Consumer)**:
   - Capability layers like Bash execution and Session Persistence decouple abstract interfaces, concrete backends (Local/JSONL/SQLite), and model tools.

3. **Event-Sourced Session Log**:
   - The single source of truth is an append-only sequence of typed events.
   - LLM message history is dynamically derived via the pure projection function `deriveMessages()`.

4. **Industrial Persistence & Crash Recovery**:
   - Write-Behind Buffering and Turn-end Flush Checkpoints eliminate I/O lag in the hot path.
   - Crash Recovery (`interruptedTurnClosers`) automatically synthesizes boundary closers for dangling tool calls.

5. **Modern IDE Integration (Agent Client Protocol - ACP)**:
   - Implements JSON-RPC 2.0 stdio protocol for native integration with **Zed** and modern ACP editors.
   - Multi-session multiplexing with structured streaming for reasoning, text, and rich tool-call execution cards.

6. **System Resilience & Hardening**:
   - Runtime Invariants Guard enforcing strict monotonic sequence ordering and event Deep Freezing.
   - Mid-turn Steering (`<steering>`) for dynamic real-time human intervention.
   - Cascading process group cancellation.

---

## 📂 Project Structure

```
mini-harness/
├── src/
│   ├── types/               # Core vocabulary (ContentBlocks, StreamChunks, SessionEvents, SessionHeader)
│   ├── session/             # Event-sourced session store & message projection (+ repair)
│   ├── session-persistence/ # Session Persistence Seam (Write-Behind buffer + Checkpoints)
│   │   ├── types.ts         # Abstract persistence service contract
│   │   ├── base.ts          # Base persistence service class
│   │   ├── jsonl.ts         # Append-only JSONL file storage backend
│   │   └── sqlite.ts        # Node 24 native node:sqlite relational database backend
│   ├── acp/                 # Agent Client Protocol (ACP) IDE Bridge
│   │   ├── types.ts         # JSON-RPC 2.0 & ACP wire types + pure Codec
│   │   ├── connection.ts    # Duplex NDJSON streaming connection
│   │   └── bridge.ts        # AcpBridge microkernel gateway plugin
│   ├── invariants/          # Runtime invariants guard & Deep Freeze immutability
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
│   ├── agent/               # Agent registry & global lifecycle events (+ steer / cancel)
│   ├── agent-loop/          # ReAct Loop state machine (+ resumeAgent support)
│   ├── ui/                  # Interactive stdio CLI with ANSI streaming rendering
│   └── demo/
│       ├── echo.ts          # Milestone 1: Echo Agent Demo
│       ├── coding.ts        # Milestone 2 & 3: Real Coding Agent with Persistence & Resume
│       └── acp.ts           # Milestone 4: Production ACP Server for Zed / IDE
├── docs/                    # Architecture & implementation tutorials
│   ├── 01-milestone1-echo-agent.md
│   ├── 02-milestone2-coding-agent.md
│   ├── 03-milestone3-session-persistence.md
│   ├── 04-milestone4-acp-ide-integration.md
│   └── 05-milestone5-resilience-and-hardening.md
├── tests/                   # Automated test suites (21 tests passing)
│   ├── echo.spec.ts         # ReAct loop test
│   ├── bash.spec.ts         # Bash executor & safety tests
│   ├── deepseek-adapter.spec.ts # DeepSeek protocol serialization tests
│   ├── session-persistence.spec.ts # JSONL / SQLite backends contract test
│   ├── resume.spec.ts       # End-to-end cross-process resume test
│   ├── acp.spec.ts          # ACP IDE protocol bridge test
│   ├── invariants.spec.ts   # Invariants guard & immutability test
│   ├── steering.spec.ts     # Mid-turn steering test
│   └── cancellation.spec.ts # Graceful cancellation test
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

#### Option A: Stdio Coding Agent (CLI)
```bash
export DEEPSEEK_API_KEY=sk-your-key-here
pnpm run demo:coding
```

#### Option B: ACP Server for Zed / IDE
Add to Zed's `settings.json`:
```json
{
  "agent_servers": {
    "Mini Harness (DeepSeek)": {
      "command": "pnpm",
      "args": ["--dir", "/path/to/mini-harness", "run", "demo:acp"]
    }
  }
}
```

---

## 🗺️ Roadmap & Milestones (100% Completed!)

- [x] **Milestone 1**: Foundation & Echo Agent (Microkernel, Event Sourcing, ReAct Loop, Stdio CLI)
- [x] **Milestone 2**: Coding Agent Core (DeepSeek API SSE Adapter + Local Bash Process Group Executor)
- [x] **Milestone 3**: Industrial Persistence (JSONL / SQLite append logs, Crash Recovery, `ctx.agentLoop.resumeAgent()`)
- [x] **Milestone 4**: Editor Integration (ACP - Agent Client Protocol JSON-RPC for Zed/IDE)
- [x] **Milestone 5**: Hardening (Invariants contract verification, Cancellation, Mid-turn Steering)

---

## 📚 Detailed Documentation

* 📖 [Milestone 1 Architecture & Implementation Guide](docs/01-milestone1-echo-agent.md)
* 📖 [Milestone 2 Coding Agent & Bash Capability Guide](docs/02-milestone2-coding-agent.md)
* 📖 [Milestone 3 Industrial Persistence & Crash Recovery Guide](docs/03-milestone3-session-persistence.md)
* 📖 [Milestone 4 Modern IDE Integration & ACP Gateway Guide](docs/04-milestone4-acp-ide-integration.md)
* 📖 [Milestone 5 System Resilience & Hardening Guide](docs/05-milestone5-resilience-and-hardening.md)
