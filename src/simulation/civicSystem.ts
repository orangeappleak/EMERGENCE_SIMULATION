import type {
  Citizen,
  CivicIssue,
  CivicIssueKind,
  CivicIssueStatus,
  ConversationEntry,
  ConversationTopic,
  SimulationState,
  TownConcern,
  WorldObservation,
  WorldObservationKind,
  WorldSignal,
} from "../types/simulation";
import { BUILDINGS } from "./constants";
import { addWorldDecision, addWorldObservation } from "./eventLog";
import { clamp } from "./random";
import { formatTime } from "./time";

function issueStatusFor(severity: number, force = false): CivicIssueStatus {
  if (force && severity >= 42) return "active";
  if (severity >= 75) return "urgent";
  if (severity >= 42) return "active";
  return "watching";
}

function upsertCivicIssue(
  sim: SimulationState,
  issue: Omit<CivicIssue, "firstSeenDay" | "lastUpdatedDay" | "lastUpdatedTime" | "status">,
) {
  const previous = sim.civicIssues.find((item) => item.id === issue.id);
  const forceImmediate = issue.kind === "employment" && sim.factoryClosed;

  const status = issueStatusFor(issue.severity, forceImmediate);
  if (previous) {
    const previousStatus = previous.status;
    previous.title = issue.title;
    previous.kind = issue.kind;
    previous.status = status;
    previous.severity = issue.severity;
    previous.awareness = issue.awareness;
    previous.affectedCitizenIds = issue.affectedCitizenIds;
    previous.evidence = issue.evidence;
    previous.lastUpdatedDay = sim.day;
    previous.lastUpdatedTime = formatTime(sim.minute);
    if (previousStatus !== status && status !== "watching") {
      addWorldDecision(sim, {
        category: "civic",
        status: "automatic",
        impact: status === "urgent" ? "high" : "medium",
        title: `${issue.title} became ${status}`,
        summary: issue.evidence[0] ?? "The town recognized a repeated pattern.",
        relatedCitizenIds: issue.affectedCitizenIds,
        requiresApproval: false,
        reason: "The issue detector saw a civic pressure threshold change.",
        effect: "This issue can later become proposal fuel for leaders, meetings, or institutions.",
      });
    }
    return;
  }

  sim.civicIssues.unshift({
    ...issue,
    status,
    firstSeenDay: sim.day,
    lastUpdatedDay: sim.day,
    lastUpdatedTime: formatTime(sim.minute),
  });
  if (status === "watching") return;

  addWorldDecision(sim, {
    category: "civic",
    status: "automatic",
    impact: status === "urgent" ? "high" : "medium",
    title: `${issue.title} entered the civic agenda`,
    summary: issue.evidence[0] ?? "The town recognized a repeated pattern.",
    relatedCitizenIds: issue.affectedCitizenIds,
    requiresApproval: false,
    reason: "A recurring town problem became visible enough to track.",
    effect: "Citizens can later talk, rally, or propose solutions around this issue.",
  });
}

function hasCivicMaturity(citizen: Citizen) {
  return citizen.lifeStage === "adult" || citizen.lifeStage === "elder";
}

function conversationHasCivicMaturity(sim: SimulationState, entry: ConversationEntry) {
  const speaker = entry.speakerId ? sim.citizens.find((citizen) => citizen.id === entry.speakerId) : null;
  const listener = sim.citizens.find((citizen) => citizen.id === entry.withId);
  return Boolean((speaker && hasCivicMaturity(speaker)) || (listener && hasCivicMaturity(listener)));
}

function observationKindForTopic(topic: ConversationTopic): WorldObservationKind {
  if (topic === "money stress") return "money";
  if (topic === "school") return "education";
  if (topic === "workplace gossip") return "employment";
  if (topic === "family") return "housing";
  if (topic === "future plans" || topic === "personal problem") return "social";
  if (topic === "rumor") return "general";
  return "social";
}

function householdMoneyIsDiscovered(sim: SimulationState, household: SimulationState["households"][number]) {
  return sim.day > 1 && (
    household.moneyFriction >= 2
    || household.unpaidBills > household.rent * 0.22
    || household.financialStatus === "critical"
  );
}

