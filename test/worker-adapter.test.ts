import { describe, expect, it } from "vitest";
import {
  RecordedWorkerAdapter,
  SubscriptionWorkerAdapter,
  WorkerResultError,
  WorkerResultGate,
  type WorkerRequest,
} from "../src/worker-adapter.js";

const request: WorkerRequest = {
  missionId: "mission-1",
  taskId: "task-1",
  attemptId: "attempt-1",
  objective: "Inspect the recorded workflow evidence.",
  workerRole: "EVIDENCE_RESEARCHER",
  maxCost: 3,
};

const validResult = {
  taskId: request.taskId,
  attemptId: request.attemptId,
  status: "COMPLETED" as const,
  finding: "Recorded evidence is internally consistent.",
};

describe("dry-run worker adapter boundary", () => {
  it("rejects subscription execution deterministically after request validation", async () => {
    await expect(new SubscriptionWorkerAdapter().run(request)).rejects.toMatchObject({
      code: "SUBSCRIPTION_EXECUTION_DISABLED",
      message: "Live subscription execution is disabled.",
    });
  });
  it("returns a valid recorded result after strict validation", async () => {
    const gate = new WorkerResultGate();
    const adapter = new RecordedWorkerAdapter(new Map([[request.attemptId, validResult]]));

    await expect(gate.run(adapter, request)).resolves.toEqual(validResult);
  });

  it("rejects malformed and extra-field output", async () => {
    const gate = new WorkerResultGate();
    const adapter = new RecordedWorkerAdapter({
      [request.attemptId]: { ...validResult, confidence: 0.9 },
    });

    await expect(gate.run(adapter, request)).rejects.toMatchObject({ code: "INVALID_RESULT" });
  });

  it("rejects output whose task or attempt identity does not match", async () => {
    const gate = new WorkerResultGate();
    const taskMismatch = new RecordedWorkerAdapter({
      [request.attemptId]: { ...validResult, taskId: "other-task" },
    });
    await expect(gate.run(taskMismatch, request)).rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });

    const attemptMismatch = new RecordedWorkerAdapter({
      [request.attemptId]: { ...validResult, attemptId: "other-attempt" },
    });
    await expect(gate.run(attemptMismatch, request)).rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });
  });

  it("fails when no recorded result exists", async () => {
    const adapter = new RecordedWorkerAdapter(new Map());

    await expect(adapter.run(request)).rejects.toMatchObject({
      code: "MISSING_RESULT",
    } satisfies Partial<WorkerResultError>);
  });

  it("rejects the same attempt after its first accepted result", async () => {
    const gate = new WorkerResultGate();
    const adapter = new RecordedWorkerAdapter(new Map([[request.attemptId, validResult]]));

    await gate.run(adapter, request);
    await expect(gate.run(adapter, request)).rejects.toMatchObject({ code: "DUPLICATE_RESULT" });
  });

  it("has no persistence dependency in the adapter boundary", async () => {
    const adapter = new RecordedWorkerAdapter(new Map([[request.attemptId, validResult]]));
    await expect(adapter.run(request)).resolves.toEqual(validResult);
  });
});
