import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, unlink } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";

import { JsonlEventStore } from "../event-store.js";
import { loadFixture } from "../fixture-model.js";
import { runFixtureMission } from "../fixture-runner.js";
import { missionEventSchema, type MissionEvent } from "../contracts.js";
import { replay } from "../reducer.js";

const fixtureIdSchema = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, "Fixture IDs must be lowercase kebab-case.");
const missionIdSchema = fixtureIdSchema.max(120);
const missionDtoSchema = z.object({
  missionId: missionIdSchema,
  fixtureId: fixtureIdSchema,
  events: z.array(missionEventSchema),
}).strict();

export type MissionDto = z.infer<typeof missionDtoSchema>;
export type MissionIdFactory = (fixtureId: string) => string;

export interface LocalMissionRuntimeOptions {
  dataRoot: string;
  createMissionId?: MissionIdFactory;
}

/** The sole local boundary allowed to create and reload persisted fixture missions. */
export class LocalMissionRuntime {
  private readonly missionsRoot: string;
  private readonly createMissionId: MissionIdFactory;

  constructor(options: LocalMissionRuntimeOptions) {
    this.missionsRoot = resolve(options.dataRoot, "missions");
    this.createMissionId = options.createMissionId ?? ((fixtureId) => `${fixtureId}-${randomUUID()}`);
  }

  async launch(fixtureId: string): Promise<MissionDto> {
    const fixture = loadFixture(fixtureId);
    const missionId = this.validateMissionId(this.createMissionId(fixture.fixtureId));
    await this.ensureMissionsRoot();
    const historyPath = this.historyPath(missionId);
    const metadataPath = this.metadataPath(missionId);
    await this.assertAbsent(metadataPath, `Mission ID already exists: ${missionId}`);
    // Reserve both paths with exclusive creation before the runner gets a chance
    // to append. `wx` refuses existing files and symlinks/reparse points.
    await this.reserveFile(historyPath, `Mission ID already exists: ${missionId}`);
    try {
      await this.reserveFile(this.reservationPath(missionId), `Mission ID already exists: ${missionId}`, JSON.stringify({ fixtureId: fixture.fixtureId }));
    } catch (error) {
      // The marker is the launch's durable ownership record. If another
      // launch won that race, remove only our empty history reservation so it
      // cannot look like a recoverable partial mission.
      await unlink(historyPath);
      throw error;
    }

    try {
      await runFixtureMission({ fixtureId: fixture.fixtureId, missionId, historyPath });
      await this.writeExclusive(metadataPath, JSON.stringify({ fixtureId: fixture.fixtureId }));
    } finally {
      // A reservation is intentionally retained on failure, making a partial
      // launch visible to reload instead of allowing a second writer.
      if (await exists(this.reservationPath(missionId)) && await exists(metadataPath)) {
        await unlink(this.reservationPath(missionId));
      }
    }
    return this.readDto(missionId, fixture.fixtureId);
  }

  async reload(missionId: string): Promise<MissionDto> {
    const validMissionId = this.validateMissionId(missionId);
    const metadataPath = this.metadataPath(validMissionId);
    await this.ensureMissionsRoot();
    const reservationPath = this.reservationPath(validMissionId);
    if (await exists(reservationPath)) {
      const fixtureId = await this.readReservation(validMissionId, reservationPath);
      try {
        return await this.readDto(validMissionId, fixtureId);
      } catch (error: unknown) {
        if (error instanceof Error && error.message === `Mission history not found: ${validMissionId}`) {
          throw new Error(`Mission launch incomplete: ${validMissionId}`);
        }
        throw error;
      }
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

  private async readDto(missionId: string, fixtureId: string): Promise<MissionDto> {
    const historyPath = this.historyPath(missionId);
    await assertNotLink(historyPath);
    const events = await new JsonlEventStore(historyPath).readAll();
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

  private async reserveFile(path: string, collisionMessage: string, contents = ""): Promise<void> {
    try {
      const handle = await open(path, "wx");
      try {
        if (contents) await handle.writeFile(contents, "utf8");
      } finally {
        await handle.close();
      }
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
      if (isNotFound(error)) throw new Error(`Mission launch incomplete: ${missionId}`);
      if (error instanceof z.ZodError || error instanceof SyntaxError) throw new Error(`Mission launch incomplete: ${missionId}`);
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
