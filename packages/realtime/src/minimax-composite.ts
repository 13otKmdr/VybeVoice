import { MiniMaxChatClient, type MiniMaxChatTool } from "./minimax-chat.js";
import { MiniMaxTTSClient } from "./minimax-tts.js";
import type { RealtimeConfig, RealtimeEvent, RealtimeTool, RealtimeTransport, TransportState } from "./transport.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Finds the last sentence-ending boundary (.!? followed by space/end) in text. */
function findLastSentenceBoundary(text: string): number {
	let lastIndex = -1;
	const regex = /[.!?。！？]\s+/g;
	for (let match = regex.exec(text); match !== null; match = regex.exec(text)) {
		lastIndex = match.index + match[0].length;
	}
	return lastIndex;
}

/** Convert a RealtimeTool (flat) to OpenAI Chat format (nested under `function`). */
function convertTool(tool: RealtimeTool): MiniMaxChatTool {
	return {
		type: "function",
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
		},
	};
}

// ── Composite Transport ─────────────────────────────────────────────────────

/**
 * MiniMax composite transport — combines the MiniMax Chat API (LLM + function calling)
 * with MiniMax TTS WebSocket to implement the full RealtimeTransport interface.
 *
 * Flow: sendText(text) → Chat API (streaming SSE) → sentence chunking → TTS WebSocket → audio events
 *
 * Unlike OpenAI's all-in-one Realtime API, MiniMax requires composing three services:
 * - LLM: Chat Completion API (OpenAI-compatible, with function calling)
 * - TTS: WebSocket streaming text-to-speech
 * - STT: Not yet implemented (text input only for now)
 */
export class MiniMaxCompositeTransport implements RealtimeTransport {
	private tts = new MiniMaxTTSClient();
	private chat = new MiniMaxChatClient();
	private listeners = new Set<(event: RealtimeEvent) => void>();
	private _state: TransportState = "disconnected";
	private textBuffer = "";
	private responseText = "";
	private pendingToolCalls = new Map<string, { resolve: () => void }>();
	private toolCallPromises: Promise<void>[] = [];

	get state(): TransportState {
		return this._state;
	}

	async connect(config: RealtimeConfig): Promise<void> {
		this._state = "connecting";

		try {
			// Configure LLM chat client
			this.chat.configure({
				apiKey: config.apiKey,
				model: config.model || "MiniMax-M2.5",
				systemPrompt: config.instructions,
				tools: config.tools?.map(convertTool) ?? [],
				temperature: 0.7,
				maxTokens: 2048,
			});

			// Connect TTS WebSocket
			await this.tts.connect({
				apiKey: config.apiKey,
				model: "speech-2.8-turbo",
				voiceId: config.voice ?? "English_Graceful_Lady",
				sampleRate: 24000,
				format: "mp3",
			});

			// Forward TTS events
			this.tts.onEvent((event) => {
				switch (event.type) {
					case "audio":
						this.emit({ type: "response.audio.delta", delta: event.audio });
						break;
					case "audio_done":
						this.emit({ type: "response.audio.done" });
						break;
					case "error":
						this.emit({ type: "error", code: "tts_error", message: event.message });
						break;
					case "closed":
						if (this._state === "connected") {
							this._state = "disconnected";
							this.emit({ type: "connection.closed", code: 1000, reason: "TTS connection closed" });
						}
						break;
				}
			});

			this._state = "connected";
			this.emit({ type: "session.created", sessionId: `minimax_${Date.now()}` });
		} catch (err) {
			this._state = "error";
			throw err;
		}
	}

	async disconnect(): Promise<void> {
		this.chat.abort();
		await this.tts.disconnect();
		this._state = "disconnected";
	}

	sendText(text: string): void {
		if (this._state !== "connected") {
			throw new Error(`Transport not connected (state: ${this._state})`);
		}

		// Emit transcription event (mirrors what OpenAI does for audio input)
		this.emit({
			type: "conversation.item.input_audio_transcription.completed",
			transcript: text,
		});

		// Process through chat + TTS pipeline (fire-and-forget, errors emitted as events)
		this.processMessage(text).catch((err) => {
			this.emit({
				type: "error",
				code: "pipeline_error",
				message: err instanceof Error ? err.message : String(err),
			});
		});
	}

