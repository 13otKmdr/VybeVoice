// ── Session ──────────────────────────────────────────────────────────────────

export interface SessionRecord {
	id: string;
	userId: string;
	startedAt: number;
	lastActiveAt: number;
	state: "active" | "idle" | "disconnected" | "ended";
	metadata: Record<string, unknown>;
}

// ── Task ─────────────────────────────────────────────────────────────────────

export type TaskStatus = "queued" | "starting" | "running" | "waiting_for_input" | "completed" | "failed" | "cancelled";

export interface TaskResult {
	summary: string;
	artifactIds: string[];
}

export interface TaskRecord {
	id: string;
	sessionId: string;
	kind: string;
	intent: string;
	status: TaskStatus;
	createdAt: number;
	updatedAt: number;
	result?: TaskResult;
	error?: string;
	retryCount: number;
	maxRetries: number;
	timeoutMs: number;
	metadata: Record<string, unknown>;
}

// ── Artifact ─────────────────────────────────────────────────────────────────

export type ArtifactKind = "code" | "document" | "data" | "image" | "log";

export interface ArtifactRecord {
	id: string;
	taskId: string;
	sessionId: string;
	kind: ArtifactKind;
	name: string;
	path: string;
	mimeType: string;
	createdAt: number;
	sizeBytes: number;
	metadata: Record<string, unknown>;
}

// ── Summary ──────────────────────────────────────────────────────────────────

export interface SummaryRecord {
	id: string;
	sessionId: string;
	taskId?: string;
	content: string;
	createdAt: number;
	tokenCount: number;
}
