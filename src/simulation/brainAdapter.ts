import type {
  BrainAdapterMode,
  Citizen,
  CitizenBrainDebug,
  CitizenBrainResult,
  DecisionReasoning,
  SimulationState,
} from "../types/simulation";
import {
  buildCitizenContext,
  chooseCitizenDecision,
  currentObligation,
  thoughtFor,
} from "./brain";
import { formatTime } from "./time";

type BrainAdapterDecision = {
  intention: CitizenBrainResult["decision"]["intention"];
  destinationId: string;
  reasoning: DecisionReasoning;
  result: CitizenBrainResult;
  debug: CitizenBrainDebug;
};

export function chooseCitizenBrainDecision(
  sim: SimulationState,
  citizen: Citizen,
  rand: () => number,
  mode: BrainAdapterMode = "scripted",
): BrainAdapterDecision {
  if (mode !== "scripted") {
    throw new Error(`Unsupported brain adapter mode: ${mode}`);
  }
  return chooseScriptedBrainDecision(sim, citizen, rand);
}

function chooseScriptedBrainDecision(
  sim: SimulationState,
  citizen: Citizen,
  rand: () => number,
): BrainAdapterDecision {
  const input = buildCitizenContext(sim, citizen);
  const scripted = chooseCitizenDecision(sim, citizen, rand);
  const obligation = currentObligation(citizen, sim.minute, sim);
  const thought = thoughtFor(citizen, scripted.intention, scripted.destinationId, obligation, sim);
  const confidence = Math.round(Math.min(100, Math.max(8, scripted.reasoning.chosen.score)));
  const expectedMinutes = expectedCommitmentMinutes(scripted.intention);
  const result: CitizenBrainResult = {
    decision: {
      intention: scripted.intention,
      destinationId: scripted.destinationId,
      thought,
      reason: scripted.reasoning.summary,
      confidence,
      expectedMinutes,
      tags: [
        "scripted",
        scripted.reasoning.authority.outcome,
        scripted.reasoning.chosen.destinationName.toLowerCase().replace(/\s+/g, "-"),
      ],
    },
    observations: [],
    memories: [],
    goalNotes: [],
  };

  return {
    intention: scripted.intention,
    destinationId: scripted.destinationId,
    reasoning: scripted.reasoning,
    result,
    debug: {
      mode: "scripted",
      decidedAtDay: sim.day,
      decidedAtTime: formatTime(sim.minute),
      input,
      output: result,
      summary: scripted.reasoning.summary,
    },
  };
}

function expectedCommitmentMinutes(intention: CitizenBrainResult["decision"]["intention"]) {
  if (intention === "work" || intention === "school") return 95;
  if (intention === "eat" || intention === "errand") return 45;
  if (intention === "socialize" || intention === "wander") return 55;
  return 35;
}