	sendAudioChunk(_chunk: ArrayBuffer): void {
		// STT not yet implemented — audio input requires Deepgram, Whisper, or similar
		console.warn("[minimax-composite] Audio input not yet supported — use sendText()");
	}

	interrupt(): void {
		this.chat.abort();
		this.tts.finishTask();
		this.textBuffer = "";
		this.responseText = "";
		this.emit({ type: "response.done", status: "cancelled" });
	}

	commitAudioBuffer(): void {
		// No-op: STT not implemented
	}

	sendFunctionCallOutput(callId: string, output: string): void {
		this.chat.addToolResult(callId, output);

		// Resolve the pending tool call promise so the pipeline can continue
		const pending = this.pendingToolCalls.get(callId);
		if (pending) {
			pending.resolve();
			this.pendingToolCalls.delete(callId);
		}
	}

	updateSession(_config: Partial<RealtimeConfig>): void {
		// Reconfiguration mid-session is not supported for composite transport.
		// The chat and TTS clients are configured once at connect().
		console.warn("[minimax-composite] updateSession is not supported mid-session");
	}

	onEvent(handler: (event: RealtimeEvent) => void): () => void {
		this.listeners.add(handler);
		return () => this.listeners.delete(handler);
	}

	// ── Internal pipeline ─────────────────────────────────────────────────────

	private emit(event: RealtimeEvent): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}

	private async processMessage(text: string): Promise<void> {
		this.chat.addUserMessage(text);
		this.responseText = "";
		await this.runChatAndTTS();
	}

	/**
	 * Streams a chat completion, pipes text to TTS at sentence boundaries,
	 * and handles function calls by waiting for tool results and recursing.
	 */
	private async runChatAndTTS(): Promise<void> {
		this.textBuffer = "";
		this.toolCallPromises = [];
		let hasToolCalls = false;
		let ttsTaskStarted = false;

		for await (const event of this.chat.stream()) {
			switch (event.type) {
				case "text_delta": {
					// Emit text event for the orchestrator
					this.emit({ type: "response.text.delta", delta: event.content });
					this.responseText += event.content;
					this.textBuffer += event.content;

					// Start TTS task lazily on first text
					if (!ttsTaskStarted) {
						await this.tts.startTask();
						ttsTaskStarted = true;
					}

					// Flush complete sentences to TTS for low-latency audio
					const boundary = findLastSentenceBoundary(this.textBuffer);
					if (boundary > 0) {
						const toSpeak = this.textBuffer.substring(0, boundary);
						this.textBuffer = this.textBuffer.substring(boundary);
						this.tts.sendText(toSpeak);
					}
					break;
				}

				case "tool_call_done": {
					hasToolCalls = true;

					// Create a promise that resolves when sendFunctionCallOutput() is called
					const promise = new Promise<void>((resolve) => {
						this.pendingToolCalls.set(event.id, { resolve });
					});
					this.toolCallPromises.push(promise);

					this.emit({
						type: "response.function_call_arguments.done",
						callId: event.id,
						name: event.name,
						arguments: event.arguments,
					});
					break;
				}

				case "tool_call_delta":
					this.emit({
						type: "response.function_call_arguments.delta",
						callId: event.id,
						name: "",
						delta: event.arguments,
					});
					break;

				case "error":
					this.emit({ type: "error", code: "chat_error", message: event.message });
					break;

				case "done": {
					// Flush remaining text to TTS
					if (this.textBuffer.trim()) {
						if (!ttsTaskStarted) {
							await this.tts.startTask();
							ttsTaskStarted = true;
						}
						this.tts.sendText(this.textBuffer);
						this.textBuffer = "";
					}

					break;
				}
			}
		}

		// Finish TTS task if one was started
		if (ttsTaskStarted) {
			this.tts.finishTask();
		}

		// If there were tool calls, wait for all results then continue the conversation
		if (hasToolCalls) {
			await Promise.all(this.toolCallPromises);
			this.toolCallPromises = [];
			await this.runChatAndTTS();
		} else {
			this.emit({ type: "response.text.done", text: this.responseText });
			this.emit({ type: "response.done", status: "completed" });
		}
	}
}
