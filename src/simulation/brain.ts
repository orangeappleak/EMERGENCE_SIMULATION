import type {
  Citizen,
  CitizenBrainContext,
  AuthorityCheck,
  DecisionReasoning,
  DecisionScore,
  CitizenEmotion,
  CitizenIntention,
  ConversationClassification,
  ConversationTopic,
  Household,
  PersonalGoal,
  PersonalGoalKind,
  SimulationState,
} from "../types/simulation";
import { BUILDINGS, FACTORY_RUMOR, PLACE_SLOTS } from "./constants";
import { clamp, mulberry32, pick } from "./random";
import { formatTime } from "./time";

type RecordJournal = (sim: SimulationState, citizen: Citizen, text: string) => void;
type GoalCandidate = Omit<PersonalGoal, "id" | "progress" | "status" | "createdDay"> & { score: number };

const SOCIAL_DESTINATIONS = ["market", "clinic", "school"] as const;

function buildingById(id: string) {
  const building = BUILDINGS.find((item) => item.id === id);
  if (!building) throw new Error(`Unknown building: ${id}`);
  return building;
}

function placeSlotById(id: string) {
  return PLACE_SLOTS.find((item) => item.id === id);
}

function isYoungChild(citizen: Citizen) {
  return citizen.age < 7;
}

function isChild(citizen: Citizen) {
  return citizen.lifeStage === "child";
}

function canRunIndependentErrands(citizen: Citizen) {
  return citizen.lifeStage !== "child";
}

function personalMoneyPressure(citizen: Citizen) {
  if (citizen.lifeStage === "child") return 0;
  if (citizen.schoolClass && !citizen.workplaceId) return citizen.cash < 45 ? 18 : 0;
  if (citizen.lifeStage === "teen") return citizen.cash < 95 ? 28 : 0;
  return citizen.cash < 360 ? 48 : citizen.cash < 500 ? 20 : 0;
}

function householdMoneyPressure(household?: Household) {
  if (!household) return 0;
  if (household.sharedCash < household.rent * 0.25) return 36;
  if (household.sharedCash < household.rent * 0.5) return 18;
  return 0;
}

function labelIntent(intention: CitizenIntention) {
  return intention.charAt(0).toUpperCase() + intention.slice(1);
}

function explainScore(intention: CitizenIntention, citizen: Citizen, sim: SimulationState, destinationId: string, obligation: CitizenIntention | null) {
  const household = sim.households.find((item) => item.id === citizen.householdId);
  const destination = buildingById(destinationId).name;
  const weatherNote = weatherReason(intention, sim);
  const suffix = weatherNote ? ` ${weatherNote}` : "";
  if (intention === "sleep") return `It is sleep time, and rest need is making sleep hard to ignore.${suffix}`;
  if (intention === "home") return `${household && household.stress > 55
    ? "Home is pulling them back because the household feels unstable."
    : "Home is familiar, and rest or household pressure is influencing the choice."}${suffix}`;
  if (intention === "school") return `${obligation === "school"
    ? "School is in session, and responsibility, ambition, and school goals are pulling this up."
    : "School matters to their current path, even outside a strict class moment."}${suffix}`;
  if (intention === "work") return `Work hours are active, and responsibility, ambition, money, and career goals are competing with fatigue.${suffix}`;
  if (intention === "eat") return `Hunger or lunch time is making food the most practical next step.${suffix}`;
  if (intention === "socialize") return `Belonging need and sociability are pushing them toward people at ${destination}.${suffix}`;
  if (intention === "wander") return `Fun, curiosity, and independence are pulling them toward exploring near ${destination}.${suffix}`;
  if (intention === "errand") return `Errand odds, hunger, and household food pressure make this feel useful.${suffix}`;
  return `${obligation
    ? "They know there is an obligation, but low mood or exhaustion is strong enough to choose recovery."
    : "Low mood or high rest need is making recovery more important than staying busy."}${suffix}`;
}

function weatherReason(intention: CitizenIntention, sim: SimulationState) {
  if (sim.weather.kind === "rain" && (intention === "home" || intention === "recover")) return "Rain makes staying indoors feel more appealing.";
  if (sim.weather.kind === "rain" && (intention === "wander" || intention === "errand")) return "Rain makes this less comfortable unless the need is strong.";
  if (sim.weather.kind === "fog" && intention === "wander") return "Fog makes wandering feel slower and less inviting.";
  if (sim.weather.kind === "cloudy" && intention === "socialize") return "Cloudy weather makes indoor social time feel slightly more appealing.";
  if (sim.weather.temperature < 58 && (intention === "home" || intention === "recover")) return "Cool weather makes warmth and rest more attractive.";
  if (sim.weather.temperature > 82 && (intention === "recover" || intention === "eat")) return "Heat makes comfort and basic needs feel more urgent.";
  return "";
}

