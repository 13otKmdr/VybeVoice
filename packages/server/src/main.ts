import {
	FileArtifactStore,
	FileEventLog,
	FileSessionStore,
	FileSummaryStore,
	FileTaskStore,
} from "@voice-orchestrator/core";
import { resolve } from "path";
import { BuilderSpecialist } from "./specialists/builder.js";
import { TaskManager } from "./task-manager.js";

export interface OrchestratorContext {
	dataDir: string;
	sessionStore: FileSessionStore;
	taskStore: FileTaskStore;
	artifactStore: FileArtifactStore;
	summaryStore: FileSummaryStore;
	eventLog: FileEventLog;
	taskManager?: TaskManager;
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
		// console.log(`[event] ${event.type}`, JSON.stringify(event));
	});

	// Instantiate capabilities
	const builderSpecialist = new BuilderSpecialist();
	
	const taskManager = new TaskManager({
		taskStore: ctx.taskStore,
		eventLog: ctx.eventLog,
		specialists: [builderSpecialist],
		pollIntervalMs: 2000
	});

	ctx.taskManager = taskManager;
	taskManager.start();

	// Dynamic import to avoid circular dependency
	const { createHttpServer } = await import("./http.js");
	createHttpServer(ctx, port);

	const provider = process.env.MINIMAX_API_KEY ? "minimax" : process.env.OPENAI_API_KEY ? "openai" : "none";
	console.log("Voice Orchestrator v2 — MiniMax + OpenAI Transport");
	console.log(`  Data directory: ${dataDir}`);
	console.log(`  Voice provider: ${provider}`);
	console.log(`  MINIMAX_API_KEY: ${process.env.MINIMAX_API_KEY ? "set" : "NOT SET"}`);
	console.log(`  OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? "set" : "NOT SET"}`);
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
