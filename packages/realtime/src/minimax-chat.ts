// ── Config & Types ────────────────────────────────────────────────────────────

const MINIMAX_CHAT_URL = "https://api.minimax.io/v1/chat/completions";

export interface MiniMaxChatConfig {
	apiKey: string;
	model?: string;
	systemPrompt?: string;
	tools?: MiniMaxChatTool[];
	temperature?: number;
	maxTokens?: number;
}

export interface MiniMaxChatTool {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	};
}

export interface ChatMessage {
	role: "system" | "user" | "assistant" | "tool";
	content?: string | null;
	tool_calls?: ToolCall[];
	tool_call_id?: string;
}

export interface ToolCall {
	id: string;
	type: "function";
	function: {
		name: string;
		arguments: string;
	};
}

// ── Stream events ─────────────────────────────────────────────────────────────

export type ChatStreamEvent =
	| { type: "text_delta"; content: string }
	| { type: "tool_call_start"; id: string; name: string }
	| { type: "tool_call_delta"; id: string; arguments: string }
	| { type: "tool_call_done"; id: string; name: string; arguments: string }
	| { type: "done"; finishReason: string }
	| { type: "error"; message: string };

// ── Client ────────────────────────────────────────────────────────────────────

export class MiniMaxChatClient {
	private apiKey = "";
	private model = "MiniMax-M2.5";
	private tools: MiniMaxChatTool[] = [];
	private temperature = 0.7;
	private maxTokens = 2048;
	private messages: ChatMessage[] = [];
	private currentAbort: AbortController | null = null;

	configure(config: MiniMaxChatConfig): void {
		this.apiKey = config.apiKey;
		this.model = config.model ?? "MiniMax-M2.5";
		this.tools = config.tools ?? [];
		this.temperature = config.temperature ?? 0.7;
		this.maxTokens = config.maxTokens ?? 2048;

		this.messages = [];
		if (config.systemPrompt) {
			this.messages.push({ role: "system", content: config.systemPrompt });
		}
	}

	addUserMessage(text: string): void {
		this.messages.push({ role: "user", content: text });
	}

	addToolResult(toolCallId: string, result: string): void {
		this.messages.push({ role: "tool", content: result, tool_call_id: toolCallId });
	}

	abort(): void {
		if (this.currentAbort) {
			this.currentAbort.abort();
			this.currentAbort = null;
		}
	}

	async *stream(): AsyncGenerator<ChatStreamEvent> {
		const abort = new AbortController();
		this.currentAbort = abort;

		const body: Record<string, unknown> = {
			model: this.model,
			messages: this.messages,
			stream: true,
			max_completion_tokens: this.maxTokens,
			temperature: this.temperature,
		};

		if (this.tools.length > 0) {
			body.tools = this.tools;
		}

		let response: Response;
		try {
			response = await fetch(MINIMAX_CHAT_URL, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.apiKey}`,
				},
				body: JSON.stringify(body),
				signal: abort.signal,
			});
		} catch (err) {
			if (abort.signal.aborted) return;
			yield { type: "error", message: err instanceof Error ? err.message : String(err) };
			return;
		}

		if (!response.ok) {
			const text = await response.text().catch(() => "");
			yield { type: "error", message: `Chat API error ${response.status}: ${text}` };
			return;
		}

		if (!response.body) {
			yield { type: "error", message: "No response body" };
			return;
		}

		// Accumulators for the assistant message
		let assistantContent = "";
		const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
		let finishReason = "stop";

		// Parse SSE stream
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });

				// Process complete SSE lines
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";

				for (const line of lines) {
					if (!line.startsWith("data: ")) continue;
					const data = line.slice(6).trim();
					if (data === "[DONE]") continue;

					let chunk: Record<string, any>;
					try {
						chunk = JSON.parse(data);
					} catch {
						continue;
					}

					const choice = chunk.choices?.[0];
					if (!choice) continue;

					const delta = choice.delta;
					if (!delta) continue;

					// Text content
					if (delta.content) {
						assistantContent += delta.content;
						yield { type: "text_delta", content: delta.content };
					}

					// Tool calls (streamed incrementally)
					if (delta.tool_calls) {
						for (const tc of delta.tool_calls as any[]) {
							const idx: number = tc.index ?? 0;

							if (!toolCalls.has(idx)) {
								toolCalls.set(idx, { id: tc.id ?? "", name: tc.function?.name ?? "", arguments: "" });
								if (tc.id) {
									yield { type: "tool_call_start", id: tc.id, name: tc.function?.name ?? "" };
								}
							}

							const existing = toolCalls.get(idx)!;
							if (tc.id) existing.id = tc.id;
							if (tc.function?.name) existing.name = tc.function.name;
							if (tc.function?.arguments) {
								existing.arguments += tc.function.arguments;
								yield { type: "tool_call_delta", id: existing.id, arguments: tc.function.arguments };
							}
						}
					}

					if (choice.finish_reason) {
						finishReason = choice.finish_reason;
					}
				}
			}
		} catch (err) {
			if (abort.signal.aborted) return;
			yield { type: "error", message: err instanceof Error ? err.message : String(err) };
			return;
		} finally {
			this.currentAbort = null;
		}

		// Persist assistant message in conversation history
		const assistantMessage: ChatMessage = {
			role: "assistant",
			content: assistantContent || null,
		};

		if (toolCalls.size > 0) {
			assistantMessage.tool_calls = Array.from(toolCalls.values()).map((tc) => ({
				id: tc.id,
				type: "function" as const,
				function: { name: tc.name, arguments: tc.arguments },
			}));

			for (const tc of toolCalls.values()) {
				yield { type: "tool_call_done", id: tc.id, name: tc.name, arguments: tc.arguments };
			}
		}

		this.messages.push(assistantMessage);

		yield { type: "done", finishReason };
	}

	clearHistory(): void {
		const systemMsg = this.messages.find((m) => m.role === "system");
		this.messages = systemMsg ? [systemMsg] : [];
	}
}
