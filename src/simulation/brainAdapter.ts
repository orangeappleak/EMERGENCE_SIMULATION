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
import { requestAiDecision, takeReadyAiDecision } from "./aiBridge";
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
    return chooseAiBridgeDecision(sim, citizen, rand);
  }
  return chooseScriptedBrainDecision(sim, citizen, rand);
}

function chooseAiBridgeDecision(
  sim: SimulationState,
  citizen: Citizen,
  rand: () => number,
): BrainAdapterDecision {
  const input = buildCitizenContext(sim, citizen, "ai");
  const fallback = chooseScriptedBrainDecision(sim, citizen, rand, "ai", "fallback");
  const readyResult = takeReadyAiDecision(citizen, input);
  if (readyResult) {
    const { result: guardedResult, validation } = guardBrainResult(input, readyResult, fallback.result.decision);
    return {
      intention: guardedResult.decision.intention,
      destinationId: guardedResult.decision.destinationId,
      reasoning: fallback.reasoning,
      result: guardedResult,
      debug: {
        mode: "ai",
        source: validation.valid ? "ai" : "fallback",
        contractVersion: input.contract.version,
        decidedAtDay: sim.day,
        decidedAtTime: formatTime(sim.minute),
        input,
        output: guardedResult,
        validation,
        summary: validation.valid
          ? guardedResult.decision.reason
          : `${guardedResult.decision.reason} AI output needed repairs before use.`,
      },
    };
  }

  requestAiDecision(citizen, input);
  return {
    ...fallback,
    debug: {
      ...fallback.debug,
      mode: "ai",
      source: "fallback",
      input,
      summary: `${fallback.debug.summary} AI bridge fallback is active until a backend connector is configured.`,
    },
  };
}

function chooseScriptedBrainDecision(
  sim: SimulationState,
  citizen: Citizen,
  rand: () => number,
  mode: BrainAdapterMode = "scripted",
  source: CitizenBrainDebug["source"] = "scripted",
): BrainAdapterDecision {
  const input = buildCitizenContext(sim, citizen, mode);
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
  const { result: guardedResult, validation } = guardBrainResult(input, result, {
    intention: scripted.intention,
    destinationId: scripted.destinationId,
    thought,
    reason: scripted.reasoning.summary,
    confidence,
    expectedMinutes,
    tags: ["scripted", "fallback"],
  });

  return {
    intention: guardedResult.decision.intention,
    destinationId: guardedResult.decision.destinationId,
    reasoning: scripted.reasoning,
    result: guardedResult,
    debug: {
      mode,
      source,
      contractVersion: input.contract.version,
      decidedAtDay: sim.day,
      decidedAtTime: formatTime(sim.minute),
      input,
      output: guardedResult,
      validation,
      summary: scripted.reasoning.summary,
    },
  };
}

function guardBrainResult(
  input: ReturnType<typeof buildCitizenContext>,
  result: CitizenBrainResult,
  fallbackDecision: CitizenBrainResult["decision"],
): { result: CitizenBrainResult; validation: CitizenBrainValidation } {
  const warnings: string[] = [];
  const repairedFields: string[] = [];
  const blockedFields: string[] = [];
  const guarded: CitizenBrainResult = {
    decision: { ...result.decision },
    observations: result.observations.slice(0, 3),
    memories: result.memories.slice(0, 3),
    goalNotes: result.goalNotes.slice(0, 3),
  };
  const decision = guarded.decision;
  const matchingAction = input.availableActions.find((action) => (
    action.intention === decision.intention && action.destinationId === decision.destinationId
  ));

  if (!input.constraints.allowedIntentions.includes(decision.intention)) {
    warnings.push(`${decision.intention} is not in the allowed intention list.`);
    repairedFields.push("decision.intention");
  }
  if (!matchingAction) {
    warnings.push(`${decision.destinationId} is not an available destination for ${decision.intention}.`);
    repairedFields.push("decision.destinationId");
  }

  if (!input.constraints.allowedIntentions.includes(decision.intention) || !matchingAction) {
    guarded.decision = { ...fallbackDecision };
  }

  if (!guarded.decision.thought.trim()) {
    warnings.push("Decision thought was empty.");
    guarded.decision.thought = fallbackDecision.thought;
    repairedFields.push("decision.thought");
  }
  if (!guarded.decision.reason.trim()) {
    warnings.push("Decision reason was empty.");
    guarded.decision.reason = fallbackDecision.reason;
    repairedFields.push("decision.reason");
  }
  const clampedConfidence = clamp(guarded.decision.confidence, 0, 100);
  if (guarded.decision.confidence !== clampedConfidence) {
    warnings.push("Decision confidence must stay between 0 and 100.");
    guarded.decision.confidence = clampedConfidence;
    repairedFields.push("decision.confidence");
  }
  const clampedExpectedMinutes = clamp(guarded.decision.expectedMinutes, 5, 240);
  if (guarded.decision.expectedMinutes !== clampedExpectedMinutes) {
    warnings.push("Decision expectedMinutes must stay between 5 and 240.");
    guarded.decision.expectedMinutes = clampedExpectedMinutes;
    repairedFields.push("decision.expectedMinutes");
  }
  if (input.identity.lifeStage === "child" && guarded.decision.intention === "errand") {
    warnings.push("Children cannot choose independent errands.");
    guarded.decision = { ...fallbackDecision };
    repairedFields.push("decision");
  }
  if (guarded.decision.spendingLimit !== undefined && !input.constraints.canSpendAlone) {
    warnings.push("Spending was proposed for someone who cannot spend alone.");
    delete guarded.decision.spendingLimit;
    blockedFields.push("decision.spendingLimit");
  }

  guarded.decision.thought = trimText(guarded.decision.thought, 180);
  guarded.decision.reason = trimText(guarded.decision.reason, 240);
  guarded.decision.tags = sanitizeTags(guarded.decision.tags);
  guarded.observations = guarded.observations
    .filter((observation) => observation.summary.trim() && observation.detail.trim())
    .map((observation) => ({
      ...observation,
      summary: trimText(observation.summary, 140),
      detail: trimText(observation.detail, 260),
      confidence: clamp(observation.confidence, 0, 100),
      severity: clamp(observation.severity, 0, 100),
      tags: sanitizeTags(observation.tags),
    }));
  guarded.memories = guarded.memories
    .map((memory) => trimText(memory, 180))
    .filter(Boolean);
  guarded.goalNotes = guarded.goalNotes
    .map((note) => trimText(note, 180))
    .filter(Boolean);

  if (result.observations.length > guarded.observations.length) {
    repairedFields.push("observations");
  }
  if (result.memories.length > guarded.memories.length) {
    repairedFields.push("memories");
  }
  if (result.goalNotes.length > guarded.goalNotes.length) {
    repairedFields.push("goalNotes");
  }

  return {
    result: guarded,
    validation: {
      valid: warnings.length === 0 && blockedFields.length === 0,
      warnings,
      repairedFields: Array.from(new Set(repairedFields)),
      blockedFields: Array.from(new Set(blockedFields)),
    },
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(Number.isFinite(value) ? value : min)));
}

function trimText(value: string, maxLength: number) {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1).trim()}...`;
}

function sanitizeTags(tags: string[]) {
  return Array.from(new Set(tags
    .map((tag) => tag.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter(Boolean)))
    .slice(0, 8);
}

function expectedCommitmentMinutes(intention: CitizenBrainResult["decision"]["intention"]) {
  if (intention === "work" || intention === "school") return 95;
  if (intention === "eat" || intention === "errand") return 45;
  if (intention === "socialize" || intention === "wander") return 55;
  return 35;
}
