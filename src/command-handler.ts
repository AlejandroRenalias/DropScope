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
    if (proposedEvent.type === "FindingSubmitted") {
      const attempt = currentState.attempts[proposedEvent.payload.attemptId];
      if (!attempt || attempt.status !== "RUNNING") {
        const staleCompletion: MissionEvent = {
          schemaVersion: 1,
          sequenceNumber: currentState.lastSequenceNumber + 1,
          missionId: currentState.missionId ?? proposedEvent.missionId,
          eventId: `${proposedEvent.eventId}-stale`,
          timestamp: proposedEvent.timestamp,
          type: "StaleCompletionIgnored",
          payload: { attemptId: proposedEvent.payload.attemptId, reason },
        };
        return {
          events: [...events, staleCompletion],
          state: reduce(currentState, staleCompletion),
        };
      }
    }
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
