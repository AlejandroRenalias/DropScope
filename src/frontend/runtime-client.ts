import { z } from "zod";
import { missionEventSchema, type MissionEvent } from "../contracts.js";

const defaultRuntimeBaseUrl = "http://127.0.0.1:8787";
const configuredRuntimeBaseUrl = import.meta.env.VITE_LOCAL_RUNTIME_BASE_URL;
export const LOCAL_RUNTIME_BASE_URL = typeof configuredRuntimeBaseUrl === "string" && /^https?:\/\/127\.0\.0\.1(?::\d+)?$/.test(configuredRuntimeBaseUrl)
  ? configuredRuntimeBaseUrl
  : defaultRuntimeBaseUrl;
const missionDtoSchema = z.object({
  missionId: z.string().min(1),
  fixtureId: z.string().min(1),
  events: z.array(missionEventSchema),
}).strict();
const subscriptionConfirmationDtoSchema = z.object({
  missionId: z.string().min(1),
  attemptId: z.string().min(1),
  status: z.literal("CONFIRMED"),
  expiresAtMs: z.number().int().nonnegative(),
}).strict();

export type LocalMissionDto = { missionId: string; fixtureId: string; events: MissionEvent[] };
export type SubscriptionConfirmationDto = z.infer<typeof subscriptionConfirmationDtoSchema>;

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

async function requestSubscriptionConfirmation(path: string): Promise<SubscriptionConfirmationDto> {
  let response: Response;
  try { response = await fetch(`${LOCAL_RUNTIME_BASE_URL}${path}`, { method: "POST" }); }
  catch { throw new RuntimeClientError("Local runtime is unavailable. Start it with npm run runtime:dev."); }
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : `Runtime request failed (${response.status}).`;
    throw new RuntimeClientError(message, response.status);
  }
  const parsed = subscriptionConfirmationDtoSchema.safeParse(body);
  if (!parsed.success) throw new RuntimeClientError("Local runtime returned an invalid subscription confirmation.");
  return parsed.data;
}

export function launchLocalMission(fixtureId: string): Promise<LocalMissionDto> {
  return request("/api/missions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fixtureId }) });
}

export function reloadLocalMission(missionId: string): Promise<LocalMissionDto> {
  return request(`/api/missions/${encodeURIComponent(missionId)}`);
}

export function preflightSubscriptionRuntime(missionId: string): Promise<LocalMissionDto> {
  return request(`/api/missions/${encodeURIComponent(missionId)}/subscription-preflight`, { method: "POST" });
}

export function confirmSubscriptionWorker(missionId: string): Promise<SubscriptionConfirmationDto> {
  return requestSubscriptionConfirmation(`/api/missions/${encodeURIComponent(missionId)}/subscription-confirmation`);
}

/** Starts the already-confirmed, one-turn local subscription pilot. */
export function runSubscriptionWorker(missionId: string): Promise<LocalMissionDto> {
  return request(`/api/missions/${encodeURIComponent(missionId)}/subscription-run`, { method: "POST" });
}

/** Captures the fixed public Google Trends US RSS source once for the selected pilot. */
export function captureGoogleTrends(missionId: string): Promise<LocalMissionDto> {
  return request(`/api/missions/${encodeURIComponent(missionId)}/google-trends-capture`, { method: "POST" });
}

/** Imports one user-selected CSV into the fixed local comparison pilot. */
export function importGoogleTrendsComparison(missionId: string, csv: string): Promise<LocalMissionDto> {
  return request(`/api/missions/${encodeURIComponent(missionId)}/google-trends-comparison-import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ csv }),
  });
}
