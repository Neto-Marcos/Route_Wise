## 2026-09-12T19:18:27Z
You are Explorer M1-1 for Milestone 1 of the Automated Routing Engine in Criar Rota TMS.
Your working directory is:
C:\Users\Dmeno\Documents\Codex\2026-09-10\canva-plugin-canva-openai-curated-remote\work\Route_Wise\.agents\explorer_m1_1
Workspace root:
C:\Users\Dmeno\Documents\Codex\2026-09-10\canva-plugin-canva-openai-curated-remote\work\Route_Wise

MANDATORY FIRST STEP:
Read C:\Users\Dmeno\Documents\Codex\2026-09-10\canva-plugin-canva-openai-curated-remote\work\Route_Wise\.agents\ORIGINAL_REQUEST.md (under ## 2026-09-12T19:10:35Z).
Read C:\Users\Dmeno\Documents\Codex\2026-09-10\canva-plugin-canva-openai-curated-remote\work\Route_Wise\PROJECT.md
Read C:\Users\Dmeno\Documents\Codex\2026-09-10\canva-plugin-canva-openai-curated-remote\work\Route_Wise\.agents\explorer_survey_1\survey_schema_driver.md

Focus: Database Schema Migration & Capacity Persistence
1. Provide the exact SQL for migration `db/migrations/0006_routing_engine_capacities.sql` (adding `weight_kg`, `order_id`, `products` to `route_stops`, and capacity fields to `vehicles`).
2. Verify how `lib/db.ts` applies migrations automatically on startup for PGlite and PostgreSQL.
3. Review how `app/api/[...path]/route.ts` handles `POST /api/routes` and `GET /api/routes/[id]` to ensure new columns are saved and returned without breaking existing routes or driver app views.
4. Document the exact changes needed for the Worker.

Write your report to `C:\Users\Dmeno\Documents\Codex\2026-09-10\canva-plugin-canva-openai-curated-remote\work\Route_Wise\.agents\explorer_m1_1\m1_schema_plan.md` and handoff.md in your working directory. Send message to parent when done.
