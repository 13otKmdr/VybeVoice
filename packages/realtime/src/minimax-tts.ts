import WebSocket from "ws";

// ── Config ────────────────────────────────────────────────────────────────────

const MINIMAX_TTS_URL = "wss://api.minimax.io/ws/v1/t2a_v2";

export interface MiniMaxTTSConfig {
	apiKey: string;
	model?: string;
	voiceId?: string;
	speed?: number;
	volume?: number;
	pitch?: number;
	sampleRate?: number;
	format?: "mp3" | "pcm" | "flac";
	bitrate?: number;
}

// ── Events ────────────────────────────────────────────────────────────────────

export type MiniMaxTTSEvent =
	| { type: "task_started" }
	| { type: "audio"; audio: string } // base64-encoded audio chunk
	| { type: "audio_done" }
	| { type: "error"; message: string }
	| { type: "closed" };

// ── Client ────────────────────────────────────────────────────────────────────

export class MiniMaxTTSClient {
	private ws: WebSocket | null = null;
	private listeners = new Set<(event: MiniMaxTTSEvent) => void>();
	private _taskActive = false;
	private model = "speech-2.8-turbo";
	private voiceSettings: Record<string, unknown> = {};
	private audioSettings: Record<string, unknown> = {};

	get isTaskActive(): boolean {
		return this._taskActive;
	}

	async connect(config: MiniMaxTTSConfig): Promise<void> {
		this.model = config.model ?? "speech-2.8-turbo";
		this.voiceSettings = {
			voice_id: config.voiceId ?? "English_Graceful_Lady",
			speed: config.speed ?? 1,
			vol: config.volume ?? 1,
			pitch: config.pitch ?? 0,
		};
		this.audioSettings = {
			sample_rate: config.sampleRate ?? 24000,
			bitrate: config.bitrate ?? 128000,
			format: config.format ?? "mp3",
			channel: 1,
		};

		return new Promise((resolve, reject) => {
			this.ws = new WebSocket(MINIMAX_TTS_URL, {
				headers: { Authorization: `Bearer ${config.apiKey}` },
			});

			// Wait for connected_success handshake
			const onHandshake = (data: WebSocket.RawData) => {
				try {
					const msg = JSON.parse(data.toString());
					if (msg.event === "connected_success") {
						this.ws?.off("message", onHandshake);
						this.ws?.on("message", (d) => this.handleMessage(d));
						resolve();
					}
				} catch {
					// ignore parse errors during handshake
				}
			};

			this.ws.on("message", onHandshake);

			this.ws.on("error", (err) => {
				if (this.ws?.readyState !== WebSocket.OPEN) {
					reject(err);
				}
				this.emit({ type: "error", message: err.message });
			});

			this.ws.on("close", () => {
				this._taskActive = false;
				this.emit({ type: "closed" });
			});
		});
	}

	async startTask(): Promise<void> {
		if (this._taskActive) {
			this.sendJson({ event: "task_finish" });
			this._taskActive = false;
		}

		this.sendJson({
			event: "task_start",
			model: this.model,
			voice_setting: this.voiceSettings,
			audio_setting: this.audioSettings,
		});

		// Wait for task_started with timeout
		await Promise.race([
			new Promise<void>((resolve) => {
				const handler = (event: MiniMaxTTSEvent) => {
					if (event.type === "task_started") {
						this.listeners.delete(handler);
						resolve();
					}
				};
				this.listeners.add(handler);
			}),
			new Promise<void>((_, reject) => setTimeout(() => reject(new Error("TTS task_started timeout")), 10_000)),
		]);

		this._taskActive = true;
	}

	sendText(text: string): void {
		if (!this._taskActive) {
			throw new Error("No active TTS task — call startTask() first");
		}
		this.sendJson({ event: "task_continue", text });
	}

	finishTask(): void {
		if (!this._taskActive) return;
		this._taskActive = false;
		this.sendJson({ event: "task_finish" });
	}

	async disconnect(): Promise<void> {
		if (this._taskActive) {
			this.finishTask();
		}
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
	}

	onEvent(handler: (event: MiniMaxTTSEvent) => void): () => void {
		this.listeners.add(handler);
		return () => this.listeners.delete(handler);
	}

	// ── Internal ──────────────────────────────────────────────────────────────

	private sendJson(data: Record<string, unknown>): void {
		if (this.ws?.readyState !== WebSocket.OPEN) {
			throw new Error("TTS WebSocket not connected");
		}
		this.ws.send(JSON.stringify(data));
	}

	private handleMessage(data: WebSocket.RawData): void {
		try {
			const msg = JSON.parse(data.toString());

			// Event-type messages (task_started, etc.)
			if (msg.event === "task_started") {
				this.emit({ type: "task_started" });
				return;
			}

			// Error check
			if (msg.base_resp?.status_code && msg.base_resp.status_code !== 0) {
				this.emit({
					type: "error",
					message: msg.base_resp.status_msg ?? `TTS error code ${msg.base_resp.status_code}`,
				});
				return;
			}

			// Audio data messages
			if (msg.data?.audio) {
				const status = msg.data.status ?? (msg.is_final ? 2 : 1);
				const hex: string = msg.data.audio;

				if (hex.length > 0) {
					const base64 = Buffer.from(hex, "hex").toString("base64");
					this.emit({ type: "audio", audio: base64 });
				}

				if (status === 2) {
					this.emit({ type: "audio_done" });
				}
			}
		} catch {
			// ignore parse errors
		}
	}

	private emit(event: MiniMaxTTSEvent): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}
}
