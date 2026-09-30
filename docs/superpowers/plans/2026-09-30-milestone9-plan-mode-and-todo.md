# Milestone 9 Implementation Plan: Plan Mode & Structured Todo Tracking

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Milestone 9: Plan Mode (`src/plan/`) and Structured Todo Tracking (`src/todo/`), aligned with official `deepseek-harness` architecture, with full test coverage and Web GUI visualization.

**Architecture:** 
1. Add `plan/mode` and `todo/write` events to `SessionEventMap`.
2. Build `src/plan/`: `PlanModeController` Cordis service managing pending state across step boundaries, injecting `plan:policy` prompt section, and exposing `exit_plan_mode` tool with approval hooks.
3. Build `src/todo/`: `todo_write` tool implementing whole-list replacement, content validation, duplicate checking, and `allowParallelInProgress` constraint.
4. Integrate with `src/agent-loop/`: intercept `/plan`, `/plan off`, and `/plan <msg>` commands.
5. Expose REST/SSE projections in `src/web/server.ts` and render Plan Mode Tag + Todo Checklist in `web/src/`.
6. Write unit tests in `tests/plan-and-todo.spec.ts` (100% green).
7. Create comprehensive guide `docs/09-milestone9-plan-mode-and-todo-guide.md` and bump version to `1.4.0`.

**Tech Stack:** TypeScript, Cordis, Vitest, React 19, Vite.

**Spec:** `docs/superpowers/specs/2026-09-30-milestone9-plan-mode-and-todo-design.md`

## Global Constraints

- Working branch is strictly `feat/code-editing-tools`. Never merge or push to `main`.
- Never use `git commit --amend`. Every commit must be new and independent.
- Maintain 100% pass rate across all existing (43) and new unit tests.
- Single source of truth is the append-only event log.

---

### Task 1: Type Definitions and Event Schemas

**Files:**
- Modify: `src/types/session.ts`
- Create: `src/plan/types.ts`
- Create: `src/todo/types.ts`

**Steps:**
- [ ] Add `plan/mode` and `todo/write` event interfaces to `src/types/session.ts`.
- [ ] Define `PlanState`, `PlanConfig`, `PlanApprovalDecision` in `src/plan/types.ts`.
- [ ] Define `TodoItem`, `TodoConfig` in `src/todo/types.ts`.

---

### Task 2: Plan Mode Subsystem (`src/plan/`)

**Files:**
- Create: `src/plan/tools.ts`
- Create: `src/plan/engine.ts`
- Create: `src/plan/index.ts`
- Modify: `src/system-prompt/index.ts`

**Steps:**
- [ ] Implement `exit_plan_mode` tool in `src/plan/tools.ts` validating `# Heading`, active plan mode, and delegating to approval handler.
- [ ] Implement `PlanModeController` Cordis service in `src/plan/engine.ts` managing `pendingIntents`, pre-step emission, and `plan:policy` prompt section registration.
- [ ] Export module in `src/plan/index.ts`.

---

### Task 3: Todo Tracking Subsystem (`src/todo/`)

**Files:**
- Create: `src/todo/tool.ts`
- Create: `src/todo/index.ts`

**Steps:**
- [ ] Implement `todo_write` tool in `src/todo/tool.ts` with validation (non-empty, unique, valid status) and `allowParallelInProgress` constraint.
- [ ] Export module in `src/todo/index.ts`.

---

### Task 4: Agent Loop Integration

**Files:**
- Modify: `src/agent-loop/index.ts`

**Steps:**
- [ ] Intercept `/plan`, `/plan off`, `/plan <msg>` in `agent-loop`.
- [ ] Synchronize `planMode` state with user command steers.

---

### Task 5: Web Server Endpoints & Projections

**Files:**
- Modify: `src/web/server.ts`

**Steps:**
- [ ] Add helper projections `derivePlanState(session)` and `deriveTodos(session)`.
- [ ] Expose in `/api/sessions/:id` and `/api/sessions` payload.
- [ ] Add `POST /api/sessions/:id/plan/approve` endpoint for Web UI interaction.

---

### Task 6: Web UI Components

**Files:**
- Create: `web/src/components/TodoList.tsx`
- Modify: `web/src/components/TrajectoryStream.tsx`
- Modify: `web/src/context/SessionContext.tsx`

**Steps:**
- [ ] Create `TodoList.tsx` component rendering task progress bar and checklist.
- [ ] Show Plan Mode active indicator in `TrajectoryStream.tsx` header/action bar.
- [ ] Track `planMode` and `todos` in `SessionContext.tsx`.

---

### Task 7: Comprehensive Automated Tests

**Files:**
- Create: `tests/plan-and-todo.spec.ts`

**Steps:**
- [ ] Test `todo_write` validation (empty, duplicate, status, parallel constraint).
- [ ] Test `planMode` lifecycle (`/plan`, `/plan off`, `exit_plan_mode` validation).
- [ ] Test `deriveTodos` and `derivePlanState` deterministic reconstruction from logs.
- [ ] Run `pnpm test` and verify all tests pass.

---

### Task 8: Documentation, Versioning, and Release

**Files:**
- Create: `docs/09-milestone9-plan-mode-and-todo-guide.md`
- Modify: `README.md`
- Modify: `README_CN.md`
- Modify: `package.json`

**Steps:**
- [ ] Write `docs/09-milestone9-plan-mode-and-todo-guide.md`.
- [ ] Update `README.md` and `README_CN.md`.
- [ ] Bump `package.json` to `1.4.0`.
- [ ] Git commit, tag `v1.4.0`, and push to `origin feat/code-editing-tools`.
