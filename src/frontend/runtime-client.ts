import { z } from "zod";
import { missionEventSchema, type MissionEvent } from "../contracts.js";

export const LOCAL_RUNTIME_BASE_URL = "http://127.0.0.1:8787";
const missionDtoSchema = z.object({
  missionId: z.string().min(1),
  fixtureId: z.string().min(1),
  events: z.array(missionEventSchema),
}).strict();

export type LocalMissionDto = { missionId: string; fixtureId: string; events: MissionEvent[] };

export class RuntimeClientError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

async function request(path: string, init?: RequestInit): Promise<LocalMissionDto> {
  let response: Response;
  try { response = await fetch(`${LOCAL_RUNTIME_BASE_URL}${path}`, init); }
  catch { throw new RuntimeClientError("Local runtime is unavailable. Start it with npm run runtime:dev."); }
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : `Runtime request failed (${response.status}).`;
    throw new RuntimeClientError(message, response.status);
  }
  const parsed = missionDtoSchema.safeParse(body);
  if (!parsed.success) throw new RuntimeClientError("Local runtime returned an invalid mission record.");
  return parsed.data;
}

export function launchLocalMission(fixtureId: string): Promise<LocalMissionDto> {
  return request("/api/missions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fixtureId }) });
}

export function reloadLocalMission(missionId: string): Promise<LocalMissionDto> {
  return request(`/api/missions/${encodeURIComponent(missionId)}`);
}
