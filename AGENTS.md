# AgentAtlas Engineering & Agent Collaboration Guide

## Overview

AgentAtlas is a local-first AI Agent Engineering workbench built as a TypeScript monorepo (`pnpm` workspaces).

## Workspace Layout

- `packages/shared`: Domain types, Zod schemas, 15-domain taxonomy, and design system token definitions.
- `packages/content`: Open-format content compiler (Markdown + YAML frontmatter + YAML/JSON), `[[wikilinks]]` & backlinks resolver, DAG cycle detector, path-traversal/XSS validator, Obsidian import/export, and bundle diff engine.
- `packages/simulator`: Deterministic seeded simulation engine (`Mulberry32` PRNG + state machine) powering 10 interactive agent mechanism labs.
- `apps/server`: Node.js 24 + Fastify 5 local server (`127.0.0.1:4317`), built-in `node:sqlite` + FTS5 CJK+English search, CSRF/Origin security guard, Windows DPAPI credential storage, atomic content import/rollback, backup/restore, AI Tutor OpenAI-compatible adapter, and static web hosting.
- `apps/web`: React 19 + TypeScript + Vite + Tailwind v4 + React Router + Zustand + `@xyflow/react` + `elkjs` + Mermaid + `remark/rehype`.
- `content/`: Verified knowledge nodes, learning paths, assessments, labs, sources, glossary, ecosystem, and casebook.
- `scripts/`: `validate-content.ts` and `benchmark.ts`.
- `tests/e2e/`: Playwright acceptance tests (AC01–AC14) & visual verification.

## Standard Commands

- Install dependencies: `pnpm install`
- Build all packages & apps: `pnpm build`
- Start production local server: `pnpm start` (or run `start.ps1` / `start.bat`)
- Validate all knowledge content: `pnpm validate:content`
- Run unit & integration tests: `pnpm test`
- Run performance benchmark: `pnpm bench`
- Run Playwright E2E suite: `pnpm test:e2e`

## Non-Negotiable Constraints

1. **Local-first & Offline-capable**: All core flows (Overview, Learning, Library, Search, Labs, Assessments, Notes, Bookmarks, Backup/Restore) must run cleanly offline without any API key or cloud database.
2. **Loopback Security**: Fastify binds strictly to `127.0.0.1`. Mutating endpoints verify `Host`, `Origin`, and `X-Atlas-Token`. Never log or persist API keys in SQLite, Markdown, backups, or frontend storage.
3. **Knowledge Integrity**: Every knowledge node has a stable `id`, verified `sourceIds`, and cannot be silently overwritten by unreviewed AI output. `requires` edges must form an acyclic DAG.
4. **Honest Labeling**: Simulated lab metrics/timings are explicitly tagged `simulated: true`. Never fabricate sources, versions, or test results.
