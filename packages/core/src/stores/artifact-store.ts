import { existsSync, mkdirSync, readdirSync, readFileSync } from "fs";
import { writeFile } from "fs/promises";
import { join } from "path";
import type { ArtifactRecord } from "../domain/types.js";

export interface ArtifactStore {
	get(id: string): Promise<ArtifactRecord | null>;
	save(artifact: ArtifactRecord): Promise<void>;
	findByTask(taskId: string): Promise<ArtifactRecord[]>;
	findBySession(sessionId: string): Promise<ArtifactRecord[]>;
}

export class FileArtifactStore implements ArtifactStore {
	private dir: string;

	constructor(dataDir: string) {
		this.dir = join(dataDir, "artifacts");
		if (!existsSync(this.dir)) {
			mkdirSync(this.dir, { recursive: true });
		}
	}

	async get(id: string): Promise<ArtifactRecord | null> {
		const path = join(this.dir, `${id}.json`);
		if (!existsSync(path)) return null;
		return JSON.parse(readFileSync(path, "utf-8")) as ArtifactRecord;
	}

	async save(artifact: ArtifactRecord): Promise<void> {
		const path = join(this.dir, `${artifact.id}.json`);
		await writeFile(path, JSON.stringify(artifact, null, "\t"), "utf-8");
	}

	async findByTask(taskId: string): Promise<ArtifactRecord[]> {
		return this.filterFiles((a) => a.taskId === taskId);
	}

	async findBySession(sessionId: string): Promise<ArtifactRecord[]> {
		return this.filterFiles((a) => a.sessionId === sessionId);
	}

	private filterFiles(predicate: (a: ArtifactRecord) => boolean): ArtifactRecord[] {
		if (!existsSync(this.dir)) return [];
		const files = readdirSync(this.dir).filter((f) => f.endsWith(".json"));
		const results: ArtifactRecord[] = [];
		for (const file of files) {
			const artifact = JSON.parse(readFileSync(join(this.dir, file), "utf-8")) as ArtifactRecord;
			if (predicate(artifact)) {
				results.push(artifact);
			}
		}
		return results.sort((a, b) => a.createdAt - b.createdAt);
	}
}
