import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { localMissionDtoSchema, LocalMissionRuntime, MissionLaunchIncompleteError, subscriptionConfirmationDtoSchema } from "./runtime/local-mission-runtime.js";
import { z } from "zod";

const launchRequestSchema = z.object({ fixtureId: z.string().min(1) }).strict();
const MAX_BODY_BYTES = 64 * 1024;

export interface LocalRuntimeServerOptions {
  port?: number;
}

export interface LocalRuntimeServerHandle {
  address(): AddressInfo | string | null;
  close(): Promise<void>;
}

export async function listenLocalRuntimeServer(runtime: LocalMissionRuntime, options: LocalRuntimeServerOptions = {}): Promise<LocalRuntimeServerHandle> {
  const server = createServer((request, response) => { void handleRequest(runtime, request, response); });
  const host = "127.0.0.1";
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  return {
    address: () => server.address(),
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function handleRequest(runtime: LocalMissionRuntime, request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const corsOrigin = loopbackOrigin(request.headers.origin);
    if (request.headers.origin && !corsOrigin) throw httpError(403, "Cross-origin requests must use a loopback origin.");
    if (request.method === "OPTIONS") {
      if (!url.pathname.startsWith("/api/")) throw httpError(404, "Unknown route.");
      sendJson(response, 204, undefined, corsOrigin);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/missions") {
      const body = launchRequestSchema.parse(JSON.parse(await readBody(request)));
      sendJson(response, 201, localMissionDtoSchema.parse(await runtime.launch(body.fixtureId)), corsOrigin);
      return;
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/missions/") && url.pathname.endsWith("/subscription-preflight")) {
      const encodedMissionId = url.pathname.slice("/api/missions/".length, -"/subscription-preflight".length);
      if (!encodedMissionId || encodedMissionId.includes("/")) throw httpError(400, "Invalid mission ID.");
      let missionId: string;
      try { missionId = decodeURIComponent(encodedMissionId); } catch { throw httpError(400, "Invalid mission ID."); }
      sendJson(response, 200, localMissionDtoSchema.parse(await runtime.preflightSubscriptionRuntime(missionId)), corsOrigin);
      return;
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/missions/") && url.pathname.endsWith("/subscription-confirmation")) {
      const encodedMissionId = url.pathname.slice("/api/missions/".length, -"/subscription-confirmation".length);
      if (!encodedMissionId || encodedMissionId.includes("/")) throw httpError(400, "Invalid mission ID.");
      let missionId: string;
      try { missionId = decodeURIComponent(encodedMissionId); } catch { throw httpError(400, "Invalid mission ID."); }
      if (request.headers["content-length"] && Number(request.headers["content-length"]) > 0) throw httpError(400, "Subscription confirmation requests must not include a body.");
      sendJson(response, 200, subscriptionConfirmationDtoSchema.parse(await runtime.confirmSubscriptionWorker(missionId)), corsOrigin);
      return;
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/missions/") && url.pathname.endsWith("/subscription-run")) {
      const encodedMissionId = url.pathname.slice("/api/missions/".length, -"/subscription-run".length);
      if (!encodedMissionId || encodedMissionId.includes("/")) throw httpError(400, "Invalid mission ID.");
      let missionId: string;
      try { missionId = decodeURIComponent(encodedMissionId); } catch { throw httpError(400, "Invalid mission ID."); }
      if (request.headers["content-length"] && Number(request.headers["content-length"]) > 0) throw httpError(400, "Subscription worker run requests must not include a body.");
      sendJson(response, 200, localMissionDtoSchema.parse(await runtime.runSubscriptionWorker(missionId)), corsOrigin);
      return;
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/missions/") && url.pathname.endsWith("/google-trends-capture")) {
      const encodedMissionId = url.pathname.slice("/api/missions/".length, -"/google-trends-capture".length);
      if (!encodedMissionId || encodedMissionId.includes("/")) throw httpError(400, "Invalid mission ID.");
      let missionId: string;
      try { missionId = decodeURIComponent(encodedMissionId); } catch { throw httpError(400, "Invalid mission ID."); }
      if (request.headers["content-length"] && Number(request.headers["content-length"]) > 0) throw httpError(400, "Google Trends capture requests must not include a body.");
      sendJson(response, 200, localMissionDtoSchema.parse(await runtime.captureGoogleTrends(missionId)), corsOrigin);
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/api/missions/")) {
      const encodedMissionId = url.pathname.slice("/api/missions/".length);
      if (!encodedMissionId || encodedMissionId.includes("/")) throw httpError(400, "Invalid mission ID.");
      let missionId: string;
      try { missionId = decodeURIComponent(encodedMissionId); } catch { throw httpError(400, "Invalid mission ID."); }
      sendJson(response, 200, localMissionDtoSchema.parse(await runtime.reload(missionId)), corsOrigin);
      return;
    }
    throw httpError(request.method === "POST" || request.method === "GET" ? 404 : 405, "Unknown route.");
  } catch (error: unknown) {
    const status = error instanceof HttpError ? error.status : error instanceof MissionLaunchIncompleteError || isPreflightConflict(error) || isConfirmationConflict(error) || isExecutionConflict(error) || isGoogleTrendsConflict(error) ? 409 : isMissingHistory(error) ? 404 : isClientError(error) ? 400 : 500;
    sendJson(response, status, { error: error instanceof Error ? error.message : "Request failed." }, loopbackOrigin(request.headers.origin));
  }
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw httpError(413, "Request body is too large.");
    chunks.push(buffer);
  }
  if (size === 0) throw httpError(400, "Request body must be valid JSON.");
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(response: ServerResponse, status: number, body: unknown, corsOrigin?: string): void {
  const payload = body === undefined ? "" : JSON.stringify(body);
  const headers: Record<string, string | number> = { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(payload) };
  if (corsOrigin) {
    headers["access-control-allow-origin"] = corsOrigin;
    headers.vary = "Origin";
    headers["access-control-allow-methods"] = "GET, POST, OPTIONS";
    headers["access-control-allow-headers"] = "content-type";
  }
  response.writeHead(status, headers);
  response.end(payload);
}

class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
function httpError(status: number, message: string): HttpError { return new HttpError(status, message); }
function isClientError(error: unknown): boolean {
  return error instanceof z.ZodError || error instanceof SyntaxError || (error instanceof Error && (/Unknown fixture ID|Mission IDs must|already exists|history not found|belongs to a different mission/.test(error.message)));
}
function isMissingHistory(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Mission history not found");
}
function isPreflightConflict(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Subscription runtime preflight is already");
}
function isConfirmationConflict(error: unknown): boolean {
  return error instanceof Error && (error.message.includes("only for the live-worker pilot") || error.message.includes("declaration is required before confirmation") || error.message.includes("Authenticated subscription preflight is required before confirmation") || error.message.includes("Exactly one running live-worker pilot attempt"));
}
function isExecutionConflict(error: unknown): boolean {
  return error instanceof Error && (error.message.includes("only for the live-worker pilot") || error.message.includes("declaration is required before execution") || error.message.includes("Authenticated subscription preflight is required before execution") || error.message.includes("Exactly one running live-worker pilot attempt") || error.message.includes("fresh local live-worker confirmation") || error.message.includes("confirmation has expired") || error.message.includes("confirmation is missing") || error.message.includes("execution is already in progress"));
}
function isGoogleTrendsConflict(error: unknown): boolean {
  return error instanceof Error && (error.message.includes("available only for the Google Trends pilot") || error.message.includes("Exactly one running Google Trends pilot attempt") || error.message.includes("Google Trends capture is already"));
}

function loopbackOrigin(origin: string | undefined): string | undefined {
  if (!origin) return undefined;
  try {
    const parsed = new URL(origin);
    const isLoopbackHost = parsed.protocol === "http:" && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost");
    return isLoopbackHost && (parsed.port === "" || Number(parsed.port) <= 65535) && parsed.pathname === "/" && !parsed.search && !parsed.hash ? parsed.origin : undefined;
  } catch {
    return undefined;
  }
}
