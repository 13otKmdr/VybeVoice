import { type DomainEvent, generateId, type SpecialistRunner, type TaskRecord } from "@voice-orchestrator/core";

/**
 * OpenClaw gateway configuration defaults (env vars used when no constructor params given)
 */
const DEFAULT_OPENCLAW_URL = process.env.OPENCLAW_GATEWAY_URL || "http://127.0.0.1:18789";
const DEFAULT_OPENCLAW_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || "";

export interface MerlinSpecialistOptions {
	url?: string;
	token?: string;
	agentId?: string;
}

/**
 * Merlin specialist - forwards tasks to OpenClaw's main agent (Merlin).
 * This connects the voice orchestrator to the full OpenClaw execution layer.
 */
export class MerlinSpecialist implements SpecialistRunner {
	readonly kind = "merlin";

	private readonly url: string;
	private readonly token: string;
	private readonly agentId: string;
	private abortControllers = new Map<string, AbortController>();

	constructor(options?: MerlinSpecialistOptions) {
		this.url = options?.url ?? DEFAULT_OPENCLAW_URL;
		this.token = options?.token ?? DEFAULT_OPENCLAW_TOKEN;
		this.agentId = options?.agentId ?? "main";
	}

	canHandle(_task: TaskRecord): boolean {
		// Merlin is the generalist - handles all task types
		return true;
	}

	async *start(task: TaskRecord, signal: AbortSignal): AsyncIterable<DomainEvent> {
		const controller = new AbortController();
		this.abortControllers.set(task.id, controller);
		signal.addEventListener("abort", () => controller.abort());

		const now = Date.now();

		yield {
			type: "task.status_changed",
			sessionId: task.sessionId,
			taskId: task.id,
			eventId: generateId("evt"),
			timestamp: now,
			previousStatus: "queued",
			newStatus: "running",
		};

		try {
			const response = await fetch(`${this.url}/v1/chat/completions`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.token}`,
					"x-openclaw-agent-id": this.agentId,
				},
				body: JSON.stringify({
					model: `openclaw:${this.agentId}`,
					messages: [
						{
							role: "user",
							content: `[Voice Task - ${task.kind}]\n${task.intent}`,
						},
					],
					stream: false,
				}),
				signal: controller.signal,
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`OpenClaw error: ${response.status} - ${errorText}`);
			}

			const data = (await response.json()) as {
				choices?: Array<{ message?: { content?: string } }>;
			};
			const result = data.choices?.[0]?.message?.content || "Task completed";

			yield {
				type: "task.completed",
				sessionId: task.sessionId,
				taskId: task.id,
				eventId: generateId("evt"),
				timestamp: Date.now(),
				result: {
					summary: result.slice(0, 500),
					artifactIds: [],
				},
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);

			if (message.includes("abort")) {
				yield {
					type: "task.status_changed",
					sessionId: task.sessionId,
					taskId: task.id,
					eventId: generateId("evt"),
					timestamp: Date.now(),
					previousStatus: "running",
					newStatus: "cancelled",
				};
			} else {
				yield {
					type: "task.failed",
					sessionId: task.sessionId,
					taskId: task.id,
					eventId: generateId("evt"),
					timestamp: Date.now(),
					error: message,
				};
			}
		} finally {
			this.abortControllers.delete(task.id);
		}
	}

	cancel(taskId: string): void {
		const controller = this.abortControllers.get(taskId);
		if (controller) {
			controller.abort();
		}
	}
}
