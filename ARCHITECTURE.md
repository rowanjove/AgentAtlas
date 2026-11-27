# AgentAtlas Architecture

## 1. System Principles

AgentAtlas separates **open-format knowledge assets** (`content/`), **compiled read/search/graph indices** (rebuildable SQLite tables `idx_*`), **user learning state** (durable SQLite tables `user_*`), **deterministic simulation** (`packages/simulator`), and **presentation** (`apps/web`).

## 2. Module Pipeline

```text
content/ (Markdown + YAML + JSON)
  │
  ▼  packages/content (Compiler & Validator)
     - YAML frontmatter & schema validation (Zod)
     - [[wikilinks]] & backlinks extraction
     - DAG cycle detection on `requires` edges
     - XSS / dangerous URL / path traversal checks
  │
  ▼  Validated ContentBundle
  ├──────────────────────────────────────────────┐
  ▼                                              ▼
apps/server (SQLite idx_* + FTS5)        apps/server (Content Manager)
  - unicode61 + cjk_tokens (2/3-gram)      - Snapshot before mutation
  - Glossary alias/synonym expansion       - Atomic switch & index rebuild
  - 1-2 hop local & global graph queries   - Major revision -> needs_review
  │                                        - One-click snapshot rollback
  ▼
Fastify Local API (127.0.0.1:4317)
  - Same-origin static serving (apps/web/dist)
  - CSRF token + Host/Origin guard on writes
  - Durable user_* tables (never wiped on index rebuild)
  - Optional AI Tutor Adapter (OpenAI-compatible + DPAPI key vault)
```

## 3. Simulation Architecture

`packages/simulator` executes pure deterministic state transitions using a seeded Mulberry32 PRNG. Each of the 10 labs accepts `{ seed, params, faultInjection }` and yields `{ graphNodes, graphEdges, steps, initialState, finalState, metrics }` so step-by-step replay, fault injection, and checkpoint recovery are 100% reproducible.

## 4. Security Boundaries

- **Network**: Bound to `127.0.0.1` only; CORS disabled.
- **Write Guard**: All `POST/PUT/PATCH/DELETE` routes require loopback `Host`, matching `Origin` (when present), and valid `X-Atlas-Token` issued by `/api/session`.
- **Content Safety**: No `<script>`, `<iframe>`, `on*=` attributes, or `javascript:` URIs in Markdown; frontend enforces `rehype-sanitize`.
- **Path Traversal**: `assertSafeRelativePath` normalizes, checks `path.relative`, and verifies `realpath` containment.
- **Credentials**: API keys live in server memory or Windows DPAPI (`data/.secrets.dpapi`), explicitly excluded from logs and backup archives.

## 5. Future Extension Boundaries

- **Tauri 2 Desktop Shell**: `apps/web` communicates exclusively via relative `/api/*` endpoints; `apps/server` can run as a local sidecar or be bridged via Tauri commands without rewriting UI state stores.
- **Static Site Export**: `packages/content` compiles to a self-contained `ContentBundle` JSON that can power a read-only static build.
