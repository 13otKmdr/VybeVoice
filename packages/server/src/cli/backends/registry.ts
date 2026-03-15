import type { SpecialistRunner } from "@voice-orchestrator/core";
import type { BackendName, BackendOptions } from "../config.js";

export type BackendFactory = (options: BackendOptions) => SpecialistRunner;

const factories = new Map<BackendName, () => Promise<BackendFactory>>();

// Lazy-load backends to avoid pulling in unused dependencies
factories.set("openclaw", async () => {
	const { createOpenClawSpecialist } = await import("./openclaw.js");
	return createOpenClawSpecialist;
});

factories.set("claude-code", async () => {
	const { createClaudeCodeSpecialist } = await import("./claude-code.js");
	return createClaudeCodeSpecialist;
});

factories.set("codex", async () => {
	const { createCodexSpecialist } = await import("./codex.js");
	return createCodexSpecialist;
});

factories.set("pyagent", async () => {
	const { createPyAgentSpecialist } = await import("./pyagent.js");
	return createPyAgentSpecialist;
});

factories.set("custom", async () => {
	const { createCustomSpecialist } = await import("./custom.js");
	return createCustomSpecialist;
});

export async function createBackendSpecialist(
	backend: BackendName,
	options: BackendOptions,
): Promise<SpecialistRunner> {
	const loader = factories.get(backend);
	if (!loader) {
		throw new Error(`Unknown backend: ${backend}`);
	}
	const factory = await loader();
	return factory(options);
}
