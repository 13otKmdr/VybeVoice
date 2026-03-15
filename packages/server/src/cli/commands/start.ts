import { resolve } from "node:path";
import type { Command } from "commander";
import ora from "ora";
import { createBackendSpecialist } from "../backends/registry.js";
import { resolveConfig, type VybeVoiceConfig, validateConfig } from "../config.js";
import { error, hint, printBanner, printSummary, success } from "../ui.js";

export function registerStartCommand(program: Command): void {
	program
		.command("start")
		.description("Start the VybeVoice server")
		.option("-p, --port <number>", "HTTP server port")
		.option("--provider <provider>", "Voice provider (minimax or openai)")
		.option("--backend <backend>", "Agent backend")
		.option("--data-dir <path>", "Data directory")
		.action(async (opts) => {
			printBanner();

			// Build overrides from CLI flags
			const overrides: Partial<VybeVoiceConfig> = {};
if (opts.port) {
	overrides.server = { ...overrides.server, port: Number.parseInt(opts.port, 10) };
}
if (opts.provider) overrides.voice = { provider: opts.provider, apiKey: "" };
if (opts.dataDir) {
	overrides.server = { ...overrides.server, dataDir: opts.dataDir };
}

			const config = await resolveConfig(overrides);

			// Check if we have meaningful config
			const errors = validateConfig(config);
			if (errors.length > 0) {
				for (const msg of errors) error(msg);
				console.log();
				hint("Run `vybevoice init` to set up your configuration.");
				process.exit(1);
			}

			const dataDir = resolve(config.server.dataDir);
			const port = config.server.port;

			// Show what we're starting with
			printSummary("Starting VybeVoice", [
				["Voice", config.voice.provider],
				["Agent", config.agent.backend],
				["Port", String(port)],
				["Data", dataDir],
			]);

			// Set environment variables so the existing server code can find them
			if (config.voice.provider === "minimax") {
				process.env.MINIMAX_API_KEY = config.voice.apiKey;
			} else {
				process.env.OPENAI_API_KEY = config.voice.apiKey;
			}
			process.env.PORT = String(port);
			process.env.DATA_DIR = dataDir;

			const spinner = ora("Initializing...").start();

			try {
				// Import server internals
				const { createContext } = await import("../../main.js");
				const ctx = createContext(dataDir);

				// Subscribe to all events for logging
				ctx.eventLog.subscribe((_event) => {
					// Event logging hook — can be extended
				});

				// Create specialist from configured backend
				const specialist = await createBackendSpecialist(config.agent.backend, config.agent.options);

				// Import TaskManager and set up
				const { TaskManager } = await import("../../task-manager.js");
				const taskManager = new TaskManager({
					taskStore: ctx.taskStore,
					eventLog: ctx.eventLog,
					specialists: [specialist],
					pollIntervalMs: 2000,
				});

				ctx.taskManager = taskManager;
				taskManager.start();

				// Start HTTP server
				const { createHttpServer } = await import("../../http.js");
				createHttpServer(ctx, port);

				spinner.stop();
				success(`VybeVoice is running on port ${port}`);
				hint("Press Ctrl+C to stop.");
			} catch (err) {
				spinner.stop();
				const message = err instanceof Error ? err.message : String(err);
				error(`Failed to start: ${message}`);
				process.exit(1);
			}
		});
}
