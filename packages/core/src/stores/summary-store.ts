import { existsSync, mkdirSync, readdirSync, readFileSync } from "fs";
import { writeFile } from "fs/promises";
import { join } from "path";
import type { SummaryRecord } from "../domain/types.js";

export interface SummaryStore {
	get(id: string): Promise<SummaryRecord | null>;
	save(summary: SummaryRecord): Promise<void>;
	findBySession(sessionId: string): Promise<SummaryRecord[]>;
}

export class FileSummaryStore implements SummaryStore {
	private dir: string;

	constructor(dataDir: string) {
		this.dir = join(dataDir, "summaries");
		if (!existsSync(this.dir)) {
			mkdirSync(this.dir, { recursive: true });
		}
	}

	async get(id: string): Promise<SummaryRecord | null> {
		const path = join(this.dir, `${id}.json`);
		if (!existsSync(path)) return null;
		return JSON.parse(readFileSync(path, "utf-8")) as SummaryRecord;
	}

	async save(summary: SummaryRecord): Promise<void> {
		const path = join(this.dir, `${summary.id}.json`);
		await writeFile(path, JSON.stringify(summary, null, "\t"), "utf-8");
	}

	async findBySession(sessionId: string): Promise<SummaryRecord[]> {
		if (!existsSync(this.dir)) return [];
		const files = readdirSync(this.dir).filter((f) => f.endsWith(".json"));
		const results: SummaryRecord[] = [];
		for (const file of files) {
			const summary = JSON.parse(readFileSync(join(this.dir, file), "utf-8")) as SummaryRecord;
			if (summary.sessionId === sessionId) {
				results.push(summary);
			}
		}
		return results.sort((a, b) => a.createdAt - b.createdAt);
	}
}
