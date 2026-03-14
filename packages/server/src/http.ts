import { OpenAIWebSocketTransport } from "@voice-orchestrator/realtime";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import type { OrchestratorContext } from "./main.js";
import { MerlinOrchestrator } from "./orchestrator.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface ActiveSession {
	orchestrator: MerlinOrchestrator;
	transport: OpenAIWebSocketTransport;
}

// ── Server ───────────────────────────────────────────────────────────────────

export function createHttpServer(ctx: OrchestratorContext, port: number): ReturnType<typeof createServer> {
	const sessions = new Map<string, ActiveSession>();

	const server = createServer(async (req, res) => {
		try {
			await handleRequest(req, res, ctx, sessions);
		} catch (err) {
			console.error("[http] Unhandled error:", err);
			sendJson(res, 500, { error: "Internal server error" });
		}
	});

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
	const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
	const segments = url.pathname.split("/").filter(Boolean);

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

	sendJson(res, 404, { error: "Not found" });
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async function handleCreateSession(
	req: IncomingMessage,
	res: ServerResponse,
	ctx: OrchestratorContext,
	sessions: Map<string, ActiveSession>,
): Promise<void> {
	const body = await readJson<{ userId?: string; model?: string; voice?: string; instructions?: string }>(req);

	if (!body.userId) {
		return sendJson(res, 400, { error: "userId is required" });
	}

	const apiKey = process.env.OPENAI_API_KEY;
	if (!apiKey) {
		return sendJson(res, 500, { error: "OPENAI_API_KEY environment variable is not set" });
	}

	const transport = new OpenAIWebSocketTransport();
	const orchestrator = new MerlinOrchestrator(transport, ctx);

	try {
		const session = await orchestrator.startSession({
			userId: body.userId,
			model: body.model,
			voice: body.voice,
			instructions: body.instructions,
		});

		sessions.set(session.id, { orchestrator, transport });

		sendJson(res, 201, { session });
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
	const isConnected = sessions.has(sessionId);

	sendJson(res, 200, { session, tasks, isConnected });
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
		types: typesParam ? (typesParam.split(",") as any) : undefined,
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
		return sendJson(res, 404, { error: "Session not found" });
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

// ── Utilities ────────────────────────────────────────────────────────────────

function sendJson(res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(body));
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
