import type { IntentClassification } from "../domain/events.js";

const TASK_PATTERNS: Array<{ pattern: RegExp; taskKind: string }> = [
	{ pattern: /\b(build|create|make|design|code|implement|scaffold)\b/i, taskKind: "builder" },
	{ pattern: /\b(research|analyze|investigate|find out|look into|compare)\b/i, taskKind: "research" },
	{ pattern: /\b(growth|market|campaign|outreach|funnel|convert)\b/i, taskKind: "growth" },
	{ pattern: /\b(deploy|monitor|migrate|backup|provision|ops)\b/i, taskKind: "ops" },
];

/**
 * Phase 1: heuristic intent classification.
 * Phase 2: replace with LLM-based classification.
 */
export function classifyIntent(transcript: string): IntentClassification {
	for (const { pattern, taskKind } of TASK_PATTERNS) {
		if (pattern.test(transcript)) {
			return {
				kind: "delegated_task",
				confidence: 0.6,
				taskKind,
				summary: transcript,
			};
		}
	}

	return {
		kind: "direct_answer",
		confidence: 0.8,
		summary: transcript,
	};
}
