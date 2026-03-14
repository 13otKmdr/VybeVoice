import {
	classifyIntent,
	type DomainEvent,
	generateId,
	type SessionRecord,
	type TaskRecord,
} from "@voice-orchestrator/core";
import type { RealtimeConfig, RealtimeEvent, RealtimeTransport } from "@voice-orchestrator/realtime";
import type { OrchestratorContext } from "./main.js";
import { DELEGATE_TASK_TOOL, MERLIN_SYSTEM_PROMPT, parseDelegateTaskArgs } from "./tools.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SessionOptions {
	userId: string;
	model?: string;
	voice?: string;
	instructions?: string;
	apiKey?: string;
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

export class MerlinOrchestrator {
	private transport: RealtimeTransport;
	private ctx: OrchestratorContext;
	private session: SessionRecord | null = null;
	private isAssistantSpeaking = false;
	private currentTurnId: string | null = null;
	private unsubscribe: (() => void) | null = null;

	constructor(transport: RealtimeTransport, ctx: OrchestratorContext) {
		this.transport = transport;
		this.ctx = ctx;
	}

	getSession(): SessionRecord | null {
		return this.session;
	}

	// ── Session lifecycle ────────────────────────────────────────────────────

	async startSession(options: SessionOptions): Promise<SessionRecord> {
		const now = Date.now();
		const session: SessionRecord = {
			id: generateId("sess"),
			userId: options.userId,
			startedAt: now,
			lastActiveAt: now,
			state: "active",
			metadata: {},
		};

		await this.ctx.sessionStore.save(session);
		this.session = session;

		const instructions = options.instructions
			? `${MERLIN_SYSTEM_PROMPT}\n\n${options.instructions}`
			: MERLIN_SYSTEM_PROMPT;

		const config: RealtimeConfig = {
			model: options.model ?? "gpt-4o-realtime-preview",
			apiKey: options.apiKey ?? process.env.MINIMAX_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
			instructions,
			voice: options.voice ?? "alloy",
			turnDetection: {
				type: "server_vad",
				threshold: 0.5,
				silence_duration_ms: 500,
			},
			tools: [DELEGATE_TASK_TOOL],
		};

		this.unsubscribe = this.transport.onEvent((event) => this.handleRealtimeEvent(event));

		await this.transport.connect(config);

		await this.emitEvent({
			type: "session.started",
			session,
		});

		return session;
	}

	async endSession(reason: "user" | "timeout" | "error" = "user"): Promise<void> {
		if (!this.session) return;

		if (this.unsubscribe) {
			this.unsubscribe();
			this.unsubscribe = null;
		}

		try {
			await this.transport.disconnect();
		} catch {
			// Ignore disconnect errors
		}

		this.session.state = "ended";
		await this.ctx.sessionStore.save(this.session);

		await this.emitEvent({
			type: "session.ended",
			sessionId: this.session.id,
			reason,
		});

		this.session = null;
		this.isAssistantSpeaking = false;
		this.currentTurnId = null;
	}

	// ── Message sending ──────────────────────────────────────────────────────

	async sendMessage(text: string): Promise<void> {
		if (!this.session) {
			throw new Error("No active session");
		}

		const turnId = generateId("turn");
		this.currentTurnId = turnId;

		this.session.lastActiveAt = Date.now();
		await this.ctx.sessionStore.save(this.session);

		await this.emitEvent({
			type: "turn.started",
			sessionId: this.session.id,
			turnId,
			transcript: text,
		});

		this.transport.sendText(text);
	}

	// ── Realtime event handling ──────────────────────────────────────────────

	private handleRealtimeEvent(event: RealtimeEvent): void {
		switch (event.type) {
			case "input_audio_buffer.speech_started":
				this.handleSpeechStarted().catch((err) =>
					console.error("[orchestrator] Error handling speech started:", err),
				);
				break;

			case "conversation.item.input_audio_transcription.completed":
				this.handleTranscriptionCompleted(event.transcript).catch((err) =>
					console.error("[orchestrator] Error handling transcription:", err),
				);
				break;

			case "response.audio.delta":
			case "response.text.delta":
				this.isAssistantSpeaking = true;
				break;

			case "response.function_call_arguments.done":
				this.handleFunctionCallDone(event.callId, event.name, event.arguments).catch((err) =>
					console.error("[orchestrator] Error handling function call:", err),
				);
				break;

			case "response.done":
				this.handleResponseDone(event.status).catch((err) =>
					console.error("[orchestrator] Error handling response done:", err),
				);
				break;

			case "error":
				this.handleError(event.code, event.message).catch((err) =>
					console.error("[orchestrator] Error handling error event:", err),
				);
				break;

			case "connection.closed":
				this.handleConnectionClosed(event.code, event.reason).catch((err) =>
					console.error("[orchestrator] Error handling connection close:", err),
				);
				break;

			default:
				// session.created, session.updated, speech_stopped, committed,
				// audio.done, text.done, function_call_arguments.delta — no action needed
				break;
		}
	}

