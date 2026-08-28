import type { MissionEvent } from "./contracts.js";
import { reduce, replay, type MissionState } from "./reducer.js";

export interface CommandResult {
  events: MissionEvent[];
  state: MissionState;
}

export function handleProposedEvent(events: MissionEvent[], proposedEvent: MissionEvent): CommandResult {
  const currentState = replay(events);

  try {
    return {
      events: [...events, proposedEvent],
      state: reduce(currentState, proposedEvent),
    };
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : "Unknown transition failure.";
    const rejection: MissionEvent = {
      schemaVersion: 1,
      sequenceNumber: currentState.lastSequenceNumber + 1,
      missionId: currentState.missionId ?? proposedEvent.missionId,
      eventId: `${proposedEvent.eventId}-rejected`,
      timestamp: proposedEvent.timestamp,
      type: "TransitionRejected",
      payload: { attemptedEventType: proposedEvent.type, reason },
    };
    return {
      events: [...events, rejection],
      state: reduce(currentState, rejection),
    };
  }
}
