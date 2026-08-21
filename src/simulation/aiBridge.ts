import type { Citizen, CitizenBrainContext } from "../types/simulation";

export function aiBridgeConfigured() {
  return false;
}

export function markAiBridgeFallback(citizen: Citizen, context: CitizenBrainContext) {
  citizen.aiBrainStatus = {
    state: "fallback",
    message: `AI bridge is enabled for ${context.identity.name}, but no approved backend connector is configured yet.`,
  };
}
