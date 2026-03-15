# AGENTS.md — Voice Orchestrator

Agent-facing reference for working with this codebase. For human-readable documentation, see README.md.

## What is this?

Event-driven voice orchestrator ("Merlin") that handles real-time voice conversation, delegates complex work to specialist agents, and persists session/task state. Uses MiniMax Speech (primary) or OpenAI Realtime API (fallback) for the voice layer. Includes a `vybevoice` CLI for setup, configuration, and running the server.

## Project structure

```
voice-orchestrator/              # npm workspaces monorepo
├── packages/
│   ├── core/                    # Domain types, stores, policies, specialists interface
│   │   └── src/
│   │       ├── domain/          # SessionRecord, TaskRecord, DomainEvent union
│   │       ├── stores/          # File-backed stores (JSON/JSONL)
│   │       ├── policies/        # Intent classification, notification routing
│   │       ├── specialists/     # SpecialistRunner interface
│   │       └── utils/           # generateId()
│   ├── realtime/                # Transport abstraction + provider implementations
│   │   └── src/
│   │       ├── transport.ts     # RealtimeTransport interface, RealtimeEvent union
│   │       ├── minimax-*.ts     # MiniMax composite transport (Chat API + TTS WebSocket)
│   │       └── openai-ws.ts     # OpenAI Realtime API WebSocket transport
│   └── server/                  # HTTP server, orchestrator, CLI, tools
│       └── src/
│           ├── main.ts          # Entry point — CLI or legacy mode
│           ├── orchestrator.ts  # MerlinOrchestrator — core event loop
│           ├── http.ts          # REST API (sessions, messages, events)
│           ├── tools.ts         # delegate_task tool + system prompt
│           ├── cli/
│           │   ├── index.ts     # Commander program (vybevoice binary)
│           │   ├── config.ts    # Config types, load/save/validate (~/.vybevoice/config.json)
│           │   ├── ui.ts        # Terminal output helpers (banner, colors)
│           │   ├── commands/
│           │   │   ├── init.ts       # vybevoice init — interactive onboarding wizard
│           │   │   ├── start.ts      # vybevoice start — launch voice session
│           │   │   └── configure.ts  # vybevoice configure — view/modify settings
│           │   └── backends/
│           │       ├── registry.ts    # Backend name → SpecialistRunner factory
│           │       ├── openclaw.ts    # OpenClaw backend (default)
│           │       ├── claude-code.ts # Claude Code subprocess backend
│           │       ├── codex.ts       # Codex subprocess backend
│           │       ├── pyagent.ts     # Pi Agent HTTP backend
│           │       └── custom.ts      # Custom HTTP endpoint backend
│           └── specialists/
│               ├── merlin.ts    # MerlinSpecialist — OpenClaw gateway integration
│               └── builder.ts   # BuilderSpecialist — stub
```

## CLI

```bash
vybevoice init              # Interactive setup wizard (voice provider + agent backend + server)
vybevoice start             # Start the voice server
vybevoice start --port 8080 # Start with port override
vybevoice configure show    # Display current config (keys masked)
vybevoice configure voice   # Reconfigure voice provider
vybevoice configure agent   # Reconfigure agent backend
vybevoice configure server  # Reconfigure server settings
vybevoice configure reset   # Delete configuration
```

Config stored at `~/.vybevoice/config.json`. Resolution order: CLI flags > env vars > config file > defaults.

## Agent backends

All backends implement `SpecialistRunner` (packages/core/src/specialists/interface.ts). Selected during `vybevoice init`.

| Backend | Type | Description |
|---------|------|-------------|
| **OpenClaw** (default) | HTTP | Forwards tasks to OpenClaw gateway (`/v1/chat/completions`). Both built on pi-agent. |
| Claude Code | Subprocess | Spawns `claude -p` CLI with text output |
| Codex | Subprocess | Spawns OpenAI's `codex` CLI |
| Pi Agent | HTTP | Posts to pi-agent-compatible `/v1/chat/completions` endpoint |
| Custom | HTTP | Generic HTTP endpoint with configurable URL/headers |

### Adding a new backend

1. Create `packages/server/src/cli/backends/<name>.ts` implementing `SpecialistRunner`
2. Export a `create<Name>Specialist(options: BackendOptions): SpecialistRunner` factory
3. Add the backend to `registry.ts`
4. Add the `BackendName` union member and options interface to `config.ts`
5. Add prompts to `init.ts` and `configure.ts`

## Build & run

```bash
npm install
npm run build          # tsgo — builds all 3 packages in order
npm run check          # biome lint + tsc type check
npm start              # runs packages/server/dist/main.js (legacy mode)
```

## Environment variables

Environment variables override config file values (backward compatible):

- `MINIMAX_API_KEY` — MiniMax API key (preferred provider)
- `OPENAI_API_KEY` — OpenAI API key (fallback provider)
- `PORT` — HTTP server port (default: 3000)
- `DATA_DIR` — Filesystem store directory (default: ./data)
- `OPENCLAW_GATEWAY_URL` — OpenClaw gateway URL (default: http://127.0.0.1:18789)
- `OPENCLAW_GATEWAY_TOKEN` — OpenClaw auth token

## Code style

- **Biome**: tabs, 120 line width, recommended rules
- **TypeScript**: strict, ES2022 target, Node16 modules, `.js` import extensions
- **Patterns**: pi-mono conventions (npm workspaces, tsgo builds, file-backed stores)

## Architecture

### Hot path (voice turns)

```
User text/audio → Transport → Orchestrator event loop
                                ├── Direct response → Chat API → TTS → audio out
                                └── delegate_task tool call → TaskRecord → specialist queue
```

### Transport abstraction

`RealtimeTransport` interface decouples the orchestrator from any specific voice provider:

- **MiniMax** (`MiniMaxCompositeTransport`): Composes Chat API (LLM + function calling) with TTS WebSocket. Text streams sentence-by-sentence to TTS for low latency.
- **OpenAI** (`OpenAIWebSocketTransport`): Single WebSocket to OpenAI Realtime API (all-in-one audio/LLM/tools).

### Domain events

All state changes flow through an append-only event log (`FileEventLog`). Event types: `session.started`, `session.ended`, `turn.started`, `turn.ended`, `task.created`, `task.status_changed`, `task.completed`, `task.failed`, `assistant.speaking`, `assistant.interrupted`.

### Stores

File-backed (JSON per record, JSONL for event log). Interfaces in `core/src/stores/`, implementations are `File*Store` classes.

## Key files to read first

1. `packages/server/src/cli/index.ts` — the CLI entry point
2. `packages/server/src/cli/config.ts` — config schema and resolution
3. `packages/server/src/cli/backends/registry.ts` — backend factory registry
4. `packages/core/src/specialists/interface.ts` — the SpecialistRunner contract
5. `packages/realtime/src/transport.ts` — the transport contract
6. `packages/server/src/orchestrator.ts` — the core event loop
7. `packages/core/src/domain/events.ts` — the domain event types
8. `packages/server/src/http.ts` — the REST API + provider resolution
