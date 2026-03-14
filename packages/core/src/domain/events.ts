import type { SessionRecord, TaskRecord, TaskResult, TaskStatus } from "./types.js";

// ── Base ─────────────────────────────────────────────────────────────────────

export interface DomainEventBase {
	eventId: string;
	timestamp: number;
}

// ── Session events ───────────────────────────────────────────────────────────

export interface SessionStarted extends DomainEventBase {
	type: "session.started";
	session: SessionRecord;
}

export interface SessionEnded extends DomainEventBase {
	type: "session.ended";
	sessionId: string;
	reason: "user" | "timeout" | "error";
}

export interface SessionReconnected extends DomainEventBase {
	type: "session.reconnected";
	sessionId: string;
}

// ── Turn events ──────────────────────────────────────────────────────────────

export interface TurnStarted extends DomainEventBase {
	type: "turn.started";
	sessionId: string;
	turnId: string;
	transcript?: string;
}

export interface TurnEnded extends DomainEventBase {
	type: "turn.ended";
	sessionId: string;
	turnId: string;
	transcript: string;
	intent: IntentClassification;
}

// ── Task events ──────────────────────────────────────────────────────────────

export interface TaskCreated extends DomainEventBase {
	type: "task.created";
	task: TaskRecord;
}

export interface TaskStatusChanged extends DomainEventBase {
	type: "task.status_changed";
	taskId: string;
	previousStatus: TaskStatus;
	newStatus: TaskStatus;
}

export interface TaskCompleted extends DomainEventBase {
	type: "task.completed";
	taskId: string;
	result?: TaskResult;
}

export interface TaskFailed extends DomainEventBase {
	type: "task.failed";
	taskId: string;
	error: string;
}

// ── Assistant events ─────────────────────────────────────────────────────────

export interface AssistantSpeaking extends DomainEventBase {
	type: "assistant.speaking";
	sessionId: string;
	text: string;
	source: "direct" | "notification" | "acknowledgment";
}

export interface AssistantInterrupted extends DomainEventBase {
	type: "assistant.interrupted";
	sessionId: string;
}

// ── Intent ───────────────────────────────────────────────────────────────────

export interface IntentClassification {
	kind: "direct_answer" | "delegated_task";
	confidence: number;
	taskKind?: string;
	summary: string;
}

// ── Union ────────────────────────────────────────────────────────────────────

export type DomainEvent =
	| SessionStarted
	| SessionEnded
	| SessionReconnected
	| TurnStarted
	| TurnEnded
	| TaskCreated
	| TaskStatusChanged
	| TaskCompleted
	| TaskFailed
	| AssistantSpeaking
	| AssistantInterrupted;
