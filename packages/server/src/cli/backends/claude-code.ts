import { spawn } from "node:child_process";
import { type DomainEvent, generateId, type SpecialistRunner, type TaskRecord } from "@voice-orchestrator/core";
import type { BackendOptions, ClaudeCodeOptions } from "../config.js";

/**
 * Claude Code specialist — spawns `claude -p` as a subprocess.
 * Parses stream-json (NDJSON) output and maps to DomainEvents.
 */
class ClaudeCodeSpecialist implements SpecialistRunner {
	readonly kind = "claude-code";

	private readonly binaryPath: string;
	private readonly workingDirectory: string;
	private readonly model?: string;
	private abortControllers = new Map<string, AbortController>();

	constructor(options: ClaudeCodeOptions) {
		this.binaryPath = options.binaryPath || "claude";
		this.workingDirectory = options.workingDirectory || process.cwd();
		this.model = options.model;
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
			const result = await this.runClaude(task.intent, controller.signal);

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

	private runClaude(prompt: string, signal: AbortSignal): Promise<string> {
		return new Promise((resolve, reject) => {
			const args = ["-p", prompt, "--output-format", "text"];
			if (this.model) args.push("--model", this.model);

			const child = spawn(this.binaryPath, args, {
				cwd: this.workingDirectory,
				stdio: ["ignore", "pipe", "pipe"],
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
					reject(new Error(`Claude Code exited with code ${code}: ${stderr}`));
				} else {
					resolve(stdout.trim() || "Task completed");
				}
			});

			child.on("error", (err) => {
				reject(new Error(`Failed to spawn claude: ${err.message}`));
			});
		});
	}
}

export function createClaudeCodeSpecialist(options: BackendOptions): SpecialistRunner {
	return new ClaudeCodeSpecialist(options as ClaudeCodeOptions);
}
