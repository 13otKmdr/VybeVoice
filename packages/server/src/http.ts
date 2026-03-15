import type { DomainEvent } from "@voice-orchestrator/core";
import {
	MiniMaxCompositeTransport,
	OpenAIWebSocketTransport,
	type RealtimeTransport,
} from "@voice-orchestrator/realtime";
import { readFile } from "fs/promises";
import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from "http";
import { extname, join } from "path";
import type { Duplex } from "stream";
import { fileURLToPath } from "url";
import { WebSocket, WebSocketServer } from "ws";
import type { OrchestratorContext } from "./main.js";
import { MerlinOrchestrator } from "./orchestrator.js";

// ── Types ────────────────────────────────────────────────────────────────────

type VoiceProvider = "minimax" | "openai";

type ClientSocketMessage =
	| { type: "audio.append"; audio: string }
	| { type: "audio.commit" }
	| { type: "response.cancel" }
	| { type: "text.send"; text: string }
	| { type: "session.update"; instructions?: string; voice?: string };

interface ActiveSession {
	orchestrator: MerlinOrchestrator;
	transport: RealtimeTransport;
	provider: VoiceProvider;
}

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));
const PUBLIC_FILES = new Map<string, string>([
	["/", "index.html"],
	["/app.js", "app.js"],
	["/favicon.svg", "favicon.svg"],
	["/mic-worklet.js", "mic-worklet.js"],
	["/styles.css", "styles.css"],
]);

const CONTENT_TYPES: Record<string, string> = {
	".css": "text/css; charset=utf-8",
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".svg": "image/svg+xml",
};

function resolveProvider(requested?: VoiceProvider): { provider: VoiceProvider; apiKey: string } {
	if (requested === "minimax") {
		const apiKey = process.env.MINIMAX_API_KEY;
		if (!apiKey) {
			throw new Error("MINIMAX_API_KEY is not set.");
		}
		return { provider: "minimax", apiKey };
	}

	if (requested === "openai") {
		const apiKey = process.env.OPENAI_API_KEY;
		if (!apiKey) {
			throw new Error("OPENAI_API_KEY is not set.");
		}
		return { provider: "openai", apiKey };
	}

	const minimaxKey = process.env.MINIMAX_API_KEY;
	if (minimaxKey) return { provider: "minimax", apiKey: minimaxKey };

	const openaiKey = process.env.OPENAI_API_KEY;
	if (openaiKey) return { provider: "openai", apiKey: openaiKey };

	throw new Error('No API key set. Provide MINIMAX_API_KEY or OPENAI_API_KEY, or request provider: "openai".');
}

function createTransport(provider: VoiceProvider): RealtimeTransport {
	switch (provider) {
		case "minimax":
			return new MiniMaxCompositeTransport();
		case "openai":
			return new OpenAIWebSocketTransport();
	}
}

// ── Server ───────────────────────────────────────────────────────────────────

export function createHttpServer(ctx: OrchestratorContext, port: number): HttpServer {
	const sessions = new Map<string, ActiveSession>();

	ctx.eventLog.subscribe((event) => {
		if (event.type === "session.ended") {
			sessions.delete(event.sessionId);
		}
	});

	const server = createServer(async (req, res) => {
		try {
			await handleRequest(req, res, ctx, sessions);
		} catch (err) {
			console.error("[http] Unhandled error:", err);
			sendJson(res, 500, { error: "Internal server error" });
		}
	});

	attachSessionSocketServer(server, ctx, sessions);

	server.listen(port, () => {
		console.log(`  HTTP server: http://localhost:${port}`);
	});

	return server;
}

// ── Router ───────────────────────────────────────────────────────────────────

