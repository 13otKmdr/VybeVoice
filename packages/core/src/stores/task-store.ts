import { existsSync, mkdirSync, readdirSync, readFileSync } from "fs";
import { writeFile } from "fs/promises";
import { join } from "path";
import type { TaskRecord, TaskStatus } from "../domain/types.js";

export interface TaskStore {
	get(id: string): Promise<TaskRecord | null>;
	save(task: TaskRecord): Promise<void>;
	findBySession(sessionId: string): Promise<TaskRecord[]>;
	findPending(): Promise<TaskRecord[]>;
	updateStatus(id: string, status: TaskStatus): Promise<TaskRecord | null>;
}

export class FileTaskStore implements TaskStore {
	private dir: string;

	constructor(dataDir: string) {
		this.dir = join(dataDir, "tasks");
		if (!existsSync(this.dir)) {
			mkdirSync(this.dir, { recursive: true });
		}
	}

	async get(id: string): Promise<TaskRecord | null> {
		const path = join(this.dir, `${id}.json`);
		if (!existsSync(path)) return null;
		return JSON.parse(readFileSync(path, "utf-8")) as TaskRecord;
	}

	async save(task: TaskRecord): Promise<void> {
		const path = join(this.dir, `${task.id}.json`);
		await writeFile(path, JSON.stringify(task, null, "\t"), "utf-8");
	}

	async findBySession(sessionId: string): Promise<TaskRecord[]> {
		if (!existsSync(this.dir)) return [];
		const files = readdirSync(this.dir).filter((f) => f.endsWith(".json"));
		const tasks: TaskRecord[] = [];
		for (const file of files) {
			const task = JSON.parse(readFileSync(join(this.dir, file), "utf-8")) as TaskRecord;
			if (task.sessionId === sessionId) {
				tasks.push(task);
			}
		}
		return tasks.sort((a, b) => a.createdAt - b.createdAt);
	}

	async findPending(): Promise<TaskRecord[]> {
		if (!existsSync(this.dir)) return [];
		const files = readdirSync(this.dir).filter((f) => f.endsWith(".json"));
		const tasks: TaskRecord[] = [];
		for (const file of files) {
			const task = JSON.parse(readFileSync(join(this.dir, file), "utf-8")) as TaskRecord;
			if (task.status === "queued" || task.status === "starting" || task.status === "running") {
				tasks.push(task);
			}
		}
		return tasks.sort((a, b) => a.createdAt - b.createdAt);
	}

	async updateStatus(id: string, status: TaskStatus): Promise<TaskRecord | null> {
		const task = await this.get(id);
		if (!task) return null;
		task.status = status;
		task.updatedAt = Date.now();
		await this.save(task);
		return task;
	}
}
