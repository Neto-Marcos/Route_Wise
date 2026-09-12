## 2026-09-12T19:18:27Z
You are Explorer M1-2 for Milestone 1 of the Automated Routing Engine in Criar Rota TMS.
Your working directory is:
C:\Users\Dmeno\Documents\Codex\2026-09-10\canva-plugin-canva-openai-curated-remote\work\Route_Wise\.agents\explorer_m1_2
Workspace root:
C:\Users\Dmeno\Documents\Codex\2026-09-10\canva-plugin-canva-openai-curated-remote\work\Route_Wise

MANDATORY FIRST STEP:
Read C:\Users\Dmeno\Documents\Codex\2026-09-10\canva-plugin-canva-openai-curated-remote\work\Route_Wise\.agents\ORIGINAL_REQUEST.md (under ## 2026-09-12T19:10:35Z).
Read C:\Users\Dmeno\Documents\Codex\2026-09-10\canva-plugin-canva-openai-curated-remote\work\Route_Wise\PROJECT.md
Read C:\Users\Dmeno\Documents\Codex\2026-09-10\canva-plugin-canva-openai-curated-remote\work\Route_Wise\.agents\spec_miner_survey_3\spec_routing_engine.md

Focus: In-Memory Brazilian Geo Dictionary & Distance Utility
1. Design `lib/geo-brazil.ts`.
2. Provide dictionary of Brazilian cities and logistics hubs (all major SP municipalities, regional capitals, major hubs) with `{ lat, lng, name, uf }`.
3. Provide city name normalization function (strip accents, punctuation, lower case, handle "Campinas - SP", "São Paulo/SP").
4. Provide Haversine distance calculator.
5. Provide coordinate resolution function with instant fallback so that lookups take < 5ms (fulfilling < 3s benchmark).
6. Provide exact code structure and interfaces for the Worker.

Write your report to `C:\Users\Dmeno\Documents\Codex\2026-09-10\canva-plugin-canva-openai-curated-remote\work\Route_Wise\.agents\explorer_m1_2\m1_geo_plan.md` and handoff.md in your working directory. Send message to parent when done.
