import { existsSync, mkdirSync, readdirSync, readFileSync } from "fs";
import { writeFile } from "fs/promises";
import { join } from "path";
import type { SessionRecord } from "../domain/types.js";

export interface SessionStore {
	get(id: string): Promise<SessionRecord | null>;
	save(session: SessionRecord): Promise<void>;
	findActive(userId: string): Promise<SessionRecord | null>;
	listAll(): Promise<SessionRecord[]>;
	updateLastActive(id: string, timestamp: number): Promise<void>;
}

export class FileSessionStore implements SessionStore {
	private dir: string;

	constructor(dataDir: string) {
		this.dir = join(dataDir, "sessions");
		if (!existsSync(this.dir)) {
			mkdirSync(this.dir, { recursive: true });
		}
	}

	async get(id: string): Promise<SessionRecord | null> {
		const path = join(this.dir, `${id}.json`);
		if (!existsSync(path)) return null;
		return JSON.parse(readFileSync(path, "utf-8")) as SessionRecord;
	}

	async save(session: SessionRecord): Promise<void> {
		const path = join(this.dir, `${session.id}.json`);
		await writeFile(path, JSON.stringify(session, null, "\t"), "utf-8");
	}

	async findActive(userId: string): Promise<SessionRecord | null> {
		if (!existsSync(this.dir)) return null;
		const files = readdirSync(this.dir).filter((f) => f.endsWith(".json"));
		for (const file of files) {
			const session = JSON.parse(readFileSync(join(this.dir, file), "utf-8")) as SessionRecord;
			if (session.userId === userId && (session.state === "active" || session.state === "idle")) {
				return session;
			}
		}
		return null;
	}

	async listAll(): Promise<SessionRecord[]> {
		if (!existsSync(this.dir)) return [];
		const files = readdirSync(this.dir).filter((f) => f.endsWith(".json"));
		const sessions: SessionRecord[] = [];
		for (const file of files) {
			try {
				const session = JSON.parse(readFileSync(join(this.dir, file), "utf-8")) as SessionRecord;
				sessions.push(session);
			} catch {
				// skip corrupt files
			}
		}
		return sessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
	}

	async updateLastActive(id: string, timestamp: number): Promise<void> {
		const session = await this.get(id);
		if (!session) return;
		session.lastActiveAt = timestamp;
		await this.save(session);
	}
}
