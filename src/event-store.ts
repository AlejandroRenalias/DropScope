import { mkdir, readFile, appendFile } from "node:fs/promises";
import { dirname } from "node:path";

import { missionEventSchema, type MissionEvent } from "./contracts.js";

export class JsonlEventStore {
  constructor(private readonly historyPath: string) {}

  async append(event: MissionEvent): Promise<void> {
    const parsed = missionEventSchema.parse(event);
    await mkdir(dirname(this.historyPath), { recursive: true });
    await appendFile(this.historyPath, `${JSON.stringify(parsed)}\n`, "utf8");
  }

  async readAll(): Promise<MissionEvent[]> {
    try {
      const contents = await readFile(this.historyPath, "utf8");
      return contents
        .split("\n")
        .filter(Boolean)
        .map((line) => missionEventSchema.parse(JSON.parse(line)));
    } catch (error: unknown) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
  }
}