async function handleRequest(
	req: IncomingMessage,
	res: ServerResponse,
	ctx: OrchestratorContext,
	sessions: Map<string, ActiveSession>,
): Promise<void> {
	const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
	const segments = url.pathname.split("/").filter(Boolean);

	// GET /sessions (list all)
	if (req.method === "GET" && segments.length === 1 && segments[0] === "sessions") {
		return handleListSessions(res, ctx);
	}

	// POST /sessions
	if (req.method === "POST" && segments.length === 1 && segments[0] === "sessions") {
		return handleCreateSession(req, res, ctx, sessions);
	}

	// POST /sessions/:id/messages
	if (req.method === "POST" && segments.length === 3 && segments[0] === "sessions" && segments[2] === "messages") {
		return handleSendMessage(req, res, sessions, segments[1]);
	}

	// GET /sessions/:id
	if (req.method === "GET" && segments.length === 2 && segments[0] === "sessions") {
		return handleGetSession(res, ctx, sessions, segments[1]);
	}

	// GET /sessions/:id/events
	if (req.method === "GET" && segments.length === 3 && segments[0] === "sessions" && segments[2] === "events") {
		return handleGetEvents(res, ctx, url, segments[1]);
	}

	// DELETE /sessions/:id
	if (req.method === "DELETE" && segments.length === 2 && segments[0] === "sessions") {
		return handleDeleteSession(res, sessions, segments[1]);
	}

	if (req.method === "GET" && (await tryServeStaticAsset(res, url.pathname))) {
		return;
	}

	sendJson(res, 404, { error: "Not found" });
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async function handleListSessions(res: ServerResponse, ctx: OrchestratorContext): Promise<void> {
	const sessions = await ctx.sessionStore.listAll();
	sendJson(res, 200, { sessions });
}

async function handleCreateSession(
	req: IncomingMessage,
	res: ServerResponse,
	ctx: OrchestratorContext,
	sessions: Map<string, ActiveSession>,
): Promise<void> {
	const body = await readJson<{
		userId?: string;
		model?: string;
		provider?: VoiceProvider;
		voice?: string;
		instructions?: string;
	}>(req);

	if (!body.userId) {
		return sendJson(res, 400, { error: "userId is required" });
	}

	let resolved: { provider: VoiceProvider; apiKey: string };
	try {
		resolved = resolveProvider(body.provider);
	} catch (err) {
		return sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
	}

	const transport = createTransport(resolved.provider);
	const orchestrator = new MerlinOrchestrator(transport, ctx);

	const defaultModel = resolved.provider === "minimax" ? "MiniMax-M2.5" : "gpt-realtime";
	const defaultVoice = resolved.provider === "minimax" ? "English_Graceful_Lady" : "marin";

	try {
		const session = await orchestrator.startSession({
			userId: body.userId,
			model: body.model ?? defaultModel,
			voice: body.voice ?? defaultVoice,
			instructions: body.instructions,
			apiKey: resolved.apiKey,
		});

		sessions.set(session.id, { orchestrator, transport, provider: resolved.provider });

		console.log(`[http] Session created: ${session.id} (provider: ${resolved.provider})`);
		sendJson(res, 201, { session, provider: resolved.provider });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error("[http] Failed to create session:", message);
		sendJson(res, 500, { error: `Failed to create session: ${message}` });
	}
}

async function handleSendMessage(
	req: IncomingMessage,
	res: ServerResponse,
	sessions: Map<string, ActiveSession>,
	sessionId: string,
): Promise<void> {
	const active = sessions.get(sessionId);
	if (!active) {
		return sendJson(res, 404, { error: "Session not found" });
	}

	const body = await readJson<{ text?: string }>(req);
	if (!body.text) {
		return sendJson(res, 400, { error: "text is required" });
	}

	try {
		await active.orchestrator.sendMessage(body.text);
		sendJson(res, 200, { ok: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		sendJson(res, 500, { error: message });
	}
}

async function handleGetSession(
	res: ServerResponse,
	ctx: OrchestratorContext,
	sessions: Map<string, ActiveSession>,
	sessionId: string,
): Promise<void> {
	const session = await ctx.sessionStore.get(sessionId);
	if (!session) {
		return sendJson(res, 404, { error: "Session not found" });
	}

	const tasks = await ctx.taskStore.findBySession(sessionId);
	const active = sessions.get(sessionId);

	sendJson(res, 200, {
		session,
		tasks,
		isConnected: Boolean(active),
		provider: active?.provider,
	});
}

async function handleGetEvents(
	res: ServerResponse,
	ctx: OrchestratorContext,
	url: URL,
	sessionId: string,
): Promise<void> {
	const since = url.searchParams.get("since");
	const typesParam = url.searchParams.get("types");
	const limitParam = url.searchParams.get("limit");

	const events = await ctx.eventLog.query({
		sessionId,
		since: since ? Number(since) : undefined,
		types: typesParam ? (typesParam.split(",") as DomainEvent["type"][]) : undefined,
		limit: limitParam ? Number(limitParam) : undefined,
	});

	sendJson(res, 200, { events });
}

async function handleDeleteSession(
	res: ServerResponse,
	sessions: Map<string, ActiveSession>,
	sessionId: string,
): Promise<void> {
	const active = sessions.get(sessionId);
	if (!active) {
		return sendJson(res, 200, { ok: true, alreadyClosed: true });
	}

	try {
		await active.orchestrator.endSession("user");
		sessions.delete(sessionId);
		sendJson(res, 200, { ok: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		sendJson(res, 500, { error: message });
	}
}

// ── WebSocket bridge ─────────────────────────────────────────────────────────

function attachSessionSocketServer(
	server: HttpServer,
	ctx: OrchestratorContext,
	sessions: Map<string, ActiveSession>,
): void {
	const wss = new WebSocketServer({ noServer: true });

	server.on("upgrade", (req, socket, head) => {
		const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
		const segments = url.pathname.split("/").filter(Boolean);

		if (!(segments.length === 3 && segments[0] === "sessions" && segments[2] === "socket")) {
			rejectUpgrade(socket, 404, "Not found");
			return;
		}

		const sessionId = segments[1];
		if (!sessions.has(sessionId)) {
			rejectUpgrade(socket, 404, "Session not found");
			return;
		}

		wss.handleUpgrade(req, socket, head, (ws) => {
			void handleSessionSocketConnection(ws, ctx, sessions, sessionId);
		});
	});
}

async function handleSessionSocketConnection(
	ws: WebSocket,
	ctx: OrchestratorContext,
	sessions: Map<string, ActiveSession>,
	sessionId: string,
): Promise<void> {
	const active = sessions.get(sessionId);
	if (!active) {
		ws.close(4404, "Session not found");
		return;
	}

	const unsubscribeTransport = active.transport.onEvent((event) => {
		sendSocketJson(ws, { type: "realtime.event", event });
	});

	const unsubscribeDomain = ctx.eventLog.subscribe((event) => {
		void forwardDomainEvent(ws, ctx, sessionId, event);
	});

	ws.on("message", (data) => {
		void handleClientSocketMessage(ws, data.toString(), active);
	});

	ws.on("close", () => {
		unsubscribeTransport();
		unsubscribeDomain();
	});

	ws.on("error", (err) => {
		console.error(`[http] Session socket error (${sessionId}):`, err);
	});

	const session = await ctx.sessionStore.get(sessionId);
	const tasks = await ctx.taskStore.findBySession(sessionId);
	const events = await ctx.eventLog.query({ sessionId, limit: 50 });

	sendSocketJson(ws, {
		type: "session.snapshot",
		session,
		tasks,
		events,
		provider: active.provider,
	});
}

async function handleClientSocketMessage(ws: WebSocket, raw: string, active: ActiveSession): Promise<void> {
	let message: ClientSocketMessage;
	try {
		message = JSON.parse(raw) as ClientSocketMessage;
	} catch {
		sendSocketJson(ws, { type: "error", message: "Invalid JSON payload." });
		return;
	}

	try {
		switch (message.type) {
			case "audio.append": {
				if (active.provider !== "openai") {
					sendSocketJson(ws, {
						type: "error",
						message: "Live microphone streaming is only supported with the OpenAI provider.",
					});
					return;
				}

				const buffer = Buffer.from(message.audio, "base64");
				const chunk = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
				active.transport.sendAudioChunk(chunk);
				return;
			}

			case "audio.commit":
				active.transport.commitAudioBuffer();
				return;

			case "response.cancel":
				active.transport.interrupt();
				return;

			case "text.send":
				if (!message.text.trim()) return;
				await active.orchestrator.sendMessage(message.text);
				return;

			case "session.update":
				active.transport.updateSession({
					instructions: message.instructions,
					voice: message.voice,
				});
				return;
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		sendSocketJson(ws, { type: "error", message });
	}
}

// ── Utilities ────────────────────────────────────────────────────────────────

function sendJson(res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(body));
}

function sendSocketJson(ws: WebSocket, body: unknown): void {
	if (ws.readyState !== WebSocket.OPEN) return;
	ws.send(JSON.stringify(body));
}

async function tryServeStaticAsset(res: ServerResponse, pathname: string): Promise<boolean> {
	const relativePath = PUBLIC_FILES.get(pathname);
	if (!relativePath) {
		return false;
	}

	try {
		const filePath = join(PUBLIC_DIR, relativePath);
		const contents = await readFile(filePath);
		const contentType = CONTENT_TYPES[extname(relativePath)] ?? "application/octet-stream";
		res.writeHead(200, { "Content-Type": contentType });
		res.end(contents);
		return true;
	} catch (err) {
		console.error(`[http] Failed to serve static asset ${relativePath}:`, err);
		sendJson(res, 500, { error: "Failed to load web client" });
		return true;
	}
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
	socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
	socket.destroy();
}

async function forwardDomainEvent(
	ws: WebSocket,
	ctx: OrchestratorContext,
	sessionId: string,
	event: DomainEvent,
): Promise<void> {
	if (await eventBelongsToSession(ctx, event, sessionId)) {
		sendSocketJson(ws, { type: "domain.event", event });
	}
}

async function eventBelongsToSession(
	ctx: OrchestratorContext,
	event: DomainEvent,
	sessionId: string,
): Promise<boolean> {
	if ("sessionId" in event) return event.sessionId === sessionId;
	if ("session" in event) return event.session.id === sessionId;
	if ("task" in event) return event.task.sessionId === sessionId;
	if ("taskId" in event) {
		const task = await ctx.taskStore.get(event.taskId);
		return task?.sessionId === sessionId;
	}
	return false;
}

async function readBody(req: IncomingMessage): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
	}
	return Buffer.concat(chunks).toString("utf-8");
}

async function readJson<T = Record<string, unknown>>(req: IncomingMessage): Promise<T> {
	const body = await readBody(req);
	if (!body) return {} as T;
	return JSON.parse(body) as T;
}
