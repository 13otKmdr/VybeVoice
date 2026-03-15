import { spawn } from "node:child_process";
import { type DomainEvent, generateId, type SpecialistRunner, type TaskRecord } from "@voice-orchestrator/core";
import type { BackendOptions, CodexOptions } from "../config.js";

/**
 * Codex specialist — spawns OpenAI's codex CLI as a subprocess.
 */
class CodexSpecialist implements SpecialistRunner {
	readonly kind = "codex";

	private readonly apiKey: string;
	private readonly workingDirectory: string;
	private readonly model: string;
	private abortControllers = new Map<string, AbortController>();

	constructor(options: CodexOptions) {
		this.apiKey = options.apiKey;
		this.workingDirectory = options.workingDirectory || process.cwd();
		this.model = options.model || "codex-mini";
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
			taskId: task.id,
			eventId: generateId("evt"),
			timestamp: Date.now(),
			previousStatus: "queued",
			newStatus: "running",
		};

		try {
			const result = await this.runCodex(task.intent, controller.signal);

			yield {
				type: "task.completed",
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
					taskId: task.id,
					eventId: generateId("evt"),
					timestamp: Date.now(),
					previousStatus: "running",
					newStatus: "cancelled",
				};
			} else {
				yield {
					type: "task.failed",
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

	private runCodex(prompt: string, signal: AbortSignal): Promise<string> {
		return new Promise((resolve, reject) => {
			const args = ["--model", this.model, "--quiet", prompt];

			const child = spawn("codex", args, {
				cwd: this.workingDirectory,
				stdio: ["ignore", "pipe", "pipe"],
				env: { ...process.env, OPENAI_API_KEY: this.apiKey },
			});

			signal.addEventListener("abort", () => child.kill("SIGTERM"));

			let stdout = "";
			let stderr = "";

			child.stdout.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});

			child.stderr.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			child.on("close", (code) => {
				if (signal.aborted) {
					reject(new Error("Task aborted"));
				} else if (code !== 0) {
					reject(new Error(`Codex exited with code ${code}: ${stderr}`));
				} else {
					resolve(stdout.trim() || "Task completed");
				}
			});

			child.on("error", (err) => {
				reject(new Error(`Failed to spawn codex: ${err.message}`));
			});
		});
	}
}

export function createCodexSpecialist(options: BackendOptions): SpecialistRunner {
	return new CodexSpecialist(options as CodexOptions);
}
