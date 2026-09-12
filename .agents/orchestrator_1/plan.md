# Implementation Plan - Automated Routing Engine

## Phase 0: Survey & Codebase Investigation
- Spawn 3 Explorers in parallel:
  1. Explorer 1: Database Schema & Driver App Data Flow (Drizzle schema, routes, stops, offline sync, driver app view)
  2. Explorer 2: Manager UI, Routing, and Components (gestor routes, layouts, navigation, dark-blue theme styling, API endpoints)
  3. Explorer 3: Routing Engine Core & Excel/CSV Parsing (libraries installed, xlsx/papaparse/csv, distance calculation / geocoding / clustering algorithms, bin-packing)

## Phase 1: Architecture, PROJECT.md & Test Suite Setup
- Synthesize findings into PROJECT.md
- Setup E2E testing track (opaque-box, requirements-driven)
- Decompose implementation into milestones

## Phase 2: Execution & Verification per Milestone
- Milestone 1: Spreadsheet Parsing & Route Engine Core Algorithm (lib/route-engine.ts, clustering, bin-packing, capacity guarantee)
- Milestone 2: Manager UI (/gestor/roteirizador) - Upload, Route Visualizer, Driver/Vehicle Assignment, LIFO Loading Order
- Milestone 3: Dispatch API & Database Persistence (Drizzle ORM, route & stops creation, driver app integration)
- Final Milestone: E2E Test Suite verification (100% pass) + Adversarial hardening

## Phase 3: Final Verification & Reporting
- Forensic integrity audit (clean verdict required)
- Report completion with full evidence to parent
