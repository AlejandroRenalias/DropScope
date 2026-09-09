import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
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
    const historyPath = this.historyPath(missionId);
    const metadataPath = this.metadataPath(missionId);
    if (await exists(historyPath) || await exists(metadataPath)) throw new Error(`Mission ID already exists: ${missionId}`);

    await runFixtureMission({ fixtureId: fixture.fixtureId, missionId, historyPath });
    await mkdir(this.missionsRoot, { recursive: true });
    await writeFile(metadataPath, JSON.stringify({ fixtureId: fixture.fixtureId }), "utf8");
    return this.readDto(missionId, fixture.fixtureId);
  }

  async reload(missionId: string): Promise<MissionDto> {
    const validMissionId = this.validateMissionId(missionId);
    const metadataPath = this.metadataPath(validMissionId);
    let metadata: unknown;
    try {
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
    const events = await new JsonlEventStore(this.historyPath(missionId)).readAll();
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
    await access(path);
    return true;
  } catch (error: unknown) {
    if (isNotFound(error)) return false;
    throw error;
  }
}
