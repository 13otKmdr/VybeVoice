import type { RealtimeTool } from "@voice-orchestrator/realtime";

// ── Delegate task tool ───────────────────────────────────────────────────────

export const DELEGATE_TASK_TOOL: RealtimeTool = {
	type: "function",
	name: "delegate_task",
	description:
		"Delegate a complex or long-running task to a specialist agent. " +
		"Use this for requests that require significant work such as building, " +
		"researching, designing, deploying, or any multi-step operation. " +
		"Do NOT use this for simple questions, greetings, or conversational responses.",
	parameters: {
		type: "object",
		properties: {
			kind: {
				type: "string",
				enum: ["builder", "research", "growth", "ops", "general"],
				description: "The category of specialist to handle this task.",
			},
			description: {
				type: "string",
				description: "A clear description of what needs to be done.",
			},
			priority: {
				type: "string",
				enum: ["low", "normal", "high", "urgent"],
				description: "Task priority. Defaults to normal.",
			},
		},
		required: ["kind", "description"],
	},
};

// ── System prompt ────────────────────────────────────────────────────────────

export const MERLIN_SYSTEM_PROMPT = `You are Merlin, a voice assistant. You handle conversations naturally and delegate complex tasks to specialist agents.

Rules:
- For simple questions, greetings, or conversational responses: respond directly.
- For requests that require significant work (building, researching, designing, deploying): call the delegate_task function.
- After delegating, briefly acknowledge what you're starting (e.g., "I've started working on that for you").
- Stay concise — you are a voice assistant, not a text interface.
- Do not attempt to do the delegated work yourself.
- Never mention function calling, tools, or internal mechanics to the user.`;

// ── Argument parsing ─────────────────────────────────────────────────────────

export interface DelegateTaskArgs {
	kind: string;
	description: string;
	priority?: string;
}

export function parseDelegateTaskArgs(raw: string): DelegateTaskArgs {
	const parsed = JSON.parse(raw) as Record<string, unknown>;
	return {
		kind: typeof parsed.kind === "string" ? parsed.kind : "general",
		description: typeof parsed.description === "string" ? parsed.description : String(parsed.description ?? ""),
		priority: typeof parsed.priority === "string" ? parsed.priority : undefined,
	};
}
