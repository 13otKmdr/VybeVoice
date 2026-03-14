// ── Config ────────────────────────────────────────────────────────────────────

export interface RealtimeConfig {
	model: string;
	apiKey: string;
	instructions?: string;
	voice?: string;
	inputAudioFormat?: "pcm16" | "g711_ulaw" | "g711_alaw";
	outputAudioFormat?: "pcm16" | "g711_ulaw" | "g711_alaw";
	turnDetection?: TurnDetectionConfig | null;
	tools?: RealtimeTool[];
}

export interface TurnDetectionConfig {
	type: "server_vad" | "semantic_vad" | "none";
	threshold?: number;
	prefix_padding_ms?: number;
	silence_duration_ms?: number;
	eagerness?: "low" | "medium" | "high";
}

export interface RealtimeTool {
	type: "function";
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}

// ── Events from realtime service ─────────────────────────────────────────────

export type RealtimeEvent =
	| { type: "session.created"; sessionId: string }
	| { type: "session.updated" }
	| { type: "input_audio_buffer.speech_started" }
	| { type: "input_audio_buffer.speech_stopped" }
	| { type: "input_audio_buffer.committed" }
	| { type: "conversation.item.input_audio_transcription.completed"; transcript: string }
	| { type: "response.audio.delta"; delta: string }
	| { type: "response.audio.done" }
	| { type: "response.text.delta"; delta: string }
	| { type: "response.text.done"; text: string }
	| { type: "response.function_call_arguments.delta"; callId: string; name: string; delta: string }
	| { type: "response.function_call_arguments.done"; callId: string; name: string; arguments: string }
	| { type: "response.done"; responseId?: string; status?: "completed" | "cancelled" | "failed" }
	| { type: "error"; code: string; message: string }
	| { type: "connection.closed"; code: number; reason: string };

// ── Transport abstraction ────────────────────────────────────────────────────

export type TransportState = "disconnected" | "connecting" | "connected" | "error";

export interface RealtimeTransport {
	connect(config: RealtimeConfig): Promise<void>;
	disconnect(): Promise<void>;
	sendText(text: string): void;
	sendAudioChunk(chunk: ArrayBuffer): void;
	interrupt(): void;
	commitAudioBuffer(): void;
	sendFunctionCallOutput(callId: string, output: string): void;
	updateSession(config: Partial<RealtimeConfig>): void;
	onEvent(handler: (event: RealtimeEvent) => void): () => void;
	readonly state: TransportState;
}
