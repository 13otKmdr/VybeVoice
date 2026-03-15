import { type DomainEvent, generateId, type SpecialistRunner, type TaskRecord } from "@voice-orchestrator/core";
import type { BackendOptions, CustomOptions } from "../config.js";

/**
 * Custom HTTP specialist — POSTs to a user-configured endpoint.
 */
class CustomSpecialist implements SpecialistRunner {
	readonly kind = "custom";

	private readonly url: string;
	private readonly authHeader?: string;
	private readonly extraHeaders: Record<string, string>;
	private abortControllers = new Map<string, AbortController>();

	constructor(options: CustomOptions) {
		this.url = options.url;
		this.authHeader = options.authHeader;
		this.extraHeaders = options.headers ?? {};
	}

	canHandle(_task: TaskRecord): boolean {
		return true;
	}

	async *start(task: TaskRecord, signal: AbortSignal): AsyncIterable<DomainEvent> {
		const controller = new AbortController();
		this.abortControllers.set(task.id, controller);
		signal.addEventListener("abort", () => controller.abort());

		yield {
			type: "task.status_changed",
			sessionId: task.sessionId,
			taskId: task.id,
			eventId: generateId("evt"),
			timestamp: Date.now(),
			previousStatus: "queued",
			newStatus: "running",
		};

		try {
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
				...this.extraHeaders,
			};
			if (this.authHeader) {
				headers.Authorization = this.authHeader;
			}

			const response = await fetch(this.url, {
				method: "POST",
				headers,
				body: JSON.stringify({
					prompt: `[Voice Task - ${task.kind}]\n${task.intent}`,
					taskId: task.id,
				}),
				signal: controller.signal,
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Custom backend error: ${response.status} - ${errorText}`);
			}

			const data = (await response.json()) as {
				result?: string;
				choices?: Array<{ message?: { content?: string } }>;
			};
			// Support both { result } and OpenAI-compatible { choices } response shapes
			const result = data.result || data.choices?.[0]?.message?.content || "Task completed";

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
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);

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
		if (controller) controller.abort();
	}
}

export function createCustomSpecialist(options: BackendOptions): SpecialistRunner {
	return new CustomSpecialist(options as CustomOptions);
}
