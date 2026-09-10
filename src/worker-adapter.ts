import { z } from "zod";

/** The data a scheduler supplies to a worker producer. */
export const workerRequestSchema = z.object({
  missionId: z.string().min(1),
  taskId: z.string().min(1),
  attemptId: z.string().min(1),
  objective: z.string().min(1),
  workerRole: z.string().min(1),
  maxCost: z.number().int().positive(),
}).strict();

export type WorkerRequest = z.infer<typeof workerRequestSchema>;

/** The only shape a worker is allowed to return to the runtime boundary. */
export const structuredWorkerResultSchema = z.object({
  taskId: z.string().min(1),
  attemptId: z.string().min(1),
  status: z.literal("COMPLETED"),
  finding: z.string().min(1),
}).strict();

export type StructuredWorkerResult = z.infer<typeof structuredWorkerResultSchema>;

export type WorkerAdapter = {
  run(request: WorkerRequest): Promise<unknown>;
};

export class WorkerResultError extends Error {
  constructor(
    public readonly code: "INVALID_REQUEST" | "MISSING_RESULT" | "INVALID_RESULT" | "IDENTITY_MISMATCH" | "DUPLICATE_RESULT",
    message: string,
  ) {
    super(message);
    this.name = "WorkerResultError";
  }
}

/**
 * A deterministic producer for local dry runs. It only returns recorded data;
 * persistence and mission state remain owned by the runtime/scheduler.
 */
export class RecordedWorkerAdapter implements WorkerAdapter {
  private readonly results: ReadonlyMap<string, unknown>;

  constructor(recordedResults: ReadonlyMap<string, unknown> | Readonly<Record<string, unknown>>) {
    this.results = recordedResults instanceof Map
      ? recordedResults
      : new Map(Object.entries(recordedResults));
  }

  async run(request: WorkerRequest): Promise<unknown> {
    const parsedRequest = workerRequestSchema.safeParse(request);
    if (!parsedRequest.success) {
      throw new WorkerResultError("INVALID_REQUEST", "Worker request does not match the required shape.");
    }

    if (!this.results.has(parsedRequest.data.attemptId)) {
      throw new WorkerResultError("MISSING_RESULT", `No recorded result exists for attempt ${parsedRequest.data.attemptId}.`);
    }

    return this.results.get(parsedRequest.data.attemptId);
  }
}

/**
 * Runtime-owned acceptance gate. It validates untrusted adapter output,
 * binds identity to the request, and makes accepted delivery idempotence
 * explicit without writing events or changing mission state.
 */
export class WorkerResultGate {
  private readonly acceptedAttemptIds = new Set<string>();

  async run(adapter: WorkerAdapter, request: WorkerRequest): Promise<StructuredWorkerResult> {
    const parsedRequest = workerRequestSchema.safeParse(request);
    if (!parsedRequest.success) {
      throw new WorkerResultError("INVALID_REQUEST", "Worker request does not match the required shape.");
    }

    const { attemptId } = parsedRequest.data;
    if (this.acceptedAttemptIds.has(attemptId)) {
      throw new WorkerResultError("DUPLICATE_RESULT", `A result was already accepted for attempt ${attemptId}.`);
    }

    const rawResult = await adapter.run(parsedRequest.data);
    const parsedResult = structuredWorkerResultSchema.safeParse(rawResult);
    if (!parsedResult.success) {
      throw new WorkerResultError("INVALID_RESULT", "Worker output does not match the strict structured result shape.");
    }

    if (parsedResult.data.taskId !== parsedRequest.data.taskId || parsedResult.data.attemptId !== attemptId) {
      throw new WorkerResultError("IDENTITY_MISMATCH", "Worker output identity does not match the runtime request.");
    }

    this.acceptedAttemptIds.add(attemptId);
    return parsedResult.data;
  }
}
