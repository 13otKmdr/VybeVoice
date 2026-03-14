import type { DomainEvent } from "../domain/events.js";
import type { TaskRecord } from "../domain/types.js";

/**
 * A specialist runner handles a specific kind of delegated work.
 * Internally wraps a pi-agent-core Agent and translates AgentEvents into DomainEvents.
 *
 * Rules:
 * - Specialists do NOT speak directly to the user.
 * - Specialists emit events, not UX.
 * - Merlin owns spoken updates and conversational continuity.
 */
export interface SpecialistRunner {
	/** The kind of work this specialist handles (e.g., "builder", "research"). */
	kind: string;

	/** Whether this specialist can handle the given task. */
	canHandle(task: TaskRecord): boolean;

	/**
	 * Start executing a task. Yields domain events as work progresses.
	 * The caller should forward these to the EventLog.
	 */
	start(task: TaskRecord, signal: AbortSignal): AsyncIterable<DomainEvent>;

	/** Cancel a running task by ID. */
	cancel(taskId: string): void;
}
