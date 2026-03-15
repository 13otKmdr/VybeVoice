import { unlink } from "node:fs/promises";
import { confirm, select } from "@inquirer/prompts";
import type { Command } from "commander";
import { CONFIG_PATH, configExists, loadConfig, maskKey, saveConfig, type VybeVoiceConfig } from "../config.js";
import { error, hint, printBanner, printSummary, success, warn } from "../ui.js";

export function registerConfigureCommand(program: Command): void {
	const cmd = program.command("configure").description("View or modify VybeVoice settings");

	cmd.command("show")
		.description("Display current configuration")
		.action(async () => {
			printBanner();
			const config = await loadConfig();
			if (!config) {
				error("No configuration found. Run `vybevoice init` first.");
				return;
			}
			displayConfig(config);
		});

	cmd.command("reset")
		.description("Delete configuration and start fresh")
		.action(async () => {
			printBanner();
			if (!configExists()) {
				warn("No configuration file to delete.");
				return;
			}

			const confirmed = await confirm({
				message: "Delete your VybeVoice configuration? This cannot be undone.",
				default: false,
			});

			if (!confirmed) {
				hint("Configuration preserved.");
				return;
			}

			await unlink(CONFIG_PATH);
			success("Configuration deleted. Run `vybevoice init` to set up again.");
		});

	cmd.command("voice")
		.description("Reconfigure voice provider settings")
		.action(async () => {
			const config = await loadConfig();
			if (!config) {
				error("No configuration found. Run `vybevoice init` first.");
				return;
			}

			const { password, select: selectPrompt } = await import("@inquirer/prompts");

			const provider = await selectPrompt({
				message: "Select your voice provider",
				default: config.voice.provider,
				choices: [
					{ name: "MiniMax (recommended)", value: "minimax" as const },
					{ name: "OpenAI (Realtime API)", value: "openai" as const },
				],
			});

			const label = provider === "minimax" ? "MiniMax" : "OpenAI";
			const apiKey = await password({
				message: `Enter your ${label} API key`,
				mask: "*",
			});

			if (!apiKey) {
				error("API key is required.");
				return;
			}

			config.voice.provider = provider;
			config.voice.apiKey = apiKey;
			await saveConfig(config);
			success("Voice settings updated.");
		});

	cmd.command("agent")
		.description("Reconfigure agent backend settings")
		.action(async () => {
			const config = await loadConfig();
			if (!config) {
				error("No configuration found. Run `vybevoice init` first.");
				return;
			}

			// Re-use the init wizard's backend prompts
			const { registerInitCommand: _ } = await import("./init.js");
			const { select: selectPrompt } = await import("@inquirer/prompts");

			const backend = await selectPrompt({
				message: "Select your agent backend",
				default: config.agent.backend,
				choices: [
					{ name: "OpenClaw (local gateway — recommended)", value: "openclaw" as const },
					{ name: "Claude Code (Anthropic's coding agent CLI)", value: "claude-code" as const },
					{ name: "Codex (OpenAI's coding agent)", value: "codex" as const },
					{ name: "Pi Agent (custom Python agent)", value: "pyagent" as const },
					{ name: "Custom (HTTP endpoint)", value: "custom" as const },
				],
			});

			hint("Please provide the settings for the selected backend:");

			// Inline prompt for agent options based on backend type
			const agentOptions = await promptBackendOptionsInline(backend);
			config.agent.backend = backend;
			config.agent.options = agentOptions;
			await saveConfig(config);
			success("Agent backend updated.");
		});

	cmd.command("server")
		.description("Reconfigure server settings")
		.action(async () => {
			const config = await loadConfig();
			if (!config) {
				error("No configuration found. Run `vybevoice init` first.");
				return;
			}

			const { input } = await import("@inquirer/prompts");

			const portStr = await input({
				message: "HTTP server port",
				default: String(config.server.port),
			});
			const dataDir = await input({
				message: "Data directory",
				default: config.server.dataDir,
			});

			config.server.port = Number.parseInt(portStr, 10) || 3000;
			config.server.dataDir = dataDir;
			await saveConfig(config);
			success("Server settings updated.");
		});

	// Default action: show interactive menu
	cmd.action(async () => {
		printBanner();
		const config = await loadConfig();
		if (!config) {
			error("No configuration found. Run `vybevoice init` first.");
			return;
		}

		const section = await select({
			message: "What would you like to configure?",
			choices: [
				{ name: "Show current configuration", value: "show" },
				{ name: "Voice provider settings", value: "voice" },
				{ name: "Agent backend settings", value: "agent" },
				{ name: "Server settings", value: "server" },
				{ name: "Reset (delete configuration)", value: "reset" },
			],
		});

		// Re-invoke the subcommand
		await cmd.commands.find((c) => c.name() === section)?.parseAsync([], { from: "user" });
	});
}

// ── Display ─────────────────────────────────────────────────────────────────

function displayConfig(config: VybeVoiceConfig): void {
	const rows: Array<[string, string]> = [
		["Voice provider", config.voice.provider],
		["Voice API key", maskKey(config.voice.apiKey)],
		["Agent backend", config.agent.backend],
	];

	// Backend-specific details
	const opts = config.agent.options;
	if ("url" in opts) rows.push(["Backend URL", (opts as { url: string }).url]);
	if ("binaryPath" in opts) rows.push(["Binary path", (opts as { binaryPath: string }).binaryPath]);
	if ("agentId" in opts) rows.push(["Agent ID", (opts as { agentId: string }).agentId]);

	rows.push(["Port", String(config.server.port)]);
	rows.push(["Data directory", config.server.dataDir]);

	printSummary("Current Configuration", rows);
}

// ── Inline backend option prompts (duplicated minimally from init) ──────────

import { input, password } from "@inquirer/prompts";
import type { BackendName, BackendOptions } from "../config.js";

async function promptBackendOptionsInline(backend: BackendName): Promise<BackendOptions> {
	switch (backend) {
		case "openclaw": {
			const url = await input({ message: "OpenClaw gateway URL", default: "http://127.0.0.1:18789" });
			const token = await password({ message: "Auth token (optional)", mask: "*" });
			const agentId = await input({ message: "Agent ID", default: "main" });
			return { url, token: token || "", agentId };
		}
		case "claude-code": {
			const binaryPath = await input({ message: "Path to claude CLI", default: "claude" });
			const workingDirectory = await input({ message: "Working directory", default: process.cwd() });
			return { binaryPath, workingDirectory };
		}
		case "codex": {
			const apiKey = await password({ message: "OpenAI API key for Codex", mask: "*" });
			const workingDirectory = await input({ message: "Working directory", default: process.cwd() });
			const model = await input({ message: "Model", default: "codex-mini" });
			return { apiKey: apiKey || "", workingDirectory, model };
		}
		case "pyagent": {
			const url = await input({ message: "Pi Agent URL", default: "http://127.0.0.1:8000" });
			const token = await password({ message: "Auth token (optional)", mask: "*" });
			return { url, token: token || "" };
		}
		case "custom": {
			const url = await input({ message: "Custom endpoint URL" });
			const authHeader = await password({ message: "Authorization header (optional)", mask: "*" });
			return { url, ...(authHeader ? { authHeader } : {}) };
		}
	}
}
