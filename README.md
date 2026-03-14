# Voice Orchestrator

An event-driven voice-first orchestrator that handles real-time conversation and delegates complex tasks to specialist agents. Built with TypeScript, designed for low-latency voice interaction.

## Overview

**Merlin** is a voice assistant that:

- Answers simple questions directly with natural speech
- Delegates complex requests (building, researching, deploying) to specialist agents
- Tracks tasks, emits domain events, and persists everything to disk
- Supports barge-in (interrupt the assistant mid-speech)

The system separates the **hot path** (voice turn-taking, <300ms latency) from the **cold path** (specialist work, artifacts, summaries).

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                    HTTP REST API                      │
│   POST /sessions  POST /sessions/:id/messages  ...   │
└──────────────────────┬───────────────────────────────┘
                       │
              ┌────────▼─────────┐
              │ MerlinOrchestrator│
              │  (event loop)     │
              └───┬──────────┬───┘
                  │          │
         ┌────────▼───┐  ┌──▼──────────┐
         │  Transport  │  │  Task Store  │
         │ (provider)  │  │  Event Log   │
         └──────┬──────┘  └─────────────┘
                │
    ┌───────────┼───────────┐
    │                       │
┌───▼──────────┐   ┌───────▼──────────┐
│   MiniMax    │   │     OpenAI       │
│ Chat + TTS   │   │  Realtime API    │
│ (composite)  │   │  (WebSocket)     │
└──────────────┘   └──────────────────┘
```

### Voice Providers

| Provider | How it works | Cost |
|----------|-------------|------|
| **MiniMax** (default) | Chat API (M2.5) for LLM + TTS WebSocket (Speech 2.8) for voice. Sentences stream to TTS as they complete for low latency. | ~$5/mo starter |
| **OpenAI** (fallback) | Single WebSocket to Realtime API. All-in-one audio input/output + LLM + function calling. | Pay-per-use |

Set `MINIMAX_API_KEY` for MiniMax or `OPENAI_API_KEY` for OpenAI. MiniMax takes priority if both are set.

## Quick Start

### Prerequisites

- Node.js >= 20
- A MiniMax API key ([platform.minimax.io](https://platform.minimax.io)) or OpenAI API key

### Install & Build

```bash
git clone <repo-url>
cd voice-orchestrator
npm install
npm run build
```

### Run

```bash
export MINIMAX_API_KEY=your_key_here
npm start
```

The server starts on port 3000 (configurable via `PORT` env var).

### Web Voice Console

Open [http://localhost:3000](http://localhost:3000) to use the browser voice console.

- It behaves like a single-thread chat surface: one conversation, voice and text in the same place.
- Choose `OpenAI Realtime` for continuous microphone streaming.
- Choose `MiniMax` if you only want typed fallback in the browser.
- Delegated tasks stay attached to the same thread instead of moving into a separate dashboard.

### Try It

```bash
# Create a session
curl -s -X POST http://localhost:3000/sessions \
  -H 'Content-Type: application/json' \
  -d '{"userId": "test", "provider": "openai"}' | jq

# Send a message (direct answer)
curl -s -X POST http://localhost:3000/sessions/{SESSION_ID}/messages \
  -H 'Content-Type: application/json' \
  -d '{"text": "Hello, how are you?"}'

# Send a message (delegated task)
curl -s -X POST http://localhost:3000/sessions/{SESSION_ID}/messages \
  -H 'Content-Type: application/json' \
  -d '{"text": "Build me a landing page for my startup"}'

# Check events (should see turn events + task.created)
curl -s http://localhost:3000/sessions/{SESSION_ID}/events | jq

# Check session state with tasks
curl -s http://localhost:3000/sessions/{SESSION_ID} | jq

# End session
curl -s -X DELETE http://localhost:3000/sessions/{SESSION_ID}
```

## API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/sessions` | Create a session. Body: `{ userId, provider?, model?, voice?, instructions? }` |
| `POST` | `/sessions/:id/messages` | Send a text message. Body: `{ text }` |
| `GET` | `/sessions/:id` | Get session state + tasks |
| `GET` | `/sessions/:id/events` | Query domain events. Params: `?since=&types=&limit=` |
| `DELETE` | `/sessions/:id` | End a session |

## Packages

### `@voice-orchestrator/core`

Domain types, file-backed stores, policies, and the specialist runner interface.

- **Domain**: `SessionRecord`, `TaskRecord`, `ArtifactRecord`, `SummaryRecord`, `DomainEvent` union
- **Stores**: `FileSessionStore`, `FileTaskStore`, `FileArtifactStore`, `FileSummaryStore`, `FileEventLog`
- **Policies**: `classifyIntent()` (heuristic), `routeNotification()` (speak/wait/suppress)
- **Specialists**: `SpecialistRunner` interface for task execution

### `@voice-orchestrator/realtime`

Transport abstraction and provider implementations.

- **`RealtimeTransport`** — provider-agnostic interface for voice interaction
- **`MiniMaxCompositeTransport`** — composes MiniMax Chat API + TTS WebSocket
- **`OpenAIWebSocketTransport`** — OpenAI Realtime API over WebSocket

### `@voice-orchestrator/server`

HTTP server, orchestrator, and tools.

- **`MerlinOrchestrator`** — core event loop: turn tracking, barge-in, function call routing, task delegation
- **`createHttpServer()`** — REST API with auto provider detection
- **Browser console** — static client with continuous mic capture, streamed playback, transcript view, and task cards
- **`DELEGATE_TASK_TOOL`** — function definition for the LLM to delegate tasks

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MINIMAX_API_KEY` | One of these | — | MiniMax API key (preferred) |
| `OPENAI_API_KEY` | is required | — | OpenAI API key (fallback) |
| `PORT` | No | `3000` | HTTP server port |
| `DATA_DIR` | No | `./data` | Directory for file-backed stores |

## Development

```bash
npm run build          # Build all packages (tsgo)
npm run check          # Biome lint + TypeScript type check
npm run dev            # Watch mode for all packages (concurrent)
npm start              # Run the server
```

### Code Style

- Biome formatter: tabs, 120 char line width
- TypeScript strict mode, ES2022 target, Node16 module resolution
- All imports use `.js` extensions (ES modules)

## Roadmap

- [x] **Phase 1**: Core domain, stores, monorepo scaffolding
- [x] **Phase 2**: Realtime hot path (orchestrator, transports, HTTP API)
- [ ] **Phase 3**: Task delegation (TaskManager, BuilderSpecialist via pi-agent-core)
- [ ] **Phase 4**: Memory & resilience (summaries, reconnection, retry)
- [x] **Phase 5a**: Web UI (session socket bridge, task cards, transcript view)
- [ ] **Phase 5b**: Direct browser WebRTC transport