function weatherDecisionModifier(intention: CitizenIntention, sim: SimulationState) {
  let modifier = 0;
  if (sim.weather.kind === "rain") {
    if (intention === "home" || intention === "recover") modifier += 16;
    if (intention === "wander") modifier -= 24;
    if (intention === "errand") modifier -= 12;
    if (intention === "socialize") modifier -= 5;
  } else if (sim.weather.kind === "fog") {
    if (intention === "home" || intention === "recover") modifier += 8;
    if (intention === "wander") modifier -= 14;
  } else if (sim.weather.kind === "cloudy") {
    if (intention === "socialize") modifier += 4;
    if (intention === "wander") modifier -= 4;
  }
  if (sim.weather.temperature < 58) {
    if (intention === "home" || intention === "recover") modifier += 8;
    if (intention === "wander") modifier -= 7;
  }
  if (sim.weather.temperature > 82) {
    if (intention === "recover" || intention === "eat") modifier += 8;
    if (intention === "work" || intention === "school") modifier -= 3;
    if (intention === "wander") modifier -= 6;
  }
  return modifier;
}

function authorityFor(sim: SimulationState, citizen: Citizen, obligation: CitizenIntention | null) {
  if (!obligation) return "Self-directed";
  if (obligation === "school") {
    const household = sim.households.find((item) => item.id === citizen.householdId);
    const guardian = household?.memberIds
      .map((id) => sim.citizens.find((item) => item.id === id))
      .find((person) => person && (person.familyRole === "parent" || person.familyRole === "partner" || person.familyRole === "elder"));
    return guardian ? `${guardian.name} and school staff` : "School staff";
  }
  if (citizen.workplaceId === "school" && citizen.institutionRole && citizen.institutionRole !== "student") return "Principal and school schedule";
  if (citizen.workplaceId) return `${buildingById(citizen.workplaceId).name} manager`;
  return "Town expectations";
}

function evaluateAuthority(
  sim: SimulationState,
  citizen: Citizen,
  chosen: DecisionScore,
  obligation: CitizenIntention | null,
  rand: () => number,
): AuthorityCheck {
  if (!obligation) {
    return {
      expectedIntention: null,
      expectedDestinationId: null,
      authority: "Self-directed",
      pressure: 0,
      resistance: 0,
      outcome: "free",
      reason: "No active school, work, or household rule is pushing against this choice.",
    };
  }

  const expectedDestinationId = obligation === "school" ? "school" : citizen.workplaceId;
  if (chosen.intention === obligation && chosen.destinationId === expectedDestinationId) {
    return {
      expectedIntention: obligation,
      expectedDestinationId,
      authority: authorityFor(sim, citizen, obligation),
      pressure: 0,
      resistance: 0,
      outcome: "free",
      reason: `Their choice already matches the current ${obligation} obligation.`,
    };
  }

  const household = sim.households.find((item) => item.id === citizen.householdId);
  const agePressure = citizen.lifeStage === "child" ? 92 : citizen.lifeStage === "teen" ? 82 : citizen.lifeStage === "elder" ? 54 : 74;
  const rolePressure = obligation === "school"
    ? (citizen.schoolClass === "elementary" ? 16 : citizen.schoolClass === "middle" ? 10 : 4)
    : citizen.workplaceId === "school"
      ? 14
      : 8;
  const pressure = clamp(agePressure + rolePressure + citizen.personality.responsibility * 0.24 + (household?.stress ?? 0) * 0.08, 0, 125);
  const urgentNeed = chosen.intention === "recover"
    ? citizen.needs.rest * 0.55 + (45 - Math.min(citizen.mood, 45)) * 0.8
    : chosen.intention === "eat"
      ? Math.max(0, citizen.needs.hunger - 68) * 0.75
      : 0;
  const resistance = clamp(
    citizen.personality.independence * 0.56
    + (100 - citizen.personality.responsibility) * 0.32
    + urgentNeed
    + (citizen.currentEmotion === "stressed" ? 8 : 0)
    + rand() * 16,
    0,
    125,
  );

  if (resistance > pressure + 18) {
    return {
      expectedIntention: obligation,
      expectedDestinationId,
      authority: authorityFor(sim, citizen, obligation),
      pressure: Math.round(pressure),
      resistance: Math.round(resistance),
      outcome: "defied",
      reason: `They felt enough independence, stress, or urgent need to ignore the current ${obligation} expectation.`,
    };
  }

  return {
    expectedIntention: obligation,
    expectedDestinationId,
    authority: authorityFor(sim, citizen, obligation),
    pressure: Math.round(pressure),
    resistance: Math.round(resistance),
    outcome: chosen.intention === "recover" && urgentNeed > 34 ? "blocked" : "guided",
    reason: chosen.intention === "recover" && urgentNeed > 34
      ? `They wanted to recover, but the current ${obligation} obligation is still stronger in this moment.`
      : `The current ${obligation} obligation overruled their first choice.`,
  };
}

