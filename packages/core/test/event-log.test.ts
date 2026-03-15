import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileEventLog } from "../src/stores/event-log.ts";

function createTask(taskId: string, sessionId: string) {
	return {
		id: taskId,
		sessionId,
		kind: "general",
		intent: `intent for ${taskId}`,
		status: "queued" as const,
		createdAt: 1,
		updatedAt: 1,
		retryCount: 0,
		maxRetries: 3,
		timeoutMs: 300_000,
		metadata: {},
	};
}

test("query({ sessionId }) keeps task lifecycle events scoped to their session", async () => {
	const dataDir = mkdtempSync(join(tmpdir(), "vybevoice-event-log-"));
	const eventsDir = join(dataDir, "events");
	mkdirSync(eventsDir, { recursive: true });

	try {
		const timestamp = Date.UTC(2026, 2, 15, 12, 0, 0);
		const filePath = join(eventsDir, "2026-03-15.jsonl");
		const lines = [
			{
				type: "task.created",
				eventId: "evt_task_1_created",
				timestamp,
				sessionId: "session-1",
				task: createTask("task-1", "session-1"),
			},
			{
				type: "task.status_changed",
				eventId: "evt_task_1_running",
				timestamp: timestamp + 1,
				taskId: "task-1",
				previousStatus: "queued",
				newStatus: "running",
			},
			{
				type: "task.completed",
				eventId: "evt_task_1_done",
				timestamp: timestamp + 2,
				taskId: "task-1",
				result: {
					summary: "done",
					artifactIds: [],
				},
			},
			{
				type: "task.created",
				eventId: "evt_task_2_created",
				timestamp: timestamp + 3,
				sessionId: "session-2",
				task: createTask("task-2", "session-2"),
			},
			{
				type: "task.failed",
				eventId: "evt_task_2_failed",
				timestamp: timestamp + 4,
				taskId: "task-2",
				error: "boom",
			},
		];

		writeFileSync(filePath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf-8");

		const eventLog = new FileEventLog(dataDir);

		const sessionOneEvents = await eventLog.query({ sessionId: "session-1" });
		assert.deepEqual(
			sessionOneEvents.map((event) => event.eventId),
			["evt_task_1_created", "evt_task_1_running", "evt_task_1_done"],
		);

		const sessionTwoEvents = await eventLog.query({ sessionId: "session-2" });
		assert.deepEqual(sessionTwoEvents.map((event) => event.eventId), ["evt_task_2_created", "evt_task_2_failed"]);
	} finally {
		rmSync(dataDir, { recursive: true, force: true });
	}
});
