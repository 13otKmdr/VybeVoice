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
	const ctx = createContext(dataDir);

	// Subscribe to all events for logging
	ctx.eventLog.subscribe((event) => {
		console.log(`[event] ${event.type}`, JSON.stringify(event));
	});

	console.log("Voice Orchestrator v2 started");
	console.log(`  Data directory: ${dataDir}`);
	console.log(`  Stores: sessions, tasks, artifacts, summaries, events`);
	console.log();
	console.log("Phase 1 complete — core domain, stores, and transport ready.");
	console.log("Phase 2 will add: Merlin orchestrator, OpenAI Realtime connection, barge-in handling.");

	// Keep the process alive
	// Phase 2: replace with HTTP server + WebSocket listener
	await new Promise(() => {});
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