function allowedIntentionsFor(citizen: Citizen): CitizenIntention[] {
  if (citizen.lifeStage === "child") return ["home", "school", "eat", "socialize", "wander", "sleep"];
  if (citizen.lifeStage === "teen") return ["home", "school", "eat", "socialize", "wander", "recover", "sleep"];
  if (citizen.lifeStage === "elder") return ["home", "eat", "socialize", "wander", "recover", "sleep", "errand"];
  return ["home", "work", "eat", "errand", "socialize", "wander", "recover", "sleep"];
}

export function buildCitizenContext(sim: SimulationState, citizen: Citizen): CitizenBrainContext {
  const household = sim.households.find((item) => item.id === citizen.householdId);
  const obligation = currentObligation(citizen, sim.minute, sim);
  const authority: AuthorityCheck = {
    expectedIntention: obligation,
    expectedDestinationId: obligation === "school" ? "school" : obligation === "work" ? citizen.workplaceId : null,
    authority: authorityFor(sim, citizen, obligation),
    pressure: obligation ? 100 : 0,
    resistance: 0,
    outcome: obligation ? "guided" : "free",
    reason: obligation
      ? `The current ${obligation} obligation should be considered before choosing freely.`
      : "No active school, work, or household rule is pushing against this choice.",
  };
  const relationships = Object.entries(citizen.relationships)
    .map(([id, relationship]) => ({
      citizen: sim.citizens.find((item) => item.id === id),
      relationship,
    }))
    .filter((item): item is { citizen: Citizen; relationship: typeof item.relationship } => item.citizen !== undefined)
    .sort((a, b) => {
      const aScore = a.relationship.friendship + a.relationship.trust + a.relationship.familiarity;
      const bScore = b.relationship.friendship + b.relationship.trust + b.relationship.familiarity;
      return bScore - aScore;
    })
    .slice(0, 6);

  return {
    time: { day: sim.day, minute: sim.minute },
    identity: {
      id: citizen.id,
      name: citizen.name,
      age: citizen.age,
      lifeStage: citizen.lifeStage,
      familyRole: citizen.familyRole,
      job: citizen.job,
      institutionRole: citizen.institutionRole,
      schoolClass: citizen.schoolClass,
    },
    situation: {
      home: buildingById(citizen.homeId).name,
      workplace: citizen.workplaceId ? buildingById(citizen.workplaceId).name : null,
      destination: buildingById(citizen.destinationId).name,
      currentSlot: placeSlotById(citizen.currentSlotId)?.name ?? "unknown spot",
      destinationSlot: placeSlotById(citizen.destinationSlotId)?.name ?? "unknown spot",
      currentThought: citizen.currentThought,
      currentEmotion: citizen.currentEmotion,
      currentIntention: citizen.currentIntention,
      problems: citizen.problems,
      knownFacts: citizen.knownFacts,
    },
    personality: citizen.personality,
    needs: citizen.needs,
    goals: citizen.personalGoals,
    household: household
      ? {
        name: household.name,
        rent: household.rent,
        sharedCash: household.sharedCash,
        foodStock: household.foodStock,
        stress: household.stress,
      }
      : null,
    progress: {
      school: citizen.schoolProgress,
      career: citizen.careerProgress,
    },
    relationships: relationships.map((item) => ({
      id: item.citizen.id,
      name: item.citizen.name,
      job: item.citizen.job,
      friendship: item.relationship.friendship,
      trust: item.relationship.trust,
      familiarity: item.relationship.familiarity,
    })),
    recentConversations: citizen.recentConversations.slice(0, 5),
    recentMemories: citizen.memories.slice(0, 5),
    lifeJournal: citizen.lifeJournal.slice(0, 5),
    localSignals: sim.worldSignals
      .filter((signal) => signal.status === "watched" || signal.status === "strong" || signal.status === "promoted")
      .slice(0, 6)
      .map((signal) => ({
        id: signal.id,
        kind: signal.kind,
        title: signal.title,
        status: signal.status,
        confidence: signal.confidence,
        severity: signal.severity,
        maturity: signal.maturity,
        evidence: signal.evidence,
      })),
    recentObservations: sim.worldObservations
      .filter((observation) => (
        observation.citizenId === citizen.id
        || observation.householdId === citizen.householdId
        || observation.buildingId === citizen.destinationId
      ))
      .slice(0, 8)
      .map((observation) => ({
        id: observation.id,
        kind: observation.kind,
        source: observation.source,
        summary: observation.summary,
        detail: observation.detail,
        confidence: observation.confidence,
        severity: observation.severity,
        tags: observation.tags,
      })),
    constraints: {
      allowedIntentions: allowedIntentionsFor(citizen),
      authority,
      canSpendAlone: citizen.lifeStage !== "child",
      canConsiderCivicIssues: citizen.lifeStage === "adult" || citizen.lifeStage === "elder",
    },
  };
}