	// ── Individual event handlers ────────────────────────────────────────────

	private async handleSpeechStarted(): Promise<void> {
		if (!this.session) return;

		if (this.isAssistantSpeaking) {
			// Barge-in: user started speaking while assistant is responding
			this.transport.interrupt();
			this.isAssistantSpeaking = false;

			await this.emitEvent({
				type: "assistant.interrupted",
				sessionId: this.session.id,
			});

			console.log("[orchestrator] Barge-in detected — interrupted assistant");
		}

		// Start a new turn for audio input
		const turnId = generateId("turn");
		this.currentTurnId = turnId;

		await this.emitEvent({
			type: "turn.started",
			sessionId: this.session.id,
			turnId,
		});
	}

	private async handleTranscriptionCompleted(transcript: string): Promise<void> {
		if (!this.session) return;

		// Run heuristic intent classification for analytics/logging
		const intent = classifyIntent(transcript);

		if (this.currentTurnId) {
			await this.emitEvent({
				type: "turn.ended",
				sessionId: this.session.id,
				turnId: this.currentTurnId,
				transcript,
				intent,
			});
		}

		this.session.lastActiveAt = Date.now();
		await this.ctx.sessionStore.save(this.session);

		this.currentTurnId = null;
	}

	private async handleFunctionCallDone(callId: string, name: string, argsRaw: string): Promise<void> {
		if (name === "delegate_task") {
			await this.handleDelegateTask(callId, argsRaw);
		} else {
			// Unknown function — return error so the model can recover
			this.transport.sendFunctionCallOutput(callId, JSON.stringify({ error: `Unknown function: ${name}` }));
		}
	}

	private async handleDelegateTask(callId: string, argsRaw: string): Promise<void> {
		if (!this.session) return;

		let args: import("./tools.js").DelegateTaskArgs;
		try {
			args = parseDelegateTaskArgs(argsRaw);
		} catch (err) {
			console.error("[orchestrator] Failed to parse delegate_task args:", err);
			this.transport.sendFunctionCallOutput(callId, JSON.stringify({ error: "Failed to parse arguments" }));
			return;
		}

		const now = Date.now();
		const task: TaskRecord = {
			id: generateId("task"),
			sessionId: this.session.id,
			kind: args.kind,
			intent: args.description,
			status: "queued",
			createdAt: now,
			updatedAt: now,
			retryCount: 0,
			maxRetries: 3,
			timeoutMs: 300_000,
			metadata: { priority: args.priority ?? "normal" },
		};

		await this.ctx.taskStore.save(task);

		await this.emitEvent({
			type: "task.created",
			task,
		});

		console.log(`[orchestrator] Task created: ${task.id} (${task.kind}) — "${task.intent}"`);

		// Send result back to model so it can acknowledge naturally
		this.transport.sendFunctionCallOutput(
			callId,
			JSON.stringify({
				status: "queued",
				taskId: task.id,
				message: `Task queued for ${task.kind} specialist.`,
			}),
		);
	}

	private async handleResponseDone(status?: string): Promise<void> {
		this.isAssistantSpeaking = false;

		if (status === "cancelled") {
			console.log("[orchestrator] Response cancelled (barge-in or manual)");
		} else if (status === "failed") {
			console.error("[orchestrator] Response generation failed");
		}
	}

	private async handleConnectionClosed(code: number, reason: string): Promise<void> {
		if (!this.session || this.session.state === "ended") return;

		console.log(`[orchestrator] Connection closed: code=${code} reason=${reason}`);

		this.session.state = "disconnected";
		await this.ctx.sessionStore.save(this.session);

		await this.emitEvent({
			type: "session.ended",
			sessionId: this.session.id,
			reason: "error",
		});
	}

	private async handleError(code: string, message: string): Promise<void> {
		console.error(`[orchestrator] Realtime error: ${code} — ${message}`);

		// Fatal errors that should end the session
		const fatalCodes = ["authentication_error", "invalid_api_key", "rate_limit_exceeded"];
		if (fatalCodes.includes(code)) {
			await this.endSession("error");
		}
	}

	// ── Event emission ───────────────────────────────────────────────────────

	// Distributive Omit: applies Omit to each member of the union individually
	private async emitEvent(
		partial: DomainEvent extends infer E ? (E extends DomainEvent ? Omit<E, "eventId" | "timestamp"> : never) : never,
	): Promise<void> {
		const event = {
			...partial,
			eventId: generateId("evt"),
			timestamp: Date.now(),
		} as DomainEvent;

		await this.ctx.eventLog.append(event);
	}
}
