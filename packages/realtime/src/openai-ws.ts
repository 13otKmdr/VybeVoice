import WebSocket from "ws";
import type { RealtimeConfig, RealtimeEvent, RealtimeTransport, TransportState } from "./transport.js";

const OPENAI_REALTIME_URL = "wss://api.openai.com/v1/realtime";

export class OpenAIWebSocketTransport implements RealtimeTransport {
	private ws: WebSocket | null = null;
	private listeners = new Set<(event: RealtimeEvent) => void>();
	private _state: TransportState = "disconnected";

	get state(): TransportState {
		return this._state;
	}

	async connect(config: RealtimeConfig): Promise<void> {
		if (this.ws) {
			await this.disconnect();
		}

		this._state = "connecting";

		return new Promise((resolve, reject) => {
			const url = `${OPENAI_REALTIME_URL}?model=${encodeURIComponent(config.model)}`;
			this.ws = new WebSocket(url, {
				headers: {
					Authorization: `Bearer ${config.apiKey}`,
					"OpenAI-Beta": "realtime=v1",
				},
			});

			this.ws.on("open", () => {
				this._state = "connected";
				this.sendSessionUpdate(config);
				resolve();
			});

			this.ws.on("message", (data) => {
				this.handleMessage(data);
			});

			this.ws.on("close", (code, reason) => {
				this._state = "disconnected";
				this.emit({ type: "connection.closed", code, reason: reason.toString() });
			});

			this.ws.on("error", (err) => {
				this._state = "error";
				if (this.ws?.readyState !== WebSocket.OPEN) {
					reject(err);
				}
				this.emit({ type: "error", code: "websocket_error", message: err.message });
			});
		});
	}

	async disconnect(): Promise<void> {
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
		this._state = "disconnected";
	}

	sendText(text: string): void {
		this.send({
			type: "conversation.item.create",
			item: {
				type: "message",
				role: "user",
				content: [{ type: "input_text", text }],
			},
		});
		this.send({ type: "response.create" });
	}

	sendAudioChunk(chunk: ArrayBuffer): void {
		const base64 = Buffer.from(chunk).toString("base64");
		this.send({
			type: "input_audio_buffer.append",
			audio: base64,
		});
	}

	interrupt(): void {
		this.send({ type: "response.cancel" });
	}

	commitAudioBuffer(): void {
		this.send({ type: "input_audio_buffer.commit" });
	}

	sendFunctionCallOutput(callId: string, output: string): void {
		this.send({
			type: "conversation.item.create",
			item: {
				type: "function_call_output",
				call_id: callId,
				output,
			},
		});
		this.send({ type: "response.create" });
	}

	updateSession(config: Partial<RealtimeConfig>): void {
		this.sendSessionUpdate(config);
	}

	onEvent(handler: (event: RealtimeEvent) => void): () => void {
		this.listeners.add(handler);
		return () => this.listeners.delete(handler);
	}

	private send(data: Record<string, unknown>): void {
		if (this.ws?.readyState !== WebSocket.OPEN) {
			throw new Error(`WebSocket not connected (state: ${this._state})`);
		}
		this.ws.send(JSON.stringify(data));
	}

	private emit(event: RealtimeEvent): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}

	private sendSessionUpdate(config: Partial<RealtimeConfig>): void {
		const session: Record<string, unknown> = {};

		if (config.instructions) session.instructions = config.instructions;
		if (config.voice) session.voice = config.voice;
		if (config.inputAudioFormat) session.input_audio_format = config.inputAudioFormat;
		if (config.outputAudioFormat) session.output_audio_format = config.outputAudioFormat;
		if (config.turnDetection !== undefined) session.turn_detection = config.turnDetection;

		if (config.tools) {
			session.tools = config.tools;
		}

		session.input_audio_transcription = { model: "whisper-1" };

		this.send({ type: "session.update", session });
	}

	private handleMessage(data: WebSocket.RawData): void {
		let msg: any;
		try {
			msg = JSON.parse(data.toString());
		} catch {
			return;
		}

		const event = this.mapServerEvent(msg);
		if (event) {
			this.emit(event);
		}
	}

	private mapServerEvent(msg: any): RealtimeEvent | null {
		switch (msg.type) {
			case "session.created":
				return { type: "session.created", sessionId: msg.session?.id ?? "" };

			case "session.updated":
				return { type: "session.updated" };

			case "input_audio_buffer.speech_started":
				return { type: "input_audio_buffer.speech_started" };

			case "input_audio_buffer.speech_stopped":
				return { type: "input_audio_buffer.speech_stopped" };

			case "input_audio_buffer.committed":
				return { type: "input_audio_buffer.committed" };

			case "conversation.item.input_audio_transcription.completed":
				return {
					type: "conversation.item.input_audio_transcription.completed",
					transcript: msg.transcript ?? "",
				};

			case "response.audio.delta":
				return { type: "response.audio.delta", delta: msg.delta ?? "" };

			case "response.audio.done":
				return { type: "response.audio.done" };

			case "response.text.delta":
				return { type: "response.text.delta", delta: msg.delta ?? "" };

			case "response.text.done":
				return { type: "response.text.done", text: msg.text ?? "" };

			case "response.function_call_arguments.delta":
				return {
					type: "response.function_call_arguments.delta",
					callId: msg.call_id ?? "",
					name: msg.name ?? "",
					delta: msg.delta ?? "",
				};

			case "response.function_call_arguments.done":
				return {
					type: "response.function_call_arguments.done",
					callId: msg.call_id ?? "",
					name: msg.name ?? "",
					arguments: msg.arguments ?? "",
				};

			case "response.done":
				return {
					type: "response.done",
					responseId: msg.response?.id,
					status: msg.response?.status ?? "completed",
				};

			case "error":
				return { type: "error", code: msg.error?.code ?? "unknown", message: msg.error?.message ?? "" };

			// GA API event name aliases — normalize to existing union types
			case "response.output_audio.delta":
				return { type: "response.audio.delta", delta: msg.delta ?? "" };
			case "response.output_text.delta":
				return { type: "response.text.delta", delta: msg.delta ?? "" };
			case "input_audio_transcription.final":
				return {
					type: "conversation.item.input_audio_transcription.completed",
					transcript: msg.content ?? msg.transcript ?? "",
				};

			default:
				return null;
		}
	}
}