export function totalMinute(sim: SimulationState) {
  return sim.day * 1440 + sim.minute;
}

export function updateEmotionAndProblems(sim: SimulationState, citizen: Citizen) {
  const household = sim.households.find((item) => item.id === citizen.householdId);
  const problems: string[] = [];
  if (personalMoneyPressure(citizen) > 0 || (household?.sharedCash ?? 0) < (household?.rent ?? 800)) problems.push("Money feels tight.");
  if ((household?.stress ?? 0) > 60) problems.push("Home feels stressful.");
  if (citizen.needs.rest > 70 || citizen.energy < 42) problems.push("They feel worn down.");
  if (citizen.needs.belonging > 68 || citizen.social < 35) problems.push("They feel disconnected from people.");
  if (citizen.schoolProgress && citizen.schoolProgress.grades < 45) problems.push("School is starting to feel hard.");
  if (citizen.careerProgress && citizen.careerProgress.burnout > 72) problems.push("Work is burning them out.");
  if (citizen.careerProgress && citizen.careerProgress.reliability < 38) problems.push("Their work reputation feels shaky.");

  citizen.problems = problems.slice(0, 4);
  if (citizen.needs.rest > 75 || citizen.energy < 35) citizen.currentEmotion = "tired";
  else if ((household?.stress ?? 0) > 68 || (citizen.careerProgress?.burnout ?? 0) > 76) citizen.currentEmotion = "stressed";
  else if (personalMoneyPressure(citizen) > 28 || citizen.mood < 42) citizen.currentEmotion = "worried";
  else if (citizen.needs.belonging > 70 || citizen.social < 32) citizen.currentEmotion = "lonely";
  else if (citizen.currentIntention === "socialize") citizen.currentEmotion = "connected";
  else if (citizen.currentIntention === "wander") citizen.currentEmotion = "curious";
  else if (citizen.mood > 76) citizen.currentEmotion = "happy";
  else if (citizen.goalFocus) citizen.currentEmotion = "hopeful";
  else citizen.currentEmotion = "calm";
}

function goalId(citizen: Citizen, kind: PersonalGoalKind) {
  return `${citizen.id}_${kind}`;
}

