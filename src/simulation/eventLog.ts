import type { Citizen, SimulationState, WorldDecision, WorldEvent, WorldObservation } from "../types/simulation";
import { formatTime } from "./time";

export function addFeed(sim: SimulationState, text: string) {
  const event: WorldEvent = {
    id: `${sim.day}-${sim.minute}-${sim.feed.length}-${text}`,
    day: sim.day,
    time: formatTime(sim.minute),
    text,
  };
  if (sim.feed[0]?.text !== text) sim.feed.unshift(event);
  sim.feed = sim.feed.slice(0, 18);
}

export function addLifeJournal(sim: SimulationState, citizen: Citizen, text: string) {
  const entry = {
    id: `${citizen.id}-${sim.day}-${Math.round(sim.minute)}-${citizen.lifeJournal.length}`,
    day: sim.day,
    time: formatTime(sim.minute),
    text,
  };
  if (citizen.lifeJournal[0]?.text !== text) citizen.lifeJournal.unshift(entry);
  citizen.lifeJournal = citizen.lifeJournal.slice(0, 24);
}

export function addWorldDecision(sim: SimulationState, decision: Omit<WorldDecision, "id" | "day" | "time">) {
  const repeated = sim.worldDecisions.some((entry) => (
    entry.day === sim.day
    && entry.title === decision.title
    && entry.actorId === decision.actorId
    && entry.householdId === decision.householdId
  ));
  if (repeated) return;

  sim.worldDecisions.unshift({
    id: `${sim.day}-${Math.round(sim.minute)}-${sim.worldDecisions.length}-${decision.category}-${decision.title}`,
    day: sim.day,
    time: formatTime(sim.minute),
    ...decision,
  });
  sim.worldDecisions = sim.worldDecisions.slice(0, 220);
}

function observationKey(observation: Omit<WorldObservation, "id" | "day" | "time">) {
  return [
    observation.kind,
    observation.source,
    observation.citizenId ?? "town",
    observation.householdId ?? "none",
    observation.buildingId ?? "none",
    observation.summary,
  ].join(":");
}

export function addWorldObservation(sim: SimulationState, observation: Omit<WorldObservation, "id" | "day" | "time">) {
  const key = observationKey(observation);
  const duplicate = sim.worldObservations.some((entry) => (
    entry.day === sim.day
    && observationKey(entry) === key
  ));
  if (duplicate) return;

  sim.worldObservations.unshift({
    ...observation,
    id: `${sim.day}-${Math.round(sim.minute)}-${sim.worldObservations.length}-${observation.kind}`,
    day: sim.day,
    time: formatTime(sim.minute),
  });
  sim.worldObservations = sim.worldObservations.slice(0, 320);
}
