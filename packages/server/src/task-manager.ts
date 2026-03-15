import {
	type DomainEvent,
	type EventLog,
	generateId,
	type SpecialistRunner,
	type TaskRecord,
	type TaskStatus,
	type TaskStore,
} from "@voice-orchestrator/core";

export interface TaskManagerOptions {
	taskStore: TaskStore;
	eventLog: EventLog;
	specialists: SpecialistRunner[];
	pollIntervalMs?: number;
}

export class TaskManager {
	private taskStore: TaskStore;
	private eventLog: EventLog;
	private specialists: SpecialistRunner[];
	private pollIntervalMs: number;
	private interval: ReturnType<typeof setInterval> | null = null;
	private runningTasks = new Map<string, AbortController>();

	constructor(options: TaskManagerOptions) {
		this.taskStore = options.taskStore;
		this.eventLog = options.eventLog;
		this.specialists = options.specialists;
		this.pollIntervalMs = options.pollIntervalMs ?? 1000;
	}

	start() {
		if (this.interval) return;
		this.interval = setInterval(() => {
			this.tick().catch((err) => console.error("[taskManager] tick error:", err));
		}, this.pollIntervalMs);
		// Run once immediately
		this.tick().catch((err) => console.error("[taskManager] initial tick error:", err));
	}

	stop() {
		if (this.interval) {
			clearInterval(this.interval);
			this.interval = null;
		}
		for (const [taskId, controller] of this.runningTasks.entries()) {
			controller.abort("TaskManager stopped");
			this.runningTasks.delete(taskId);
		}
	}

	private async tick() {
		const pendingTasks = await this.taskStore.findPending();
		const now = Date.now();

		for (const task of pendingTasks) {
			if (this.runningTasks.has(task.id)) {
				// Check for timeouts of currently running tasks
				// The task.updatedAt might be updated when events fire, but let's check basic timeout against createdAt + timeoutMs for simplicity,
				// or when it transitioned to running. We'll use the last updated time.
				if (now - task.updatedAt > task.timeoutMs) {
					console.warn(`[taskManager] Task ${task.id} timed out.`);
					await this.failTask(task, "Task completely timed out.");
				}
				continue;
			}

			if (task.status === "queued" || task.status === "starting") {
				// Resume or start
				this.runTask(task).catch((err) => console.error(`[taskManager] Execution failed for ${task.id}:`, err));
			} else if (task.status === "running") {
				// It's marked running but not in runningTasks. Likely we restarted the server.
				// Fail the task and attempt retry to be safe.
				await this.failTask(task, "Worker restarted while task was running.");
			}
		}
	}

	private async runTask(task: TaskRecord) {
		const specialist =
			this.specialists.find((s) => s.kind === task.kind && s.canHandle(task)) ??
			this.specialists.find((s) => s.canHandle(task));

		if (!specialist) {
			await this.failTask(task, `No specialist available for kind: ${task.kind}`);
			return;
		}

		await this.updateStatus(task, "starting");

		const controller = new AbortController();
		this.runningTasks.set(task.id, controller);

		// Handle timeout abort
		const timeoutId = setTimeout(() => {
			controller.abort("Task duration exceeded timeout threshold");
		}, task.timeoutMs);

		await this.updateStatus(task, "running");

		try {
			for await (const event of specialist.start(task, controller.signal)) {
				// Each yielded event is appended to EventLog
				await this.emitEvent(event);
				// Update the task timestamp to signal it's still alive
				task.updatedAt = Date.now();
				await this.taskStore.save(task);

				if (event.type === "task.status_changed") {
					task.status = event.newStatus;
					await this.taskStore.save(task);
				}

				if (event.type === "task.failed" || event.type === "task.completed") {
					// Subsystem emitted terminal event
					task.status = event.type === "task.failed" ? "failed" : "completed";
					if (event.type === "task.failed" && "error" in event) {
						task.error = event.error as string;
					}
					await this.taskStore.save(task);
					break;
				}
			}

			// If loop finishes gracefully but status isn't complete/failed
			if (task.status === "running" || task.status === "starting") {
				await this.completeTask(task);
			}
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				await this.failTask(task, "Task aborted due to timeout");
			} else {
				await this.failTask(task, error instanceof Error ? error.message : String(error));
			}
		} finally {
			clearTimeout(timeoutId);
			this.runningTasks.delete(task.id);
		}
	}

	private async failTask(task: TaskRecord, error: string) {
		if (this.runningTasks.has(task.id)) {
			this.runningTasks.get(task.id)?.abort(error);
			this.runningTasks.delete(task.id);
		}

		if (task.retryCount < task.maxRetries) {
			task.status = "queued";
			task.retryCount += 1;
			task.error = error;
			task.updatedAt = Date.now();
			await this.taskStore.save(task);
			console.log(
				`[taskManager] Task ${task.id} failed, retrying (${task.retryCount}/${task.maxRetries}). Error: ${error}`,
			);
		} else {
			task.status = "failed";
			task.error = `Max retries reached. Last error: ${error}`;
			task.updatedAt = Date.now();
			await this.taskStore.save(task);

			await this.emitEvent({
				type: "task.failed",
				sessionId: task.sessionId,
				taskId: task.id,
				error: task.error,
			});
			console.log(`[taskManager] Task ${task.id} failed permanently: ${task.error}`);
		}
	}

	private async completeTask(task: TaskRecord) {
		task.status = "completed";
		task.updatedAt = Date.now();
		await this.taskStore.save(task);

		await this.emitEvent({
			type: "task.completed",
			sessionId: task.sessionId,
			taskId: task.id,
		});
		console.log(`[taskManager] Task ${task.id} completed successfully`);
	}

	private async updateStatus(task: TaskRecord, status: TaskStatus) {
		const previousStatus = task.status;
		task.status = status;
		task.updatedAt = Date.now();
		await this.taskStore.save(task);

		await this.emitEvent({
			type: "task.status_changed",
			sessionId: task.sessionId,
			taskId: task.id,
			previousStatus,
			newStatus: status,
		});
	}

	private async emitEvent(
		partial: DomainEvent extends infer E ? (E extends DomainEvent ? Omit<E, "eventId" | "timestamp"> : never) : never,
	) {
		const event = {
			...partial,
			eventId: generateId("evt"),
			timestamp: Date.now(),
		} as DomainEvent;
		await this.eventLog.append(event);
	}
}
