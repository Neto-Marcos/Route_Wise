## 2026-09-12T19:18:27Z
You are the E2E Test Writer for the Automated Routing Engine in Criar Rota TMS.
Your working directory is:
C:\Users\Dmeno\Documents\Codex\2026-09-10\canva-plugin-canva-openai-curated-remote\work\Route_Wise\.agents\test_writer_e2e
Workspace root:
C:\Users\Dmeno\Documents\Codex\2026-09-10\canva-plugin-canva-openai-curated-remote\work\Route_Wise

MANDATORY FIRST STEP:
Read C:\Users\Dmeno\Documents\Codex\2026-09-10\canva-plugin-canva-openai-curated-remote\work\Route_Wise\.agents\ORIGINAL_REQUEST.md (under ## 2026-09-12T19:10:35Z).
Also read C:\Users\Dmeno\Documents\Codex\2026-09-10\canva-plugin-canva-openai-curated-remote\work\Route_Wise\PROJECT.md
Also read C:\Users\Dmeno\Documents\Codex\2026-09-10\canva-plugin-canva-openai-curated-remote\work\Route_Wise\.agents\spec_miner_survey_3\spec_routing_engine.md

Your Mission:
Design and implement the comprehensive, opaque-box E2E test suite for the Automated Routing Engine based strictly on requirements (not internal implementation details).
Follow the 4-tier methodology:
- Tier 1: Feature Coverage (>=5 tests per feature for the core routing requirements)
- Tier 2: Boundary & Corner Cases (empty spreadsheet, single-stop, exceeding vehicle capacity, invalid numbers, BOM, semicolons)
- Tier 3: Cross-Feature Combinations (spreadsheet parsing + clustering + bin-packing + LIFO manifest)
- Tier 4: Real-World Application Scenarios (benchmark dataset with 12+ cities/stops in SP, verifying <3s SLA and strict mathematical capacity guarantee)

Tasks:
1. Create `TEST_INFRA.md` at project root documenting test architecture, methodology, and coverage summary.
2. Implement the automated test suite in `tests/e2e-routing.test.mjs` (or related test files in `tests/`) using the Node.js native test runner (`node:test` and `node:assert/strict`).
3. Ensure tests test the public interfaces defined in `PROJECT.md` (`lib/spreadsheet-parser.ts`, `lib/route-engine.ts`, `lib/geo-brazil.ts`, and API contracts).
4. Publish `TEST_READY.md` at project root summarizing the test suite, test runner command (`node --test tests/e2e-routing.test.mjs`), tier counts, and feature checklist.
5. Write your handoff.md in your working directory.

Send message to parent when done.
