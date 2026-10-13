import type { MissionEvent } from "../contracts.js";

export function displayResearchCopy(value: string): string {
  return value.replace(/cross-current/gi, "Crosscurrent");
}

function humanizedType(type: string): string {
  return type.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
}

export function summarizeResearchEvent(event: MissionEvent): string {
  const payload = event.payload as Record<string, unknown>;
  const parts: string[] = [];
  if (event.type === "BudgetReserved" && typeof payload.cost === "number") parts.push(`Reserved ${payload.cost} budget units`);
  else if (typeof payload.objective === "string") parts.push(displayResearchCopy(payload.objective));
  else if (typeof payload.finding === "string") parts.push(displayResearchCopy(payload.finding));
  else if (typeof payload.reason === "string") parts.push(displayResearchCopy(payload.reason));
  else if (typeof payload.status === "string") parts.push(`Status: ${payload.status}`);
  else parts.push(humanizedType(event.type));

  if (event.type === "BudgetReserved" && typeof payload.attemptId === "string") parts.push(`Attempt ${payload.attemptId}`);
  else if (typeof payload.attemptId === "string" && !parts.some((part) => part.includes(payload.attemptId as string))) parts.push(`Attempt ${payload.attemptId}`);
  return parts.join(" · ");
}
