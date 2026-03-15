import { confirm, input, password, select } from "@inquirer/prompts";
import type { Command } from "commander";
import {
	type BackendName,
	type BackendOptions,
	type ClaudeCodeOptions,
	type CodexOptions,
	type CustomOptions,
	configExists,
	type OpenClawOptions,
	type PyAgentOptions,
	saveConfig,
	type VybeVoiceConfig,
} from "../config.js";
import { error, hint, printBanner, printSummary, success, warn } from "../ui.js";

export function registerInitCommand(program: Command): void {
	program
		.command("init")
		.description("Set up VybeVoice with an interactive wizard")
		.action(async () => {
			printBanner();

			if (configExists()) {
				const overwrite = await confirm({
					message: "A configuration already exists. Overwrite it?",
					default: false,
				});
				if (!overwrite) {
					hint("Run `vybevoice configure` to modify specific settings.");
					return;
				}
			}

			console.log("  Let's set up your configuration.\n");

			// ── Stage 1: Voice provider ─────────────────────────────────

			const voiceProvider = await select({
				message: "Select your voice provider",
				choices: [
					{ name: "MiniMax (recommended — low latency, natural voices)", value: "minimax" as const },
					{ name: "OpenAI (GPT-4o Realtime API)", value: "openai" as const },
				],
			});

			const providerLabel = voiceProvider === "minimax" ? "MiniMax" : "OpenAI";
			const voiceApiKey = await password({
				message: `Enter your ${providerLabel} API key`,
				mask: "*",
			});

			if (!voiceApiKey) {
				error("API key is required. Run `vybevoice init` again when you have one.");
				return;
			}

			success("API key saved.");

			// ── Stage 2: Agent backend ──────────────────────────────────

			console.log();
			const backend = await select<BackendName>({
				message: "Select your agent backend",
				choices: [
					{ name: "OpenClaw (local gateway — recommended)", value: "openclaw" },
					{ name: "Claude Code (Anthropic's coding agent CLI)", value: "claude-code" },
					{ name: "Codex (OpenAI's coding agent)", value: "codex" },
					{ name: "Pi Agent (custom Python agent)", value: "pyagent" },
					{ name: "Custom (HTTP endpoint)", value: "custom" },
				],
			});

			const agentOptions = await promptBackendOptions(backend);

			// ── Stage 3: Server settings ────────────────────────────────

			console.log();
			const portStr = await input({
				message: "HTTP server port",
				default: "3000",
			});
			const port = Number.parseInt(portStr, 10) || 3000;

			const dataDir = await input({
				message: "Data directory",
				default: "./data",
			});

			// ── Summary & confirm ───────────────────────────────────────

			const backendLabel = getBackendLabel(backend, agentOptions);

			printSummary("Configuration Summary", [
				["Voice", `${providerLabel}`],
				["Agent", backendLabel],
				["Port", String(port)],
				["Data", dataDir],
			]);

			const confirmed = await confirm({
				message: "Save configuration?",
				default: true,
			});

			if (!confirmed) {
				warn("Configuration not saved.");
				return;
			}

			const config: VybeVoiceConfig = {
				version: 1,
				voice: {
					provider: voiceProvider,
					apiKey: voiceApiKey,
				},
				agent: {
					backend,
					options: agentOptions,
				},
				server: { port, dataDir },
			};

			await saveConfig(config);
			success("Configuration saved to ~/.vybevoice/config.json");
			console.log();
			hint("Run `vybevoice start` to begin.");
		});
}

// ── Backend-specific prompts ────────────────────────────────────────────────

async function promptBackendOptions(backend: BackendName): Promise<BackendOptions> {
	switch (backend) {
		case "openclaw":
			return promptOpenClaw();
		case "claude-code":
			return promptClaudeCode();
		case "codex":
			return promptCodex();
		case "pyagent":
			return promptPyAgent();
		case "custom":
			return promptCustom();
	}
}

async function promptOpenClaw(): Promise<OpenClawOptions> {
	const url = await input({
		message: "OpenClaw gateway URL",
		default: "http://127.0.0.1:18789",
	});
	const token = await password({
		message: "OpenClaw auth token (optional)",
		mask: "*",
	});
	const agentId = await input({
		message: "OpenClaw agent ID",
		default: "main",
	});
	return { url, token: token || "", agentId };
}

async function promptClaudeCode(): Promise<ClaudeCodeOptions> {
	const binaryPath = await input({
		message: "Path to claude CLI binary",
		default: "claude",
	});
	const workingDirectory = await input({
		message: "Working directory for Claude Code sessions",
		default: process.cwd(),
	});
	const model = await input({
		message: "Model override (optional, press Enter to skip)",
		default: "",
	});
	return { binaryPath, workingDirectory, ...(model ? { model } : {}) };
}

async function promptCodex(): Promise<CodexOptions> {
	const apiKey = await password({
		message: "OpenAI API key for Codex",
		mask: "*",
	});
	const workingDirectory = await input({
		message: "Working directory for Codex sessions",
		default: process.cwd(),
	});
	const model = await input({
		message: "Model (default: codex-mini)",
		default: "codex-mini",
	});
	return { apiKey: apiKey || "", workingDirectory, model };
}

async function promptPyAgent(): Promise<PyAgentOptions> {
	const url = await input({
		message: "Pi Agent server URL",
		default: "http://127.0.0.1:8000",
	});
	const token = await password({
		message: "Auth token (optional)",
		mask: "*",
	});
	return { url, token: token || "" };
}

async function promptCustom(): Promise<CustomOptions> {
	const url = await input({
		message: "Custom endpoint URL",
	});
	const authHeader = await password({
		message: "Authorization header value (optional)",
		mask: "*",
	});
	return { url, ...(authHeader ? { authHeader } : {}) };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getBackendLabel(backend: BackendName, options: BackendOptions): string {
	switch (backend) {
		case "openclaw": {
			const opts = options as OpenClawOptions;
			return `OpenClaw @ ${opts.url}`;
		}
		case "claude-code":
			return "Claude Code";
		case "codex":
			return "Codex";
		case "pyagent": {
			const opts = options as PyAgentOptions;
			return `Pi Agent @ ${opts.url}`;
		}
		case "custom": {
			const opts = options as CustomOptions;
			return `Custom @ ${opts.url}`;
		}
	}
}