function householdFoodIsDiscovered(sim: SimulationState, household: SimulationState["households"][number]) {
  return sim.day > 1 && (household.foodFriction >= 2 || household.foodStock < 25);
}

function signalTitle(kind: WorldObservationKind, buildingName?: string, householdName?: string) {
  if (buildingName) return `${buildingName} pattern`;
  if (householdName) return `${householdName} pattern`;
  const labels: Record<WorldObservationKind, string> = {
    money: "Money strain signal",
    healthcare: "Healthcare pressure signal",
    employment: "Work stability signal",
    education: "School support signal",
    food: "Food security signal",
    governance: "Civic coordination signal",
    movement: "Town movement signal",
    weather: "Weather adaptation signal",
    social: "Social wellbeing signal",
    housing: "Household life signal",
    safety: "Safety signal",
    general: "Town pattern signal",
  };
  return labels[kind];
}

function signalStatus(confidence: number, maturity: number, severity: number): TownConcern["status"] {
  if ((confidence >= 70 && maturity >= 45) || (severity >= 78 && confidence >= 55)) return "strong";
  if (confidence >= 35 || maturity >= 22) return "watched";
  return "forming";
}

function isCivicIssueKind(kind: WorldObservationKind): kind is CivicIssueKind {
  return ["money", "healthcare", "employment", "education", "governance", "food"].includes(kind);
}

const ISSUE_EARLIEST_DAY: Record<CivicIssueKind, number> = {
  money: 2,
  healthcare: 2,
  employment: 2,
  education: 2,
  food: 2,
  governance: 3,
};

const ISSUE_MIN_EVIDENCE: Record<CivicIssueKind, number> = {
  money: 3,
  healthcare: 3,
  employment: 3,
  education: 3,
  food: 3,
  governance: 4,
};

function suggestedIssueKind(kind: WorldObservationKind): CivicIssueKind | undefined {
  return isCivicIssueKind(kind) ? kind : undefined;
}

function primarySignalKey(observation: WorldObservation) {
  if (observation.kind === "employment" || observation.kind === "governance" || observation.kind === "weather") {
    return `${observation.kind}:town`;
  }
  const place = observation.buildingId ?? observation.householdId ?? observation.tags[0] ?? "town";
  return `${observation.kind}:${place}`;
}

function concernStatus(confidence: number, maturity: number, severity: number, promoted: boolean): TownConcern["status"] {
  if (promoted) return "promoted";
  return signalStatus(confidence, maturity, severity);
}

function syncWorldSignalsFromConcerns(sim: SimulationState) {
  sim.worldSignals = sim.townConcerns.map((concern): WorldSignal => ({
    id: concern.id.replace(/^concern-/, "signal-"),
    kind: concern.kind,
    title: concern.title,
    status: concern.status,
    confidence: concern.confidence,
    severity: concern.severity,
    maturity: concern.maturity,
    observationIds: concern.observationIds,
    affectedCitizenIds: concern.affectedCitizenIds,
    relatedBuildingIds: concern.relatedBuildingIds,
    tags: concern.tags,
    evidence: concern.evidence,
    firstSeenDay: concern.firstSeenDay,
    lastUpdatedDay: concern.lastUpdatedDay,
    lastUpdatedTime: concern.lastUpdatedTime,
  }));
}

