import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, unlink, type FileHandle } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";

import { JsonlEventStore } from "../event-store.js";
import { liveWorkerPilotFixtureId, liveWorkerPilotTask, loadFixture } from "../fixture-model.js";
import { runFixtureMission } from "../fixture-runner.js";
import { missionEventSchema, type MissionEvent } from "../contracts.js";
import { replay } from "../reducer.js";
import { CodexAppServerPreflight, type SubscriptionRuntimePreflight } from "../subscription-runtime-preflight.js";
import { SubscriptionLiveWorkerAuthorization, type SubscriptionLiveWorkerConfirmation } from "../subscription-live-worker-authorization.js";

const fixtureIdSchema = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, "Fixture IDs must be lowercase kebab-case.");
const missionIdSchema = fixtureIdSchema.max(120);
const missionDtoSchema = z.object({
  missionId: missionIdSchema,
  fixtureId: fixtureIdSchema,
  events: z.array(missionEventSchema),
}).strict();
export const subscriptionConfirmationDtoSchema = z.object({
  missionId: missionIdSchema,
  attemptId: z.string().min(1),
  status: z.literal("CONFIRMED"),
  expiresAtMs: z.number().int().nonnegative(),
}).strict();

export type MissionDto = z.infer<typeof missionDtoSchema>;
export type SubscriptionConfirmationDto = z.infer<typeof subscriptionConfirmationDtoSchema>;
export type MissionIdFactory = (fixtureId: string) => string;

export interface LocalMissionRuntimeOptions {
  dataRoot: string;
  createMissionId?: MissionIdFactory;
  subscriptionRuntimePreflight?: SubscriptionRuntimePreflight;
  subscriptionLiveWorkerAuthorization?: SubscriptionLiveWorkerAuthorization;
}

export class MissionLaunchIncompleteError extends Error {
  constructor(missionId: string) {
    super(`Mission launch incomplete: ${missionId}`);
  }
}

/**
 * The sole local boundary allowed to create and reload persisted fixture missions.
 * Its data root is trusted local application storage: Windows Node does not expose
 * a no-follow directory-handle primitive for adversarial filesystem replacement.
 */
export class LocalMissionRuntime {
  private readonly missionsRoot: string;
  private readonly createMissionId: MissionIdFactory;
  private readonly subscriptionRuntimePreflight: SubscriptionRuntimePreflight;
  private readonly subscriptionLiveWorkerAuthorization: SubscriptionLiveWorkerAuthorization;
  private readonly preflightingMissionIds = new Set<string>();

  constructor(options: LocalMissionRuntimeOptions) {
    this.missionsRoot = resolve(options.dataRoot, "missions");
    this.createMissionId = options.createMissionId ?? ((fixtureId) => `${fixtureId}-${randomUUID()}`);
    this.subscriptionRuntimePreflight = options.subscriptionRuntimePreflight ?? new CodexAppServerPreflight();
    this.subscriptionLiveWorkerAuthorization = options.subscriptionLiveWorkerAuthorization ?? new SubscriptionLiveWorkerAuthorization();
  }

  async launch(fixtureId: string): Promise<MissionDto> {
    const fixture = loadFixture(fixtureId);
    const missionId = this.validateMissionId(this.createMissionId(fixture.fixtureId));
    await this.ensureMissionsRoot();
    const historyPath = this.historyPath(missionId);
    const metadataPath = this.metadataPath(missionId);
    const reservationPath = this.reservationPath(missionId);
    await this.assertAbsent(metadataPath, `Mission ID already exists: ${missionId}`);
    await this.assertAbsent(reservationPath, `Mission ID already exists: ${missionId}`);
    await this.assertAbsent(historyPath, `Mission ID already exists: ${missionId}`);
    // The marker is created first so a crash never leaves an unowned history.
    // The event writer is then held open for the whole mission, so later
    // pathname changes cannot redirect any active append.
    await this.reserveMarker(reservationPath, `Mission ID already exists: ${missionId}`, JSON.stringify({ fixtureId: fixture.fixtureId }));
    let historyHandle: FileHandle | undefined;
    try {
      historyHandle = await this.reserveHistory(historyPath, `Mission ID already exists: ${missionId}`);
      const eventStore = new JsonlEventStore(historyPath, historyHandle);
      await runFixtureMission({ fixtureId: fixture.fixtureId, missionId, historyPath, eventStore });
      await historyHandle.datasync();
      await historyHandle.close();
      historyHandle = undefined;
      await this.writeExclusive(metadataPath, JSON.stringify({ fixtureId: fixture.fixtureId }));
      await unlink(reservationPath);
    } catch (error) {
      // The marker is intentionally retained. It prevents a second writer and
      // lets reload expose any valid event prefix after an interrupted launch.
      throw error;
    } finally {
      await historyHandle?.close();
    }
    return this.readDto(missionId, fixture.fixtureId);
  }

