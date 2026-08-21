import type { Citizen, CitizenBrainContext, CitizenBrainResult } from "../types/simulation";

type PendingAiRequest = {
  key: string;
};

type ReadyAiDecision = {
  key: string;
  result: CitizenBrainResult;
};

const pending = new Map<string, PendingAiRequest>();
const ready = new Map<string, ReadyAiDecision>();
const failures = new Map<string, string>();

function contextKey(context: CitizenBrainContext) {
  return `${context.identity.id}:${context.time.day}:${Math.floor(context.time.minute / 30)}`;
}

export function takeReadyAiDecision(citizen: Citizen, context: CitizenBrainContext) {
  const key = contextKey(context);
  const cached = ready.get(citizen.id);
  if (!cached || cached.key !== key) return null;
  ready.delete(citizen.id);
  citizen.aiBrainStatus = {
    state: "ready",
    message: "AI bridge response was accepted for this decision.",
  };
  return cached.result;
}

export function requestAiDecision(citizen: Citizen, context: CitizenBrainContext) {
  const key = contextKey(context);
  const currentPending = pending.get(citizen.id);
  if (currentPending?.key === key) {
    citizen.aiBrainStatus = {
      state: "waiting",
      message: "Waiting for the local AI bridge response.",
    };
    return;
  }

  const failure = failures.get(citizen.id);
  if (failure) {
    citizen.aiBrainStatus = {
      state: "error",
      message: failure,
    };
    failures.delete(citizen.id);
  }

  pending.set(citizen.id, { key });
  citizen.aiBrainStatus = {
    state: "waiting",
    message: "Asked the local AI bridge for this citizen's next decision.",
  };

  void fetch("/api/ai/citizen-decision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ context }),
  })
    .then(async (response) => {
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `AI bridge returned ${response.status}`);
      }
      return await response.json() as CitizenBrainResult;
    })
    .then((result) => {
      ready.set(citizen.id, { key, result });
    })
    .catch((error) => {
      failures.set(citizen.id, error instanceof Error ? error.message : "AI bridge request failed.");
    })
    .finally(() => {
      const active = pending.get(citizen.id);
      if (active?.key === key) pending.delete(citizen.id);
    });
}

export function markAiBridgeFallback(citizen: Citizen, context: CitizenBrainContext) {
  citizen.aiBrainStatus = {
    state: "fallback",
    message: `Using scripted fallback for ${context.identity.name} while the AI bridge is not ready.`,
  };
}
