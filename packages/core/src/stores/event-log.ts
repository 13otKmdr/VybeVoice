import { existsSync, mkdirSync, readdirSync, readFileSync } from "fs";
import { appendFile } from "fs/promises";
import { join } from "path";
import type { DomainEvent } from "../domain/events.js";

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

		const events: DomainEvent[] = [];

		for (const file of files) {
			const content = readFileSync(join(this.dir, file), "utf-8");
			const lines = content.trim().split("\n");
			for (const line of lines) {
				if (!line) continue;
				const event = JSON.parse(line) as DomainEvent;
				if (this.matchesFilter(event, filter)) {
					events.push(event);
				}
			}
		}

		events.sort((a, b) => a.timestamp - b.timestamp);

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

		if (filter.sessionId) {
			if ("sessionId" in event && event.sessionId !== filter.sessionId) return false;
			if ("session" in event && event.session.id !== filter.sessionId) return false;
		}

		if (filter.taskId) {
			if ("taskId" in event && event.taskId !== filter.taskId) return false;
			if ("task" in event && event.task.id !== filter.taskId) return false;
		}

		return true;
	}
}
