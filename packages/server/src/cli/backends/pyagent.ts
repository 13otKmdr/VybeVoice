import { type DomainEvent, generateId, type SpecialistRunner, type TaskRecord } from "@voice-orchestrator/core";
import type { BackendOptions, PyAgentOptions } from "../config.js";

/**
 * Pi Agent specialist — HTTP POST to a pi-agent-compatible endpoint.
 */
class PyAgentSpecialist implements SpecialistRunner {
	readonly kind = "pyagent";

	private readonly url: string;
	private readonly token: string;
	private abortControllers = new Map<string, AbortController>();

	constructor(options: PyAgentOptions) {
		this.url = options.url;
		this.token = options.token;
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
			const response = await fetch(`${this.url}/v1/chat/completions`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
				},
				body: JSON.stringify({
					messages: [{ role: "user", content: `[Voice Task - ${task.kind}]\n${task.intent}` }],
					stream: false,
				}),
				signal: controller.signal,
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Pi Agent error: ${response.status} - ${errorText}`);
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

export function createPyAgentSpecialist(options: BackendOptions): SpecialistRunner {
	return new PyAgentSpecialist(options as PyAgentOptions);
}