  async reload(missionId: string): Promise<MissionDto> {
    const validMissionId = this.validateMissionId(missionId);
    const metadataPath = this.metadataPath(validMissionId);
    await this.ensureMissionsRoot();
    const reservationPath = this.reservationPath(validMissionId);
    if (await exists(reservationPath)) {
      await this.readReservation(validMissionId, reservationPath);
      // A durable reservation is authoritative until the runner has finished,
      // metadata exists, and the marker is removed. Valid event prefixes stay
      // on disk for recovery, but are never presented as a completed mission.
      throw new MissionLaunchIncompleteError(validMissionId);
    }
    let metadata: unknown;
    try {
      await assertNotLink(metadataPath);
      metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    } catch (error: unknown) {
      if (isNotFound(error)) throw new Error(`Mission history not found: ${validMissionId}`);
      throw error;
    }
    const fixtureId = z.object({ fixtureId: fixtureIdSchema }).strict().parse(metadata).fixtureId;
    loadFixture(fixtureId);
    return this.readDto(validMissionId, fixtureId);
  }

  /** A user-triggered, one-shot auth check. It does not start a Codex thread or turn. */
  async preflightSubscriptionRuntime(missionId: string): Promise<MissionDto> {
    const validMissionId = this.validateMissionId(missionId);
    if (this.preflightingMissionIds.has(validMissionId)) throw new Error("Subscription runtime preflight is already in progress.");
    this.preflightingMissionIds.add(validMissionId);
    try {
      const mission = await this.reload(validMissionId);
      const currentState = replay(mission.events);
      if (!currentState.subscriptionRuntimeDeclaration) throw new Error("Subscription runtime is not declared for this mission.");
      if (currentState.subscriptionRuntimePreflight) throw new Error("Subscription runtime preflight is already recorded.");
      const preflight = await this.subscriptionRuntimePreflight.check();
      const events = await new JsonlEventStore(this.historyPath(validMissionId)).readAll();
      const stateBeforeAppend = replay(events);
      if (stateBeforeAppend.subscriptionRuntimePreflight) throw new Error("Subscription runtime preflight is already recorded.");
      const sequenceNumber = events.length + 1;
      await new JsonlEventStore(this.historyPath(validMissionId)).append({
        schemaVersion: 1,
        sequenceNumber,
        missionId: validMissionId,
        eventId: `${validMissionId}-${sequenceNumber}`,
        timestamp: new Date().toISOString(),
        type: "SubscriptionRuntimePreflightCompleted",
        payload: { ...preflight, usageStatus: "NOT_ITEMIZED" },
      });
      return this.readDto(validMissionId, mission.fixtureId);
    } finally {
      this.preflightingMissionIds.delete(validMissionId);
    }
  }

  /**
   * Issues a sanitized, one-use confirmation for the fixed pilot only. The
   * capability returned by the authorization object never crosses this API.
   */
  async confirmSubscriptionWorker(missionId: string): Promise<SubscriptionConfirmationDto> {
    const validMissionId = this.validateMissionId(missionId);
    const mission = await this.reload(validMissionId);
    if (mission.fixtureId !== liveWorkerPilotFixtureId) throw new Error("Subscription worker confirmation is available only for the live-worker pilot.");
    const state = replay(mission.events);
    if (!state.subscriptionRuntimeDeclaration || state.subscriptionRuntimeDeclaration.executionEnabled !== false) {
      throw new Error("A disabled subscription runtime declaration is required before confirmation.");
    }
    if (state.subscriptionRuntimePreflight?.accessStatus !== "CHATGPT_AUTHENTICATED") {
      throw new Error("Authenticated subscription preflight is required before confirmation.");
    }
    const runningPilotAttempts = Object.entries(state.attempts).filter(([attemptId, attempt]) => {
      const task = state.tasks[attempt.taskId];
      return attemptId.length > 0 && attempt.status === "RUNNING" && attempt.taskId === liveWorkerPilotTask.id && task?.status === "RUNNING";
    });
    if (runningPilotAttempts.length !== 1) throw new Error("Exactly one running live-worker pilot attempt is required before confirmation.");
    const [attemptId] = runningPilotAttempts[0]!;
    const confirmation: SubscriptionLiveWorkerConfirmation = this.subscriptionLiveWorkerAuthorization.confirm({ missionId: validMissionId, attemptId });
    return subscriptionConfirmationDtoSchema.parse({ missionId: validMissionId, attemptId: confirmation.attemptId, status: "CONFIRMED", expiresAtMs: confirmation.expiresAtMs });
  }

