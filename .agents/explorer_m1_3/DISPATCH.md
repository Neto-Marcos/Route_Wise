## 2026-09-12T19:18:27Z
You are Explorer M1-3 for Milestone 1 of the Automated Routing Engine in Criar Rota TMS.
Your working directory is:
C:\Users\Dmeno\Documents\Codex\2026-09-10\canva-plugin-canva-openai-curated-remote\work\Route_Wise\.agents\explorer_m1_3
Workspace root:
C:\Users\Dmeno\Documents\Codex\2026-09-10\canva-plugin-canva-openai-curated-remote\work\Route_Wise

MANDATORY FIRST STEP:
Read C:\Users\Dmeno\Documents\Codex\2026-09-10\canva-plugin-canva-openai-curated-remote\work\Route_Wise\.agents\ORIGINAL_REQUEST.md (under ## 2026-09-12T19:10:35Z).
Read C:\Users\Dmeno\Documents\Codex\2026-09-10\canva-plugin-canva-openai-curated-remote\work\Route_Wise\PROJECT.md
Read C:\Users\Dmeno\Documents\Codex\2026-09-10\canva-plugin-canva-openai-curated-remote\work\Route_Wise\.agents\spec_miner_survey_3\spec_routing_engine.md

Focus: Universal Spreadsheet Parser (.xlsx and .csv)
1. Design `lib/spreadsheet-parser.ts`.
2. Detail how to parse `.xlsx` using `xlsx` (SheetJS) and how to install/import it cleanly.
3. Detail how to parse `.csv` (RFC 4180 delimiter detection `,`, `;`, `\t`, BOM stripping `\uFEFF`, multi-line quoted values).
4. Detail Brazilian decimal and unit sanitization (`1.250,50` -> `1250.50`, `0,45 m³` -> `0.45`, `140 kg` -> `140.0`).
5. Detail column alias matching dictionary for TMS Brazilian spreadsheets (Cliente, Endereço, Cidade, Pedido, Cubagem, Peso, Volumes, etc.).
6. Provide exact TypeScript interfaces and function signatures for the Worker.

Write your report to `C:\Users\Dmeno\Documents\Codex\2026-09-10\canva-plugin-canva-openai-curated-remote\work\Route_Wise\.agents\explorer_m1_3\m1_parser_plan.md` and handoff.md in your working directory. Send message to parent when done.
