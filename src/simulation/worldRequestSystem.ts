import type { Citizen, SimulationState, WorldDecisionImpact, WorldObservationKind, WorldRequest } from "../types/simulation";
import { addFeed, addLifeJournal, addWorldDecision } from "./eventLog";
import { clamp } from "./random";
import { formatTime } from "./time";

function requestExists(sim: SimulationState, title: string, requestedById: string) {
  return sim.worldRequests.some((request) => (
    request.title === title
    && request.requestedById === requestedById
    && (request.status === "pending" || request.day === sim.day)
  ));
}

function requestId(sim: SimulationState, kind: WorldObservationKind, title: string) {
  return `${sim.day}-${Math.round(sim.minute)}-${sim.worldRequests.length}-${kind}-${title}`;
}

function addWorldRequest(sim: SimulationState, request: Omit<WorldRequest, "id" | "day" | "time" | "status">) {
  if (requestExists(sim, request.title, request.requestedById)) return;
  sim.worldRequests.unshift({
    id: requestId(sim, request.kind, request.title),
    day: sim.day,
    time: formatTime(sim.minute),
    status: "pending",
    ...request,
  });
  sim.worldRequests = sim.worldRequests.slice(0, 120);
  addFeed(sim, `${request.requestedByName} submitted a request: ${request.title}.`);
}

function requesterFor(sim: SimulationState, citizenIds: string[]) {
  const people = citizenIds
    .map((id) => sim.citizens.find((citizen) => citizen.id === id))
    .filter((citizen): citizen is Citizen => Boolean(citizen));
  return people.find((citizen) => citizen.lifeStage === "elder")
    ?? people.find((citizen) => citizen.lifeStage === "adult")
    ?? sim.citizens.find((citizen) => citizen.lifeStage === "elder")
    ?? sim.citizens.find((citizen) => citizen.lifeStage === "adult")
    ?? sim.citizens[0];
}

function requestFromConcern(sim: SimulationState) {
  const concern = sim.townConcerns.find((item) => (
    (item.status === "watched" || item.status === "strong")
    && item.maturity >= 45
    && item.evidence.length > 0
  ));
  if (!concern) return;

  const requester = requesterFor(sim, concern.affectedCitizenIds);
  const title = `Review ${concern.title.toLowerCase()}`;
  const impact: WorldDecisionImpact = concern.severity >= 70 ? "high" : concern.severity >= 45 ? "medium" : "low";

  addWorldRequest(sim, {
    kind: concern.kind,
    impact,
    title,
    proposal: `${requester.name} wants the town to review ${concern.title.toLowerCase()} and decide whether a shared response is needed.`,
    requestedById: requester.id,
    requestedByName: requester.name,
    requestedTo: "Town approval",
    relatedCitizenIds: Array.from(new Set([requester.id, ...concern.affectedCitizenIds])).slice(0, 10),
    relatedBuildingIds: concern.relatedBuildingIds,
    evidence: concern.evidence.slice(0, 5),
    needs: ["A place to discuss the concern", "A decision from the town", "Permission before changing the world"],
    expectedEffect: "If approved, this becomes an accepted town direction that future systems can turn into actions, institutions, or map changes.",
    approvalReason: "This request changes shared town priorities, so it needs your approval before it becomes real.",
  });
}

function requestFromPersonalNeed(sim: SimulationState) {
  const candidate = sim.citizens.find((citizen) => (
    (citizen.lifeStage === "elder" || citizen.lifeStage === "adult")
    && citizen.job === "Unemployed"
    && citizen.cash < 220
    && citizen.today.workedMinutes < 1
    && citizen.today.conversations >= 1
  ));
  if (!candidate) return;

  const title = "Explore a small income idea";
  addWorldRequest(sim, {
    kind: "employment",
    impact: "medium",
    title,
    proposal: `${candidate.name} wants permission to explore a small self-run income idea instead of only wandering between public places.`,
    requestedById: candidate.id,
    requestedByName: candidate.name,
    requestedTo: "Town approval",
    relatedCitizenIds: [candidate.id],
    relatedBuildingIds: [candidate.destinationId].filter(Boolean),
    evidence: [
      `${candidate.name} is unemployed and has $${Math.round(candidate.cash).toLocaleString()} cash.`,
      `${candidate.name} has already had ${candidate.today.conversations} conversation${candidate.today.conversations === 1 ? "" : "s"} today.`,
      candidate.currentThought,
    ],
    needs: ["A simple permitted activity", "A place in town", "Future assets or a placeholder stall"],
    expectedEffect: "If approved, this can become a future world change request such as a stand, service, or small local business.",
    approvalReason: "This could change how a citizen earns money and how the town uses space.",
  });
}

export function detectWorldRequests(sim: SimulationState) {
  if (sim.worldRequests.some((request) => request.status === "pending")) return;
  requestFromConcern(sim);
  if (!sim.worldRequests.some((request) => request.status === "pending")) requestFromPersonalNeed(sim);
}

function requestKindToGoalKind(kind: WorldObservationKind) {
  if (kind === "employment") return "career";
  if (kind === "money" || kind === "food" || kind === "housing") return "money";
  if (kind === "healthcare") return "wellbeing";
  if (kind === "education") return "school";
  if (kind === "social" || kind === "governance") return "friendship";
  return "curiosity";
}

