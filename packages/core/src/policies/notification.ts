import type { DomainEvent } from "../domain/events.js";

export type NotificationAction =
	| { kind: "speak_immediately"; text: string }
	| { kind: "wait_for_idle"; text: string }
	| { kind: "ui_only"; text: string }
	| { kind: "suppress" };

/**
 * Decides how to surface a domain event to the user based on
 * the event type and current session state.
 */
export function routeNotification(
	event: DomainEvent,
	sessionState: "active" | "idle" | "disconnected" | "ended",
): NotificationAction {
	switch (event.type) {
		case "task.completed":
			if (sessionState === "active") {
				return { kind: "wait_for_idle", text: `Task completed.` };
			}
			return { kind: "ui_only", text: `Task completed.` };

		case "task.failed":
			return { kind: "speak_immediately", text: `A task failed: ${event.error}` };

		case "task.status_changed":
			if (event.newStatus === "waiting_for_input") {
				return { kind: "speak_immediately", text: `A task needs your input.` };
			}
			return { kind: "ui_only", text: `Task status: ${event.newStatus}` };

		case "task.created":
			return { kind: "suppress" };

		default:
			return { kind: "suppress" };
	}
}
