import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const tempHome = mkdtempSync(join(tmpdir(), "vybevoice-cli-config-"));
const originalHome = process.env.HOME;
process.env.HOME = tempHome;

const configModule = await import("../src/cli/config.ts");
const { CONFIG_DIR, DEFAULT_CONFIG, resolveConfig, saveConfig } = configModule;

test.after(() => {
	if (originalHome === undefined) {
		delete process.env.HOME;
	} else {
		process.env.HOME = originalHome;
	}
	rmSync(tempHome, { recursive: true, force: true });
});

test.beforeEach(() => {
	rmSync(CONFIG_DIR, { recursive: true, force: true });
	delete process.env.OPENCLAW_GATEWAY_URL;
	delete process.env.OPENCLAW_GATEWAY_TOKEN;
	delete process.env.MINIMAX_API_KEY;
	delete process.env.OPENAI_API_KEY;
	delete process.env.PORT;
	delete process.env.DATA_DIR;
});

test("resolveConfig resets agent options when a backend override changes the backend", async () => {
	const savedConfig = {
		...DEFAULT_CONFIG,
		voice: {
			provider: "minimax",
			apiKey: "voice-key",
		},
		agent: {
			backend: "claude-code",
			options: {
				binaryPath: "/usr/local/bin/claude",
				workingDirectory: "/tmp/claude",
				model: "sonnet",
			},
		},
	} satisfies typeof DEFAULT_CONFIG;
	await saveConfig(savedConfig);

	const resolved = await resolveConfig({
		agent: {
			backend: "codex",
		},
	});

	assert.equal(resolved.agent.backend, "codex");
	assert.deepEqual(resolved.agent.options, {
		apiKey: "",
		workingDirectory: process.cwd(),
		model: "codex-mini",
	});
});

test("resolveConfig applies OpenClaw env overrides after switching backends", async () => {
	const savedConfig = {
		...DEFAULT_CONFIG,
		voice: {
			provider: "minimax",
			apiKey: "voice-key",
		},
		agent: {
			backend: "pyagent",
			options: {
				url: "http://127.0.0.1:9000",
				token: "saved-token",
			},
		},
	} satisfies typeof DEFAULT_CONFIG;
	await saveConfig(savedConfig);

	process.env.OPENCLAW_GATEWAY_URL = "http://127.0.0.1:19999";
	process.env.OPENCLAW_GATEWAY_TOKEN = "env-token";

	const resolved = await resolveConfig({
		agent: {
			backend: "openclaw",
		},
	});

	assert.equal(resolved.agent.backend, "openclaw");
	assert.deepEqual(resolved.agent.options, {
		url: "http://127.0.0.1:19999",
		token: "env-token",
		agentId: "main",
	});
});
