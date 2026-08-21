import type {
  BrainAdapterMode,
  Citizen,
  CitizenBrainDebug,
  CitizenBrainResult,
  CitizenBrainValidation,
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
  const input = buildCitizenContext(sim, citizen, "scripted");
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
  const validation = validateBrainResult(input, result);

  return {
    intention: scripted.intention,
    destinationId: scripted.destinationId,
    reasoning: scripted.reasoning,
    result,
    debug: {
      mode: "scripted",
      contractVersion: input.contract.version,
      decidedAtDay: sim.day,
      decidedAtTime: formatTime(sim.minute),
      input,
      output: result,
      validation,
      summary: scripted.reasoning.summary,
    },
  };
}

function validateBrainResult(input: ReturnType<typeof buildCitizenContext>, result: CitizenBrainResult): CitizenBrainValidation {
  const warnings: string[] = [];
  const repairedFields: string[] = [];
  const decision = result.decision;
  const matchingAction = input.availableActions.find((action) => (
    action.intention === decision.intention && action.destinationId === decision.destinationId
  ));

  if (!input.constraints.allowedIntentions.includes(decision.intention)) {
    warnings.push(`${decision.intention} is not in the allowed intention list.`);
  }
  if (!matchingAction) {
    warnings.push(`${decision.destinationId} is not an available destination for ${decision.intention}.`);
  }
  if (!decision.thought.trim()) {
    warnings.push("Decision thought was empty.");
  }
  if (!decision.reason.trim()) {
    warnings.push("Decision reason was empty.");
  }
  if (decision.confidence < 0 || decision.confidence > 100) {
    warnings.push("Decision confidence must stay between 0 and 100.");
  }
  if (input.identity.lifeStage === "child" && decision.intention === "errand") {
    warnings.push("Children cannot choose independent errands.");
  }
  if (decision.spendingLimit !== undefined && !input.constraints.canSpendAlone) {
    warnings.push("Spending was proposed for someone who cannot spend alone.");
  }

  return {
    valid: warnings.length === 0,
    warnings,
    repairedFields,
  };
}

function expectedCommitmentMinutes(intention: CitizenBrainResult["decision"]["intention"]) {
  if (intention === "work" || intention === "school") return 95;
  if (intention === "eat" || intention === "errand") return 45;
  if (intention === "socialize" || intention === "wander") return 55;
  return 35;
}