function rebuildTownConcerns(sim: SimulationState) {
  const groups = new Map<string, WorldObservation[]>();
  const recentObservations = sim.worldObservations.filter((entry) => sim.day - entry.day <= 4);
  for (const observation of recentObservations) {
    const key = primarySignalKey(observation);
    groups.set(key, [...(groups.get(key) ?? []), observation]);
  }

  const concerns: TownConcern[] = [];
  for (const [key, observations] of groups) {
    const firstObservation = observations[observations.length - 1];
    const latestObservation = observations[0];
    const affectedCitizenIds = [...new Set(observations.map((entry) => entry.citizenId).filter(Boolean) as string[])];
    const relatedBuildingIds = [...new Set(observations.map((entry) => entry.buildingId).filter(Boolean) as string[])];
    const tags = [...new Set(observations.flatMap((entry) => entry.tags))].slice(0, 8);
    const adultEvidence = observations.filter((entry) => {
      if (!entry.citizenId) return true;
      const citizen = sim.citizens.find((item) => item.id === entry.citizenId);
      return citizen ? hasCivicMaturity(citizen) : true;
    }).length;
    const daysSpanned = new Set(observations.map((entry) => entry.day)).size;
    const averageSeverity = observations.reduce((sum, entry) => sum + entry.severity, 0) / observations.length;
    const averageConfidence = observations.reduce((sum, entry) => sum + entry.confidence, 0) / observations.length;
    const confidence = clamp(observations.length * 10 + adultEvidence * 7 + averageConfidence * 0.35, 8, 100);
    const maturity = clamp(daysSpanned * 18 + adultEvidence * 8 + observations.length * 3, 4, 100);
    const severity = clamp(averageSeverity + Math.max(0, observations.length - 1) * 2, 5, 100);
    const buildingName = firstObservation.buildingName;
    const householdName = firstObservation.householdName;

    const promoted = isCivicIssueKind(firstObservation.kind)
      && sim.civicIssues.some((issue) => issue.kind === firstObservation.kind && issue.status !== "resolved");

    const existingIssue = firstObservation.kind === "general"
      ? undefined
      : sim.civicIssues.find((issue) => issue.kind === firstObservation.kind && issue.status !== "resolved");

    concerns.push({
      id: `concern-${key.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
      kind: firstObservation.kind,
      title: signalTitle(firstObservation.kind, buildingName, householdName),
      status: concernStatus(confidence, maturity, severity, promoted),
      confidence: Math.round(confidence),
      severity: Math.round(severity),
      maturity: Math.round(maturity),
      observationIds: observations.map((entry) => entry.id),
      affectedCitizenIds,
      relatedBuildingIds,
      tags,
      evidence: observations.slice(0, 4).map((entry) => entry.summary),
      suggestedIssueKind: suggestedIssueKind(firstObservation.kind),
      promotedIssueId: existingIssue?.id,
      firstSeenDay: firstObservation.day,
      lastUpdatedDay: latestObservation.day,
      lastUpdatedTime: latestObservation.time,
    });
  }

  sim.townConcerns = concerns
    .sort((a, b) => (b.confidence + b.severity + b.maturity) - (a.confidence + a.severity + a.maturity))
    .slice(0, 80);
  syncWorldSignalsFromConcerns(sim);
}

export function detectWorldObservations(sim: SimulationState) {
  for (const household of sim.households) {
    const members = sim.citizens.filter((citizen) => citizen.householdId === household.id);
    const adultMember = members.find(hasCivicMaturity);
    if ((household.financialStatus !== "stable" || household.unpaidBills > 0) && householdMoneyIsDiscovered(sim, household)) {
      addWorldObservation(sim, {
        kind: "money",
        source: "need",
        summary: `${household.name} is showing money pressure.`,
        detail: `${household.name} is ${household.financialStatus} with $${Math.round(household.unpaidBills).toLocaleString()} in unpaid bills.`,
        citizenId: adultMember?.id,
        citizenName: adultMember?.name,
        householdId: household.id,
        householdName: household.name,
        severity: clamp(household.stress + household.unpaidBills * 0.02, 10, 100),
        confidence: adultMember ? 55 : 35,
        tags: ["household", "money", household.financialStatus],
      });
    }
    if (household.foodStock < 35 && householdFoodIsDiscovered(sim, household)) {
      addWorldObservation(sim, {
        kind: "food",
        source: "need",
        summary: `${household.name} has low food at home.`,
        detail: `${household.name} has ${Math.round(household.foodStock)}% food stock remaining.`,
        citizenId: adultMember?.id,
        citizenName: adultMember?.name,
        householdId: household.id,
        householdName: household.name,
        severity: clamp(60 - household.foodStock, 18, 100),
        confidence: 52,
        tags: ["household", "food", "need"],
      });
    }
  }

  const conversationsToday = sim.conversationLog.filter((entry) => entry.day === sim.day);
  const matureSeriousTalks = conversationsToday.filter((entry) => (
    (entry.classification === "serious" || entry.classification === "planning")
    && conversationHasCivicMaturity(sim, entry)
  ));
  for (const entry of conversationsToday.slice(0, 24)) {
    if (entry.classification !== "serious" && entry.classification !== "planning" && entry.topic !== "money stress" && entry.topic !== "personal problem") continue;
    const building = entry.locationId ? BUILDINGS.find((item) => item.id === entry.locationId) : undefined;
    addWorldObservation(sim, {
      kind: observationKindForTopic(entry.topic),
      source: "conversation",
      summary: `${entry.speakerName ?? "Someone"} and ${entry.withName} talked about ${entry.topic}.`,
      detail: entry.text,
      citizenId: entry.speakerId,
      citizenName: entry.speakerName,
      buildingId: building?.id,
      buildingName: building?.name,
      severity: entry.classification === "serious" ? 58 : entry.classification === "planning" ? 48 : 36,
      confidence: conversationHasCivicMaturity(sim, entry) ? 62 : 32,
      tags: [entry.topic, entry.classification],
    });
  }

  const coordinatedConcerns = sim.townConcerns.filter((concern) => (
    concern.suggestedIssueKind
    && concern.kind !== "governance"
    && concern.maturity >= 30
    && (concern.status === "watched" || concern.status === "strong" || concern.status === "promoted")
  )).length;
  if (sim.day >= 2 && ((matureSeriousTalks.length >= 14 && coordinatedConcerns >= 1) || coordinatedConcerns >= 3)) {
    const adult = sim.citizens.find((citizen) => hasCivicMaturity(citizen) && (citizen.personality.responsibility > 55 || citizen.personality.sociability > 60));
    addWorldObservation(sim, {
      kind: "governance",
      source: "conversation",
      summary: "People are starting to notice that town problems need coordination.",
      detail: `${matureSeriousTalks.length} mature serious or planning conversations happened today, with ${coordinatedConcerns} town concerns already being watched.`,
      citizenId: adult?.id,
      citizenName: adult?.name,
      severity: clamp(matureSeriousTalks.length * 5 + coordinatedConcerns * 12, 18, 100),
      confidence: clamp(matureSeriousTalks.length * 5 + coordinatedConcerns * 16, 20, 100),
      tags: ["coordination", "civic", "leadership"],
    });
  }

  const transactionsToday = sim.transactionLog.filter((entry) => entry.day === sim.day);
  const clinicTransactions = transactionsToday.filter((entry) => entry.category === "clinic");
  if (clinicTransactions.length >= 2) {
    addWorldObservation(sim, {
      kind: "healthcare",
      source: "transaction",
      summary: `${clinicTransactions.length} clinic payments happened today.`,
      detail: clinicTransactions.some((entry) => entry.note.includes("could not afford"))
        ? "At least one clinic visit could not be fully paid."
        : "Clinic demand is showing up in the town ledger.",
      buildingId: "clinic",
      buildingName: "Clinic",
      severity: clamp(clinicTransactions.length * 10, 16, 100),
      confidence: 58,
      tags: ["clinic", "healthcare", "money"],
    });
  }

  const unemployedAdults = sim.citizens.filter((citizen) => !citizen.workplaceId && !citizen.schoolClass && citizen.lifeStage !== "child" && citizen.lifeStage !== "teen" && citizen.lifeStage !== "elder");
  for (const citizen of unemployedAdults.slice(0, 8)) {
    addWorldObservation(sim, {
      kind: "employment",
      source: "routine",
      summary: `${citizen.name} does not have a stable workplace yet.`,
      detail: `${citizen.name} is an adult without a workplace assignment.`,
      citizenId: citizen.id,
      citizenName: citizen.name,
      householdId: citizen.householdId,
      householdName: sim.households.find((household) => household.id === citizen.householdId)?.name,
      severity: 42,
      confidence: 50,
      tags: ["work", "routine"],
    });
  }

  if (sim.weather.kind === "rain" || sim.weather.kind === "fog") {
    addWorldObservation(sim, {
      kind: "weather",
      source: "weather",
      summary: `${sim.weather.kind} weather is changing how the town feels today.`,
      detail: `The weather is ${sim.weather.kind} and ${sim.weather.temperature}F.`,
      severity: sim.weather.kind === "rain" ? 35 : 24,
      confidence: 70,
      tags: ["weather", sim.weather.kind],
    });
  }

  for (const building of BUILDINGS) {
    const nearby = sim.citizens.filter((citizen) => Math.hypot(citizen.x - building.x, citizen.y - building.y) < 80);
    if (nearby.length < 8) continue;
    addWorldObservation(sim, {
      kind: "movement",
      source: "place",
      summary: `Crowding is forming around ${building.name}.`,
      detail: `${nearby.length} people are near ${building.name}.`,
      buildingId: building.id,
      buildingName: building.name,
      severity: clamp(nearby.length * 6, 20, 100),
      confidence: 48,
      tags: ["crowding", building.kind],
    });
  }

  rebuildTownConcerns(sim);
}

function concernForIssue(sim: SimulationState, kind: CivicIssueKind) {
  return sim.townConcerns
    .filter((concern) => concern.suggestedIssueKind === kind)
    .sort((a, b) => (b.confidence + b.maturity + b.severity) - (a.confidence + a.maturity + a.severity))[0];
}

function concernCanPromoteIssue(sim: SimulationState, kind: CivicIssueKind, force = false) {
  if (force) return true;
  if (sim.day < ISSUE_EARLIEST_DAY[kind]) return false;
  const concern = concernForIssue(sim, kind);
  if (!concern) return false;
  const daysObserved = Math.max(0, sim.day - concern.firstSeenDay);
  if (daysObserved < 1 || concern.observationIds.length < ISSUE_MIN_EVIDENCE[kind]) return false;
  return concern.status === "strong" || (concern.confidence >= 68 && concern.maturity >= 56 && concern.severity >= 42);
}

function concernEvidence(sim: SimulationState, kind: CivicIssueKind) {
  const concern = concernForIssue(sim, kind);
  if (!concern) return [];
  return [
    `Concern: ${concern.title} is ${concern.status} at ${concern.confidence}% confidence and ${concern.maturity}% maturity.`,
    ...concern.evidence.slice(0, 2),
  ];
}

export function detectCivicIssues(sim: SimulationState) {
  const strainedHouseholds = sim.households.filter((household) => household.financialStatus !== "stable");
  const unpaidBills = sim.households.reduce((sum, household) => sum + household.unpaidBills, 0);
  const moneyStressTalks = sim.conversationLog.filter((entry) => entry.day === sim.day && entry.topic === "money stress").length;
  const clinicTransactions = sim.transactionLog.filter((entry) => entry.day === sim.day && entry.category === "clinic").length;
  const clinicShortfalls = sim.transactionLog.filter((entry) => entry.day === sim.day && entry.category === "clinic" && entry.note.includes("could not afford")).length;
  const unemployed = sim.citizens.filter((citizen) => !citizen.workplaceId && !citizen.schoolClass && citizen.lifeStage === "adult");
  const lowFoodHouseholds = sim.households.filter((household) => household.foodStock < 35);
  const schoolTrouble = sim.citizens.filter((citizen) => citizen.schoolProgress && (citizen.schoolProgress.attendance < 55 || citizen.schoolProgress.grades < 45));
  const seriousTownTalk = sim.conversationLog.filter((entry) => (
    entry.day === sim.day
    && (entry.classification === "serious" || entry.classification === "planning")
    && conversationHasCivicMaturity(sim, entry)
  )).length;

  const discoveredStrainedHouseholds = strainedHouseholds.filter((household) => householdMoneyIsDiscovered(sim, household));
  if ((discoveredStrainedHouseholds.length > 0 || unpaidBills > 0 || moneyStressTalks > 3) && concernCanPromoteIssue(sim, "money")) {
    const affected = discoveredStrainedHouseholds.flatMap((household) => household.memberIds);
    upsertCivicIssue(sim, {
      id: "money-strain",
      kind: "money",
      title: "Household financial strain",
      severity: clamp(discoveredStrainedHouseholds.length * 18 + unpaidBills * 0.02 + moneyStressTalks * 3, 20, 100),
      awareness: clamp(moneyStressTalks * 9 + discoveredStrainedHouseholds.length * 7, 8, 100),
      affectedCitizenIds: affected,
      evidence: [
        `${discoveredStrainedHouseholds.length} households are strained or critical.`,
        `$${Math.round(unpaidBills).toLocaleString()} in unpaid household bills exists across town.`,
        `${moneyStressTalks} money-stress conversations happened today.`,
        ...concernEvidence(sim, "money"),
      ],
    });
  }

  if ((clinicTransactions >= 4 || clinicShortfalls > 0) && concernCanPromoteIssue(sim, "healthcare")) {
    upsertCivicIssue(sim, {
      id: "clinic-access",
      kind: "healthcare",
      title: "Clinic access pressure",
      severity: clamp(clinicTransactions * 10 + clinicShortfalls * 24, 22, 100),
      awareness: clamp(clinicTransactions * 8 + clinicShortfalls * 16, 8, 100),
      affectedCitizenIds: sim.transactionLog
        .filter((entry) => entry.day === sim.day && entry.category === "clinic" && entry.citizenId)
        .map((entry) => entry.citizenId as string),
      evidence: [
        `${clinicTransactions} clinic payments happened today.`,
        clinicShortfalls ? `${clinicShortfalls} clinic visits could not be fully paid.` : "Clinic demand is becoming visible.",
        ...concernEvidence(sim, "healthcare"),
      ],
    });
  }

  if (sim.factoryClosed || (unemployed.length >= 3 && concernCanPromoteIssue(sim, "employment"))) {
    upsertCivicIssue(sim, {
      id: "employment-gap",
      kind: "employment",
      title: "Employment instability",
      severity: clamp(unemployed.length * 13 + (sim.factoryClosed ? 25 : 0), 20, 100),
      awareness: clamp(unemployed.length * 8 + (sim.factoryClosed ? 30 : 0), 8, 100),
      affectedCitizenIds: unemployed.map((citizen) => citizen.id),
      evidence: [
        `${unemployed.length} working-age adults do not have a workplace.`,
        sim.factoryClosed ? "Northbridge Works has closed." : "Job gaps are becoming noticeable.",
        ...concernEvidence(sim, "employment"),
      ],
    });
  }

  const discoveredLowFoodHouseholds = lowFoodHouseholds.filter((household) => householdFoodIsDiscovered(sim, household));
  if (discoveredLowFoodHouseholds.length >= 2 && concernCanPromoteIssue(sim, "food")) {
    upsertCivicIssue(sim, {
      id: "food-security",
      kind: "food",
      title: "Food security concern",
      severity: clamp(discoveredLowFoodHouseholds.length * 16, 18, 100),
      awareness: clamp(discoveredLowFoodHouseholds.length * 9 + moneyStressTalks * 2, 8, 100),
      affectedCitizenIds: discoveredLowFoodHouseholds.flatMap((household) => household.memberIds),
      evidence: [`${discoveredLowFoodHouseholds.length} households have low food stock.`, ...concernEvidence(sim, "food")],
    });
  }

  if (schoolTrouble.length >= 3 && concernCanPromoteIssue(sim, "education")) {
    upsertCivicIssue(sim, {
      id: "school-strain",
      kind: "education",
      title: "Student support strain",
      severity: clamp(schoolTrouble.length * 11, 20, 100),
      awareness: clamp(schoolTrouble.length * 7 + seriousTownTalk * 2, 8, 100),
      affectedCitizenIds: schoolTrouble.map((citizen) => citizen.id),
      evidence: [`${schoolTrouble.length} students show attendance or grade trouble.`, ...concernEvidence(sim, "education")],
    });
  }

  const activeCivicPressure = sim.civicIssues.filter((issue) => issue.status === "active" || issue.status === "urgent").length;
  if ((seriousTownTalk >= 14 || activeCivicPressure >= 2) && concernCanPromoteIssue(sim, "governance")) {
    upsertCivicIssue(sim, {
      id: "governance-gap",
      kind: "governance",
      title: "No shared civic leadership",
      severity: clamp(seriousTownTalk * 4 + sim.civicIssues.length * 10, 22, 100),
      awareness: clamp(seriousTownTalk * 5 + sim.civicIssues.length * 8, 10, 100),
      affectedCitizenIds: sim.citizens
        .filter((citizen) => hasCivicMaturity(citizen))
        .filter((citizen) => citizen.personality.responsibility > 55 || citizen.personality.sociability > 60)
        .map((citizen) => citizen.id),
      evidence: [
        `${seriousTownTalk} serious or planning conversations happened today.`,
        "There is no formal leader or agency for town problems yet.",
        ...concernEvidence(sim, "governance"),
      ],
    });
  }
}