  private async readDto(missionId: string, fixtureId: string): Promise<MissionDto> {
    const historyPath = this.historyPath(missionId);
    await assertNotLink(historyPath);
    let events: MissionEvent[];
    try {
      events = await new JsonlEventStore(historyPath).readAll();
    } catch (error: unknown) {
      if (isNotFound(error)) throw error;
      throw new MissionLaunchIncompleteError(missionId);
    }
    if (events.length === 0) throw new Error(`Mission history not found: ${missionId}`);
    if (events.some((event) => event.missionId !== missionId)) throw new Error("Mission history belongs to a different mission.");
    replay(events);
    return missionDtoSchema.parse({ missionId, fixtureId, events });
  }

  private validateMissionId(value: string): string {
    return missionIdSchema.parse(value);
  }

  private historyPath(missionId: string): string {
    return this.containedPath(`${missionId}.jsonl`);
  }

  private metadataPath(missionId: string): string {
    return this.containedPath(`${missionId}.meta.json`);
  }

  private reservationPath(missionId: string): string {
    return this.containedPath(`${missionId}.reserve`);
  }

  private async ensureMissionsRoot(): Promise<void> {
    await mkdir(this.missionsRoot, { recursive: true });
    const stats = await lstat(this.missionsRoot);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error("Mission data directory must be a real directory.");
  }

  private async reserveMarker(path: string, collisionMessage: string, contents: string): Promise<void> {
    try {
      const handle = await open(path, "wx");
      try {
        await handle.writeFile(contents, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (error: unknown) {
      if (isAlreadyExists(error)) throw new Error(collisionMessage);
      throw error;
    }
  }

  private async reserveHistory(path: string, collisionMessage: string): Promise<FileHandle> {
    try {
      return await open(path, "ax");
    } catch (error: unknown) {
      if (isAlreadyExists(error)) throw new Error(collisionMessage);
      throw error;
    }
  }

  private async readReservation(missionId: string, reservationPath: string): Promise<string> {
    try {
      await assertNotLink(reservationPath);
      const reservation = z.object({ fixtureId: fixtureIdSchema }).strict().parse(JSON.parse(await readFile(reservationPath, "utf8")));
      loadFixture(reservation.fixtureId);
      return reservation.fixtureId;
    } catch (error: unknown) {
      if (isNotFound(error)) throw new MissionLaunchIncompleteError(missionId);
      if (error instanceof z.ZodError || error instanceof SyntaxError) throw new MissionLaunchIncompleteError(missionId);
      if (error instanceof Error && error.message.startsWith("Unknown fixture ID:")) throw new MissionLaunchIncompleteError(missionId);
      throw error;
    }
  }

  private async assertAbsent(path: string, collisionMessage: string): Promise<void> {
    try {
      const stats = await lstat(path);
      if (stats.isSymbolicLink()) throw new Error("Mission path cannot be a filesystem link.");
      throw new Error(collisionMessage);
    } catch (error: unknown) {
      if (isNotFound(error)) return;
      throw error;
    }
  }

  private async writeExclusive(path: string, contents: string): Promise<void> {
    const handle = await open(path, "wx");
    try {
      await handle.writeFile(contents, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  private containedPath(filename: string): string {
    const path = resolve(this.missionsRoot, filename);
    const remainder = relative(this.missionsRoot, path);
    if (!remainder || remainder.startsWith("..") || isAbsolute(remainder)) throw new Error("Mission path escaped data root.");
    return path;
  }
}

export const localMissionDtoSchema = missionDtoSchema;

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function exists(path: string): Promise<boolean> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) throw new Error("Mission path cannot be a filesystem link.");
    return true;
  } catch (error: unknown) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

async function assertNotLink(path: string): Promise<void> {
  const stats = await lstat(path);
  if (stats.isSymbolicLink()) throw new Error("Mission path cannot be a filesystem link.");
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}
