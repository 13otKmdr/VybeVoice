import { generateId, type DomainEvent, type SpecialistRunner, type TaskRecord } from "@voice-orchestrator/core";

// NOTE: @mariozechner/pi-agent-core needs to be installed by the user via npm
// or linked from a local pi-mono workspace.
// import { Agent } from "@mariozechner/pi-agent-core";

export class BuilderSpecialist implements SpecialistRunner {
	kind = "builder";

	private runningTasks = new Set<string>();

	canHandle(task: TaskRecord): boolean {
		return task.kind === this.kind;
	}

	async *start(task: TaskRecord, signal: AbortSignal): AsyncIterable<DomainEvent> {
		this.runningTasks.add(task.id);

		try {
			// Simulate the pi-agent-core loop
			let steps = 0;
			const maxSteps = 3;

			while (steps < maxSteps) {
				if (signal.aborted) {
					throw new Error("Aborted by TaskManager");
				}

				// Yield progress event if needed, but since we don't have artifact.created
				// we will just wait.
				steps++;
				await new Promise(resolve => setTimeout(resolve, 1500));
			}

			// Finalize task with success
			yield {
				type: "task.completed",
				eventId: generateId("evt"),
				timestamp: Date.now(),
				taskId: task.id,
				result: {
					summary: "Built project artifacts successfully using pi-agent-core mock.",
					artifactIds: []
				}
			} as DomainEvent;

		} catch (error) {
			yield {
				type: "task.failed",
				eventId: generateId("evt"),
				timestamp: Date.now(),
				taskId: task.id,
				error: error instanceof Error ? error.message : String(error)
			} as DomainEvent;
		} finally {
			this.runningTasks.delete(task.id);
		}
	}

	cancel(taskId: string): void {
		// In a real implementation we would call agent.abort()
		this.runningTasks.delete(taskId);
	}
}
