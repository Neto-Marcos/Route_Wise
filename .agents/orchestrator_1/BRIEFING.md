# BRIEFING — 2026-09-12T19:12:30Z

## Mission
Implement the Automated Routing Engine for Criar Rota TMS based on Excel/CSV spreadsheets: spreadsheet upload & parsing, clustering & bin-packing algorithm (volume m³ and weight kg limits), manager dispatch UI with visual route suggestions, driver & vehicle selection, Drizzle ORM persistence (Routes and Stops), driver app integration, and LIFO loading instructions.

## 🔒 My Identity
- Archetype: Project Orchestrator
- Roles: orchestrator, user_liaison, human_reporter, successor
- Working directory: C:\Users\Dmeno\Documents\Codex\2026-09-10\canva-plugin-canva-openai-curated-remote\work\Route_Wise\.agents\orchestrator_1
- Original parent: parent
- Original parent conversation ID: 36aa94d2-ade4-45b0-ba11-8b6ddf72359d

## 🔒 My Workflow
- **Pattern**: Project Pattern
- **Scope document**: C:\Users\Dmeno\Documents\Codex\2026-09-10\canva-plugin-canva-openai-curated-remote\work\Route_Wise\PROJECT.md
1. **Survey**: Spawn 3 Explorers / Spec Miners to map codebase and requirements.
2. **Decompose & Plan**: Create PROJECT.md (Architecture, Feature Inventory, Milestones, Interface Contracts, Code Layout).
3. **Dispatch & Execute**:
   - Top-level spawns E2E Testing Orchestrator / Test Writer.
   - Implementation track: Spawn Sub-orchestrators for milestones or run Iteration Loop (Explorer -> Worker -> Reviewer -> Challenger -> Auditor -> Gate).
4. **On failure**: Retry -> Replace -> Skip -> Redistribute -> Redesign.
5. **Succession**: Self-succeed at 16 spawns.
- **Current phase**: 0 (Survey)
- **Current focus**: Codebase survey & requirements mapping

## 🔒 Key Constraints
- Dispatch-only: NEVER write, modify, or create source code files directly.
- NEVER run build/test commands yourself — require workers to do so.
- NEVER investigate or explore the problem at the code level — dispatch Explorers for technical investigation.
- File-editing tools ONLY for metadata/state files (.md) in .agents/.
- Zero tolerance on integrity violations (Forensic Auditor is binary veto).
- Send results back to parent via send_message.

## Current Parent
- Conversation ID: 36aa94d2-ade4-45b0-ba11-8b6ddf72359d
- Updated: 2026-09-12T19:11:12Z

## Key Decisions Made
- Spawned 3 parallel survey subagents: Explorer 1 (schema/db/driver data flow), Explorer 2 (manager UI/Tailwind/routes), Spec Miner 3 (clustering/bin-packing/xlsx parsing/LIFO).

## Team Roster
| Agent | Type | Work Item | Status | Conv ID |
|-------|------|-----------|--------|---------|
| Explorer 1 | teamwork_preview_explorer | Survey DB Schema & Driver App | in-progress | 690d875d-40da-4552-95b3-f8f013429e86 |
| Explorer 2 | teamwork_preview_explorer | Survey Manager UI & Design System | in-progress | b0b804d0-56b1-4f3e-9d6d-3265a6598c2d |
| Spec Miner 3 | teamwork_preview_spec_miner | Survey Routing Engine & Algorithmic Spec | in-progress | 92edbe9e-8499-40d0-8b64-e4d396a14284 |

## Succession Status
- Succession required: no
- Spawn count: 3 / 16
- Pending subagents: 3
- Predecessor: none
- Successor: not yet spawned

## Active Timers
- Heartbeat cron: task-14 (*/10 * * * *)
- Safety timer: none
- On succession: kill all timers before spawning successor
- On context truncation: run manage_task(Action= list) — re-create if missing

## Artifact Index
- ORIGINAL_REQUEST.md — Authoritative user requirements
- DISPATCH.md — Initial dispatch instructions
- plan.md — High-level milestone and execution plan
- progress.md — Current status and heartbeat log