function goalCandidates(citizen: Citizen, household: Household | undefined): GoalCandidate[] {
  const householdStress = household?.stress ?? 0;
  const sharedCash = household?.sharedCash ?? 0;
  const candidates: GoalCandidate[] = [
    {
      kind: "friendship",
      title: "Build a stronger friendship",
      reason: "I do not want to feel like I am just passing through town alone.",
      priority: Math.round(35 + citizen.needs.belonging * 0.45 + citizen.personality.sociability * 0.35),
      score: citizen.needs.belonging * 0.8 + citizen.personality.sociability * 0.45 + (100 - citizen.social) * 0.35,
    },
    {
      kind: "wellbeing",
      title: "Feel healthier and less drained",
      reason: "My body is telling me to slow down before I burn out.",
      priority: Math.round(30 + citizen.needs.rest * 0.5 + (100 - citizen.mood) * 0.25),
      score: citizen.needs.rest * 0.9 + (100 - citizen.mood) * 0.55,
    },
    {
      kind: "curiosity",
      title: "Learn more about the town",
      reason: "I keep wondering what is happening outside my usual route.",
      priority: Math.round(30 + citizen.personality.curiosity * 0.55 + citizen.needs.fun * 0.25),
      score: citizen.personality.curiosity * 0.75 + citizen.needs.fun * 0.45 + citizen.personality.independence * 0.18,
    },
  ];

  if (citizen.schoolClass) {
    candidates.push({
      kind: "school",
      title: "Do better at school",
      reason: citizen.personality.ambition > 60 ? "I want school to open better choices later." : "I do not want to fall behind everyone else.",
      priority: Math.round(45 + citizen.personality.ambition * 0.4 + citizen.personality.responsibility * 0.35),
      score: 42 + citizen.personality.ambition * 0.65 + citizen.personality.responsibility * 0.55 - citizen.needs.fun * 0.12,
    });
  }

  if (!citizen.schoolClass && citizen.workplaceId) {
    candidates.push({
      kind: "career",
      title: "Build a better reputation at work",
      reason: citizen.personality.ambition > 62 ? "I want people to see what I can become." : "Keeping this job stable matters right now.",
      priority: Math.round(38 + citizen.personality.ambition * 0.45 + citizen.personality.responsibility * 0.35),
      score: 34 + citizen.personality.ambition * 0.72 + citizen.personality.responsibility * 0.5 + personalMoneyPressure(citizen) * 0.38,
    });
  }

  if (!citizen.schoolClass && !citizen.workplaceId) {
    candidates.push({
      kind: "career",
      title: "Find steady work",
      reason: "I need a way to support myself instead of drifting.",
      priority: Math.round(55 + citizen.personality.ambition * 0.35 + citizen.personality.responsibility * 0.25),
      score: 62 + citizen.personality.ambition * 0.55 + citizen.personality.responsibility * 0.45 + personalMoneyPressure(citizen) * 0.45,
    });
  }

  if (personalMoneyPressure(citizen) > 0 || sharedCash < (household?.rent ?? 800)) {
    candidates.push({
      kind: "money",
      title: "Save more money",
      reason: "Money feels too tight to ignore.",
      priority: Math.round(45 + personalMoneyPressure(citizen) * 0.45 + householdStress * 0.25),
      score: 42 + personalMoneyPressure(citizen) + householdStress * 0.42,
    });
  }

  if (citizen.familyRole === "parent" || citizen.familyRole === "partner" || householdStress > 55) {
    candidates.push({
      kind: "family",
      title: "Keep the household stable",
      reason: "The people at home need life to feel less shaky.",
      priority: Math.round(42 + householdStress * 0.45 + citizen.personality.responsibility * 0.25),
      score: 35 + householdStress * 0.7 + citizen.personality.responsibility * 0.4,
    });
  }

  return candidates;
}

