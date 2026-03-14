import {
	FileArtifactStore,
	FileEventLog,
	FileSessionStore,
	FileSummaryStore,
	FileTaskStore,
} from "@voice-orchestrator/core";
import { resolve } from "path";

export interface OrchestratorContext {
	dataDir: string;
	sessionStore: FileSessionStore;
	taskStore: FileTaskStore;
	artifactStore: FileArtifactStore;
	summaryStore: FileSummaryStore;
	eventLog: FileEventLog;
}

export function createContext(dataDir: string): OrchestratorContext {
	return {
		dataDir,
		sessionStore: new FileSessionStore(dataDir),
		taskStore: new FileTaskStore(dataDir),
		artifactStore: new FileArtifactStore(dataDir),
		summaryStore: new FileSummaryStore(dataDir),
		eventLog: new FileEventLog(dataDir),
	};
}

async function main(): Promise<void> {
	const dataDir = resolve(process.env.DATA_DIR || "./data");
	const port = Number.parseInt(process.env.PORT || "3000", 10);
	const ctx = createContext(dataDir);

	// Subscribe to all events for logging
	ctx.eventLog.subscribe((event) => {
		console.log(`[event] ${event.type}`, JSON.stringify(event));
	});

	// Dynamic import to avoid circular dependency
	const { createHttpServer } = await import("./http.js");
	createHttpServer(ctx, port);

	console.log("Voice Orchestrator v2 — Phase 2: Realtime Hot Path");
	console.log(`  Data directory: ${dataDir}`);
	console.log(`  API key: ${process.env.OPENAI_API_KEY ? "set" : "NOT SET"}`);
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