function affectedCitizens(sim: SimulationState, request: WorldRequest) {
  return request.relatedCitizenIds
    .map((id) => sim.citizens.find((citizen) => citizen.id === id))
    .filter((citizen): citizen is Citizen => Boolean(citizen));
}

function addConsequenceGoal(sim: SimulationState, citizen: Citizen, request: WorldRequest) {
  const title = request.kind === "employment"
    ? "Turn an approved idea into income"
    : `Help with ${request.title.toLowerCase()}`;
  const existing = citizen.personalGoals.some((goal) => goal.title === title && goal.status === "active");
  if (existing) return;

  citizen.personalGoals.unshift({
    id: `${citizen.id}-${sim.day}-${Math.round(sim.minute)}-request-follow-up`,
    kind: requestKindToGoalKind(request.kind),
    title,
    reason: request.expectedEffect,
    priority: request.impact === "high" ? 78 : request.impact === "medium" ? 62 : 48,
    progress: 0,
    status: "active",
    createdDay: sim.day,
  });
  citizen.personalGoals = citizen.personalGoals.slice(0, 6);
}

function applyRequestConsequences(sim: SimulationState, request: WorldRequest, status: "approved" | "denied") {
  const requester = sim.citizens.find((citizen) => citizen.id === request.requestedById);
  const people = affectedCitizens(sim, request);
  const notes: string[] = [];

  if (status === "approved") {
    if (requester) {
      requester.mood = clamp(requester.mood + 5, 0, 100);
      requester.social = clamp(requester.social + 3, 0, 100);
      requester.currentEmotion = "hopeful";
      requester.currentThought = "My request was approved. Now I need to turn it into something real.";
      addConsequenceGoal(sim, requester, request);
      addLifeJournal(sim, requester, `My request "${request.title}" was approved. I feel like the town is willing to listen.`);
      notes.push(`${requester.name} feels supported and gained a follow-up goal.`);
    }

    people.forEach((citizen) => {
      if (citizen.id === requester?.id) return;
      citizen.mood = clamp(citizen.mood + 1.5, 0, 100);
      citizen.problemAwareness.household = clamp(citizen.problemAwareness.household + 3, 0, 100);
    });
    if (people.length > 1) notes.push(`${people.length - 1} related citizen${people.length === 2 ? "" : "s"} became a little more aware that the town may respond.`);
  } else {
    if (requester) {
      requester.mood = clamp(requester.mood - 5, 0, 100);
      requester.social = clamp(requester.social - 2, 0, 100);
      requester.currentEmotion = requester.mood < 40 ? "worried" : "tired";
      requester.currentThought = "My request was denied. I need to rethink what to do next.";
      addLifeJournal(sim, requester, `My request "${request.title}" was denied. I need another path.`);
      notes.push(`${requester.name} feels discouraged and will need another way forward.`);
    }

    people.forEach((citizen) => {
      if (citizen.id === requester?.id) return;
      citizen.mood = clamp(citizen.mood - 0.8, 0, 100);
    });
    if (people.length > 1) notes.push(`${people.length - 1} related citizen${people.length === 2 ? "" : "s"} noticed the request was rejected.`);
  }

  return notes;
}

export function resolveWorldRequest(sim: SimulationState, requestIdToResolve: string, status: "approved" | "denied") {
  const request = sim.worldRequests.find((item) => item.id === requestIdToResolve);
  if (!request || request.status !== "pending") return;

  request.status = status;
  request.resolvedDay = sim.day;
  request.resolvedTime = formatTime(sim.minute);
  request.resolutionNote = status === "approved"
    ? "Approved by the player. The town can treat this as a real direction."
    : "Denied by the player. The town records the proposal, but it will not become a world change right now.";
  request.consequences = applyRequestConsequences(sim, request, status);

  const resolutionDecision = addWorldDecision(sim, {
    category: request.kind === "employment" || request.kind === "money" || request.kind === "food" ? "economy" : "civic",
    status: status === "approved" ? "approved" : "rejected",
    impact: request.impact,
    title: `${status === "approved" ? "Approved" : "Denied"} request: ${request.title}`,
    summary: request.proposal,
    actorId: request.requestedById,
    actorName: request.requestedByName,
    relatedCitizenIds: request.relatedCitizenIds,
    relatedBuildingId: request.relatedBuildingIds[0],
    requiresApproval: true,
    reason: request.approvalReason,
    effect: request.resolutionNote,
  });

  const followUpDecision = status === "approved"
    ? addWorldDecision(sim, {
        category: request.kind === "employment" || request.kind === "money" || request.kind === "food" ? "economy" : "civic",
        status: "automatic",
        impact: request.impact,
        title: `Follow-up opened: ${request.title}`,
        summary: request.expectedEffect,
        actorId: request.requestedById,
        actorName: request.requestedByName,
        relatedCitizenIds: request.relatedCitizenIds,
        relatedBuildingId: request.relatedBuildingIds[0],
        requiresApproval: false,
        reason: "An approved request should leave work for the town or citizen to pursue instead of ending at approval.",
        effect: request.consequences.length
          ? request.consequences.join(" ")
          : "The approved request is now available as future simulation context.",
      })
    : null;

  request.followUpDecisionIds = [resolutionDecision?.id, followUpDecision?.id].filter((id): id is string => Boolean(id));
  addFeed(sim, `${request.title} was ${status}.`);
}
