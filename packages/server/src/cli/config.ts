import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// ── Paths ───────────────────────────────────────────────────────────────────

export const CONFIG_DIR = join(homedir(), ".vybevoice");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");

// ── Backend option types ────────────────────────────────────────────────────

export interface OpenClawOptions {
	url: string;
	token: string;
	agentId: string;
}

export interface ClaudeCodeOptions {
	binaryPath: string;
	workingDirectory: string;
	model?: string;
}

export interface CodexOptions {
	apiKey: string;
	workingDirectory: string;
	model?: string;
}

export interface PyAgentOptions {
	url: string;
	token: string;
}

export interface CustomOptions {
	url: string;
	authHeader?: string;
	headers?: Record<string, string>;
}

// ── Backend name union ──────────────────────────────────────────────────────

export type BackendName = "openclaw" | "claude-code" | "codex" | "pyagent" | "custom";

export type BackendOptions = OpenClawOptions | ClaudeCodeOptions | CodexOptions | PyAgentOptions | CustomOptions;

// ── Config schema ───────────────────────────────────────────────────────────

export interface VybeVoiceConfig {
	version: 1;
	voice: {
		provider: "minimax" | "openai";
		apiKey: string;
		model?: string;
		voiceName?: string;
	};
	agent: {
		backend: BackendName;
		options: BackendOptions;
	};
	server: {
		port: number;
		dataDir: string;
	};
}

// ── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_CONFIG: VybeVoiceConfig = {
	version: 1,
	voice: {
		provider: "minimax",
		apiKey: "",
	},
	agent: {
		backend: "openclaw",
		options: {
			url: "http://127.0.0.1:18789",
			token: "",
			agentId: "main",
		} satisfies OpenClawOptions,
	},
	server: {
		port: 3000,
		dataDir: "./data",
	},
};

// ── Load / Save ─────────────────────────────────────────────────────────────

export async function loadConfig(): Promise<VybeVoiceConfig | null> {
	if (!existsSync(CONFIG_PATH)) return null;
	try {
		const raw = await readFile(CONFIG_PATH, "utf-8");
		return JSON.parse(raw) as VybeVoiceConfig;
	} catch {
		return null;
	}
}

export async function saveConfig(config: VybeVoiceConfig): Promise<void> {
	await mkdir(CONFIG_DIR, { recursive: true });
	await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

// ── Resolve (merge: flags > env > file > defaults) ─────────────────────────

export async function resolveConfig(overrides?: Partial<VybeVoiceConfig>): Promise<VybeVoiceConfig> {
	const file = await loadConfig();
	const base = file ?? { ...DEFAULT_CONFIG };

	// Apply env var overrides
	if (process.env.MINIMAX_API_KEY) {
		base.voice.provider = "minimax";
		base.voice.apiKey = process.env.MINIMAX_API_KEY;
	} else if (process.env.OPENAI_API_KEY && !base.voice.apiKey) {
		base.voice.provider = "openai";
		base.voice.apiKey = process.env.OPENAI_API_KEY;
	}

	if (process.env.OPENCLAW_GATEWAY_URL && base.agent.backend === "openclaw") {
		(base.agent.options as OpenClawOptions).url = process.env.OPENCLAW_GATEWAY_URL;
	}
	if (process.env.OPENCLAW_GATEWAY_TOKEN && base.agent.backend === "openclaw") {
		(base.agent.options as OpenClawOptions).token = process.env.OPENCLAW_GATEWAY_TOKEN;
	}

	if (process.env.PORT) {
		base.server.port = Number.parseInt(process.env.PORT, 10);
	}
	if (process.env.DATA_DIR) {
		base.server.dataDir = process.env.DATA_DIR;
	}

	// Apply programmatic overrides (CLI flags)
	if (overrides?.voice) Object.assign(base.voice, overrides.voice);
	if (overrides?.agent) Object.assign(base.agent, overrides.agent);
	if (overrides?.server) Object.assign(base.server, overrides.server);

	return base as VybeVoiceConfig;
}

// ── Validate ────────────────────────────────────────────────────────────────

export function validateConfig(config: VybeVoiceConfig): string[] {
	const errors: string[] = [];

	if (!config.voice.apiKey) {
		errors.push(`Voice API key is required (provider: ${config.voice.provider})`);
	}

	if (config.agent.backend === "openclaw") {
		const opts = config.agent.options as OpenClawOptions;
		if (!opts.url) errors.push("OpenClaw gateway URL is required");
	} else if (config.agent.backend === "claude-code") {
		const opts = config.agent.options as ClaudeCodeOptions;
		if (!opts.binaryPath) errors.push("Claude Code binary path is required");
	} else if (config.agent.backend === "codex") {
		const opts = config.agent.options as CodexOptions;
		if (!opts.apiKey) errors.push("Codex API key is required");
	} else if (config.agent.backend === "pyagent") {
		const opts = config.agent.options as PyAgentOptions;
		if (!opts.url) errors.push("Pi Agent URL is required");
	} else if (config.agent.backend === "custom") {
		const opts = config.agent.options as CustomOptions;
		if (!opts.url) errors.push("Custom backend URL is required");
	}

	return errors;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function maskKey(key: string): string {
	if (key.length <= 8) return "****";
	return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

export function configExists(): boolean {
	return existsSync(CONFIG_PATH);
}