export function refreshPersonalGoals(sim: SimulationState, citizen: Citizen, recordJournal: RecordJournal) {
  const household = sim.households.find((item) => item.id === citizen.householdId);
  const existing = new Map(citizen.personalGoals.map((goal) => [goal.kind, goal]));
  const previousFocus = citizen.goalFocus;
  const rand = mulberry32(sim.day * 9301 + Math.floor(sim.minute / 120) * 211 + Number(citizen.id.split("_")[1]));
  const chosen = goalCandidates(citizen, household)
    .map((candidate) => ({ ...candidate, score: candidate.score + rand() * 18 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  citizen.personalGoals = chosen.map((candidate) => {
    const previous = existing.get(candidate.kind);
    return {
      id: goalId(citizen, candidate.kind),
      kind: candidate.kind,
      title: candidate.title,
      reason: candidate.reason,
      priority: clamp(candidate.priority, 0, 100),
      progress: previous?.progress ?? 0,
      status: previous?.status ?? "active",
      createdDay: previous?.createdDay ?? sim.day,
    };
  });

  citizen.goalFocus = citizen.personalGoals[0]?.title ?? "get through the day";
  if (previousFocus && previousFocus !== citizen.goalFocus) {
    recordJournal(sim, citizen, `I started focusing on "${citizen.goalFocus}" because my life has shifted.`);
  }
}

export function goalPressure(citizen: Citizen, kind: PersonalGoalKind) {
  const goal = citizen.personalGoals.find((item) => item.kind === kind && item.status === "active");
  if (!goal) return 0;
  return goal.priority * 0.32 + (100 - goal.progress) * 0.08;
}

export function updateGoalProgress(sim: SimulationState, citizen: Citizen, simMinutes: number, recordJournal: RecordJournal) {
  for (const goal of citizen.personalGoals) {
    if (goal.status === "completed") continue;
    let gain = 0;
    if (goal.kind === "school" && citizen.currentIntention === "school") gain = simMinutes * 0.08;
    if (goal.kind === "career" && citizen.currentIntention === "work") gain = simMinutes * 0.07;
    if (goal.kind === "money" && citizen.currentIntention === "work") gain = simMinutes * 0.045;
    if (goal.kind === "friendship" && citizen.currentIntention === "socialize") gain = simMinutes * 0.09;
    if (goal.kind === "family" && citizen.currentIntention === "home") gain = simMinutes * 0.035;
    if (goal.kind === "wellbeing" && (citizen.currentIntention === "recover" || citizen.currentIntention === "sleep")) gain = simMinutes * 0.11;
    if (goal.kind === "curiosity" && citizen.currentIntention === "wander") gain = simMinutes * 0.08;
    citizen.today.goalProgress += gain;
    goal.progress = clamp(goal.progress + gain, 0, 100);
    if (goal.progress >= 100) {
      goal.status = "completed";
      recordJournal(sim, citizen, `I completed my goal: ${goal.title}.`);
    }
  }
}

export function currentObligation(citizen: Citizen, minute: number, sim: SimulationState): CitizenIntention | null {
  const commuteStart = citizen.routine.workStartMinute - (18 + Math.round(citizen.routine.punctuality * 26));
  const activeHours = minute >= commuteStart && minute < citizen.routine.workEndMinute;
  if (!activeHours) return null;
  if (citizen.schoolClass) return "school";
  if (citizen.workplaceId && !(sim.factoryClosed && citizen.workplaceId === "factory")) return "work";
  return null;
}

export function thoughtFor(citizen: Citizen, intention: CitizenIntention, destinationId: string, obligation: CitizenIntention | null, sim?: SimulationState) {
  const destination = buildingById(destinationId).name;
  const household = sim?.households.find((item) => item.id === citizen.householdId);
  const moneyPressure = personalMoneyPressure(citizen) + householdMoneyPressure(household);
  if (intention === "sleep") return "I need sleep more than anything right now.";
  if (isYoungChild(citizen)) {
    if (intention === "school") return "I should stay with my class and teacher.";
    if (intention === "eat") return "I am hungry. I need someone at home to help me.";
    if (intention === "recover") return "I do not feel good. I need an adult to help me.";
    if (intention === "socialize") return "I want to be near someone I know.";
    if (intention === "wander") return "I want to play somewhere close and familiar.";
    return "I want to be somewhere familiar.";
  }
  if (isChild(citizen)) {
    if (intention === "eat") return "I am hungry, but I should get food through home or school.";
    if (intention === "recover") return "I should tell an adult I do not feel right.";
    if (intention === "errand") return "I should not handle errands alone yet.";
  }
  if (intention === "school") return citizen.institutionRole === "student" ? "I should get to class before I fall behind." : "The students need me at school today.";
  if (intention === "work") return moneyPressure > 0 ? "I should show up today. The money matters right now." : "I should show up and keep money coming in.";
  if (intention === "eat") return moneyPressure > 0 ? "I am hungry, but I need to watch what I spend." : "I am hungry enough to go find food.";
  if (intention === "socialize") return `I want to be around people at ${destination}.`;
  if (intention === "errand") return moneyPressure > 0 ? `I can take care of something at ${destination}, but only if it is worth the cost.` : `I can take care of something at ${destination}.`;
  if (intention === "recover") {
    if (moneyPressure > 0 && destinationId === "clinic") return "I need help, but clinic costs are on my mind.";
    return obligation ? "I know I should go in, but I am too drained today." : "I need a quieter day to recover.";
  }
  if (intention === "wander") return `I feel like seeing what is happening near ${destination}.`;
  return citizen.goalFocus ? `I want to be home for a while. I keep thinking about: ${citizen.goalFocus}.` : "I want to be home for a while.";
}

export function chooseCitizenDecision(sim: SimulationState, citizen: Citizen, rand: () => number): { intention: CitizenIntention; destinationId: string; reasoning: DecisionReasoning } {
  const minute = sim.minute;
  const household = sim.households.find((item) => item.id === citizen.householdId);
  const obligation = currentObligation(citizen, minute, sim);
  const sleepTime = minute >= citizen.routine.sleepMinute || minute < citizen.routine.wakeMinute;
  const lunchTime = minute >= citizen.routine.lunchMinute && minute < citizen.routine.lunchMinute + 55;
  const personality = citizen.personality;
  const needs = citizen.needs;
  const moneyPressure = personalMoneyPressure(citizen) + householdMoneyPressure(household);
  const scores: Array<{ intention: CitizenIntention; destinationId: string; score: number }> = [];

  scores.push({ intention: "home", destinationId: citizen.homeId, score: 24 + needs.rest * 0.35 + (household?.stress ?? 0) * 0.08 });
  if (sleepTime) scores.push({ intention: "sleep", destinationId: citizen.homeId, score: 110 + needs.rest * 1.25 });

  if (obligation === "school") {
    scores.push({
      intention: "school",
      destinationId: "school",
      score: 68 + personality.responsibility * 0.65 + personality.ambition * 0.22 + goalPressure(citizen, "school") - needs.rest * 0.45 - needs.fun * 0.16,
    });
  }

  if (obligation === "work" && citizen.workplaceId) {
    scores.push({
      intention: "work",
      destinationId: citizen.workplaceId,
      score: 70 + moneyPressure * 0.42 + personality.responsibility * 0.72 + personality.ambition * 0.32 + goalPressure(citizen, "career") + goalPressure(citizen, "money") - needs.rest * 0.55 - needs.fun * 0.12 - (household?.stress ?? 0) * 0.08,
    });
  }

  if (lunchTime || needs.hunger > 58) {
    scores.push({
      intention: "eat",
      destinationId: isChild(citizen) ? citizen.homeId : "market",
      score: 28 + needs.hunger * 0.95 + (lunchTime ? 34 : 0) - moneyPressure * 0.18,
    });
  }

  if (!sleepTime) {
    scores.push({
      intention: "socialize",
      destinationId: isChild(citizen) ? pick(rand, [citizen.homeId, "school"]) : pick(rand, SOCIAL_DESTINATIONS),
      score: 14 + needs.belonging * 0.55 + personality.sociability * 0.42 + goalPressure(citizen, "friendship") - needs.rest * 0.18,
    });
    scores.push({
      intention: "wander",
      destinationId: isChild(citizen) ? pick(rand, [citizen.homeId, "school"]) : pick(rand, ["market", "clinic", "school", citizen.homeId]),
      score: 9 + needs.fun * 0.42 + personality.curiosity * 0.36 + (isChild(citizen) ? 0 : personality.independence * 0.18) + goalPressure(citizen, "curiosity"),
    });
    if (canRunIndependentErrands(citizen)) {
      scores.push({
        intention: "errand",
        destinationId: pick(rand, ["market", "clinic"]),
        score: 12 + citizen.routine.errandChance * 42 + needs.hunger * 0.18 + (household?.foodStock && household.foodStock < 35 ? 30 : 0) - moneyPressure * 0.22,
      });
    }
  }

  if (needs.rest > 62 || citizen.mood < 38) {
    scores.push({
      intention: "recover",
      destinationId: citizen.homeId,
      score: 26 + needs.rest * 0.9 + (45 - citizen.mood) * 0.75 + personality.independence * 0.18 + goalPressure(citizen, "wellbeing") - personality.responsibility * 0.26,
    });
  }

  const weatherAdjusted = scores.map((item) => ({ ...item, score: item.score + weatherDecisionModifier(item.intention, sim) }));
  const jittered = weatherAdjusted.map((item) => ({ ...item, score: item.score + rand() * 22 }));
  jittered.sort((a, b) => b.score - a.score);
  const scored: DecisionScore[] = jittered.slice(0, 4).map((item) => ({
    intention: item.intention,
    destinationId: item.destinationId,
    destinationName: buildingById(item.destinationId).name,
    score: Math.round(item.score),
    reason: explainScore(item.intention, citizen, sim, item.destinationId, obligation),
  }));
  const rawChosen = scored[0];
  const authority = evaluateAuthority(sim, citizen, rawChosen, obligation, rand);
  let chosen = rawChosen;
  let alternatives = scored.slice(1);

  if ((authority.outcome === "guided" || authority.outcome === "blocked") && authority.expectedIntention && authority.expectedDestinationId) {
    const expected = scored.find((item) => item.intention === authority.expectedIntention && item.destinationId === authority.expectedDestinationId) ?? {
      intention: authority.expectedIntention,
      destinationId: authority.expectedDestinationId,
      destinationName: buildingById(authority.expectedDestinationId).name,
      score: Math.max(rawChosen.score + 8, authority.pressure),
      reason: authority.reason,
    };
    chosen = {
      ...expected,
      score: Math.max(expected.score, rawChosen.score + 6),
      reason: authority.reason,
    };
    alternatives = [rawChosen, ...scored.filter((item) => item !== rawChosen && item !== expected)].slice(0, 3);
  }

  const authorityPrefix = authority.outcome === "free"
    ? ""
    : authority.outcome === "defied"
      ? ` ${authority.authority} pushed back, but they defied it.`
      : ` ${authority.authority} redirected the choice.`;
  return {
    intention: chosen.intention,
    destinationId: chosen.destinationId,
    reasoning: {
      decidedAtDay: sim.day,
      decidedAtTime: formatTime(sim.minute),
      chosen,
      alternatives,
      authority,
      summary: `${labelIntent(chosen.intention)} won because ${chosen.reason.charAt(0).toLowerCase()}${chosen.reason.slice(1)}${authorityPrefix}`,
    },
  };
}

export function chooseConversationTopic(sim: SimulationState, a: Citizen, b: Citizen, rand: () => number): ConversationTopic {
  if (isYoungChild(a) || isYoungChild(b)) {
    const childOptions: ConversationTopic[] = ["daily life"];
    if (a.householdId === b.householdId || a.familyRole === "parent" || b.familyRole === "parent") childOptions.push("family");
    if (a.schoolClass || b.schoolClass || a.workplaceId === "school" || b.workplaceId === "school") childOptions.push("school");
    if (a.problems.length || b.problems.length) childOptions.push("personal problem");
    return pick(rand, childOptions);
  }

  const options: ConversationTopic[] = ["daily life", "future plans"];
  if (a.workplaceId && a.workplaceId === b.workplaceId) options.push("workplace gossip");
  if (a.problems.length || b.problems.length) options.push("personal problem");
  if (personalMoneyPressure(a) > 0 || personalMoneyPressure(b) > 0) options.push("money stress");
  if (a.householdId === b.householdId || a.familyRole === "parent" || b.familyRole === "parent") options.push("family");
  if (a.schoolClass || b.schoolClass || a.workplaceId === "school" || b.workplaceId === "school") options.push("school");
  if (a.knownFacts.includes(FACTORY_RUMOR) || b.knownFacts.includes(FACTORY_RUMOR)) options.push("rumor");
  if (sim.citizens.length > 3) options.push("people gossip");
  return pick(rand, options);
}

export function conversationText(sim: SimulationState, speaker: Citizen, listener: Citizen, topic: ConversationTopic, rand: () => number) {
  if (topic === "workplace gossip" && speaker.workplaceId) {
    return `${speaker.name} talked about pressure at ${buildingById(speaker.workplaceId).name}.`;
  }
  if (topic === "people gossip") {
    const other = pick(rand, sim.citizens.filter((citizen) => citizen.id !== speaker.id && citizen.id !== listener.id));
    return `${speaker.name} wondered what ${other.name} has been dealing with lately.`;
  }
  if (topic === "money stress") return `${speaker.name} admitted that money has been on their mind.`;
  if (topic === "family") return `${speaker.name} talked about trying to keep things steady at home.`;
  if (topic === "school") return `${speaker.name} talked about school, teachers, and whether the day was going well.`;
  if (topic === "future plans") return `${speaker.name} shared a future plan: ${speaker.goalFocus}.`;
  if (topic === "personal problem") return `${speaker.name} opened up about ${speaker.problems[0]?.toLowerCase() ?? "having a hard day"}`;
  if (topic === "rumor") return `${speaker.name} brought up a rumor moving through town.`;
  return `${speaker.name} and ${listener.name} talked about ordinary life in Northbridge.`;
}

export function classifyConversation(topic: ConversationTopic, speaker: Citizen, listener: Citizen): { classification: ConversationClassification; reason: string } {
  if (topic === "rumor" || topic === "people gossip") {
    return { classification: "secretive", reason: "This involves rumors or talk about someone who is not present." };
  }
  if (topic === "personal problem" || topic === "money stress") {
    return { classification: "supportive", reason: "Someone is sharing pressure, and the other person is giving them room to be heard." };
  }
  if (topic === "future plans") {
    return { classification: "planning", reason: "The conversation is about a goal or possible future direction." };
  }
  if (topic === "family" || topic === "workplace gossip" || topic === "school") {
    return { classification: "serious", reason: "The topic touches responsibilities, institutions, or household pressure." };
  }
  if (speaker.problems.length || listener.problems.length) {
    return { classification: "supportive", reason: "One of them is carrying an active problem into the exchange." };
  }
  return { classification: "casual", reason: "Nothing urgent is driving this one; it is ordinary social contact." };
}

export function emotionAfterConversation(topic: ConversationTopic): CitizenEmotion {
  return topic === "personal problem" || topic === "money stress" ? "worried" : "connected";
}
