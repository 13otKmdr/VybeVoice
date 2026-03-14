# CLAUDE.md — Voice Orchestrator

## What is this?

Event-driven voice orchestrator ("Merlin") that handles real-time voice conversation, delegates complex work to specialist agents, and persists session/task state. Uses MiniMax Speech (primary) or OpenAI Realtime API (fallback) for the voice layer.

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
│   └── server/                  # HTTP server, orchestrator, tools
│       └── src/
│           ├── orchestrator.ts  # MerlinOrchestrator — core event loop
│           ├── http.ts          # REST API (sessions, messages, events)
│           ├── tools.ts         # delegate_task tool + system prompt
│           └── main.ts          # Entry point, context factory
```

## Build & run

```bash
npm install
npm run build          # tsgo — builds all 3 packages in order
npm run check          # biome lint + tsc type check
npm start              # runs packages/server/dist/main.js
```

## Environment variables

- `MINIMAX_API_KEY` — MiniMax API key (preferred provider)
- `OPENAI_API_KEY` — OpenAI API key (fallback provider)
- `PORT` — HTTP server port (default: 3000)
- `DATA_DIR` — Filesystem store directory (default: ./data)

Server auto-detects provider: MINIMAX_API_KEY takes priority over OPENAI_API_KEY.

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

1. `packages/realtime/src/transport.ts` — the transport contract everything implements
2. `packages/server/src/orchestrator.ts` — the core event loop
3. `packages/core/src/domain/events.ts` — the domain event types
4. `packages/server/src/http.ts` — the REST API + provider resolution

## What's implemented (Phases 1-2)

- Domain types, stores, event log, policies
- MiniMax composite transport (Chat + TTS)
- OpenAI WebSocket transport
- MerlinOrchestrator with barge-in, function calling, task delegation
- HTTP REST API for session management

## What's next (Phases 3-5)

- **Phase 3**: TaskManager (state machine, retry, timeout), BuilderSpecialist wrapping pi-agent-core
- **Phase 4**: Rolling summaries, session reconnection, failure recovery
- **Phase 5**: Web client with WebRTC transport
