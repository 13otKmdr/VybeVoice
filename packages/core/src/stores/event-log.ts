import { existsSync, mkdirSync, readdirSync, readFileSync } from "fs";
import { appendFile } from "fs/promises";
import { join } from "path";
import type { DomainEvent, TaskCompleted, TaskCreated, TaskFailed, TaskStatusChanged } from "../domain/events.js";

type PersistedDomainEvent =
	| DomainEvent
	| Omit<TaskCreated, "sessionId">
	| Omit<TaskStatusChanged, "sessionId">
	| Omit<TaskCompleted, "sessionId">
	| Omit<TaskFailed, "sessionId">;

export interface EventFilter {
	sessionId?: string;
	taskId?: string;
	types?: DomainEvent["type"][];
	since?: number;
	limit?: number;
}

export interface EventLog {
	append(event: DomainEvent): Promise<void>;
	query(filter: EventFilter): Promise<DomainEvent[]>;
	subscribe(handler: (event: DomainEvent) => void): () => void;
}

export class FileEventLog implements EventLog {
	private dir: string;
	private listeners = new Set<(event: DomainEvent) => void>();

	constructor(dataDir: string) {
		this.dir = join(dataDir, "events");
		if (!existsSync(this.dir)) {
			mkdirSync(this.dir, { recursive: true });
		}
	}

	async append(event: DomainEvent): Promise<void> {
		const date = new Date(event.timestamp).toISOString().slice(0, 10);
		const path = join(this.dir, `${date}.jsonl`);
		await appendFile(path, `${JSON.stringify(event)}\n`, "utf-8");

		for (const listener of this.listeners) {
			listener(event);
		}
	}

	async query(filter: EventFilter): Promise<DomainEvent[]> {
		if (!existsSync(this.dir)) return [];

		const files = readdirSync(this.dir)
			.filter((f) => f.endsWith(".jsonl"))
			.sort();

		const persistedEvents: PersistedDomainEvent[] = [];

		for (const file of files) {
			const content = readFileSync(join(this.dir, file), "utf-8");
			const lines = content.split("\n");
			for (const line of lines) {
				if (!line) continue;
				const event = JSON.parse(line) as PersistedDomainEvent;
				persistedEvents.push(event);
			}
		}

		persistedEvents.sort((a, b) => a.timestamp - b.timestamp);

		const taskSessionIds = this.indexTaskSessionIds(persistedEvents);
		const events = persistedEvents
			.map((event) => this.normalizeEvent(event, taskSessionIds))
			.filter((event) => this.matchesFilter(event, filter));

		if (filter.limit && events.length > filter.limit) {
			return events.slice(-filter.limit);
		}

		return events;
	}

	subscribe(handler: (event: DomainEvent) => void): () => void {
		this.listeners.add(handler);
		return () => this.listeners.delete(handler);
	}

	private matchesFilter(event: DomainEvent, filter: EventFilter): boolean {
		if (filter.since && event.timestamp < filter.since) return false;
		if (filter.types && !filter.types.includes(event.type)) return false;

		if (filter.sessionId && this.getEventSessionId(event) !== filter.sessionId) return false;

		if (filter.taskId && this.getEventTaskId(event) !== filter.taskId) return false;

		return true;
	}

	private indexTaskSessionIds(events: PersistedDomainEvent[]): Map<string, string> {
		const taskSessionIds = new Map<string, string>();

		for (const event of events) {
			switch (event.type) {
				case "task.created":
					taskSessionIds.set(event.task.id, "sessionId" in event ? event.sessionId : event.task.sessionId);
					break;
				case "task.status_changed":
				case "task.completed":
				case "task.failed":
					if ("sessionId" in event) {
						taskSessionIds.set(event.taskId, event.sessionId);
					}
					break;
			}
		}

		return taskSessionIds;
	}

	private normalizeEvent(event: PersistedDomainEvent, taskSessionIds: Map<string, string>): DomainEvent {
		switch (event.type) {
			case "task.created":
				return "sessionId" in event ? event : { ...event, sessionId: event.task.sessionId };
			case "task.status_changed":
			case "task.completed":
			case "task.failed": {
				if ("sessionId" in event) return event;

				const sessionId = taskSessionIds.get(event.taskId);
				if (!sessionId) {
					throw new Error(`Missing session mapping for task event ${event.eventId} (${event.type}).`);
				}

				return { ...event, sessionId } as DomainEvent;
			}
			default:
				return event;
		}
	}

	private getEventSessionId(event: DomainEvent): string | undefined {
		if ("sessionId" in event) return event.sessionId;
		if ("session" in event) return event.session.id;
		return undefined;
	}

	private getEventTaskId(event: DomainEvent): string | undefined {
		if ("taskId" in event) return event.taskId;
		if (event.type === "task.created") return event.task.id;
		return undefined;
	}
}
