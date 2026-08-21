import type { SimulationState, WorldProject, WorldRequest } from "../types/simulation";
import { addFeed, addWorldDecision } from "./eventLog";
import { clamp } from "./random";
import { formatTime } from "./time";

function projectExists(sim: SimulationState, requestId: string) {
  return sim.worldProjects.some((project) => project.sourceRequestId === requestId);
}

function projectTitleFor(request: WorldRequest) {
  if (request.kind === "employment") return request.title.toLowerCase().includes("income")
    ? "Set up a small income experiment"
    : `Explore work response: ${request.title}`;
  if (request.kind === "housing") return `Plan housing response: ${request.title}`;
  if (request.kind === "healthcare") return `Plan care response: ${request.title}`;
  if (request.kind === "education") return `Plan learning response: ${request.title}`;
  if (request.kind === "governance") return `Organize civic response: ${request.title}`;
  return `Work on ${request.title.toLowerCase()}`;
}

function fundingFor(request: WorldRequest) {
  const impactBase = request.impact === "high" ? 900 : request.impact === "medium" ? 420 : 180;
  if (request.kind === "employment") return Math.round(impactBase * 0.75);
  if (request.kind === "governance" || request.kind === "social") return Math.round(impactBase * 0.35);
  return impactBase;
}

function laborFor(request: WorldRequest) {
  const impactBase = request.impact === "high" ? 16 : request.impact === "medium" ? 9 : 5;
  return request.kind === "employment" ? Math.max(4, impactBase - 2) : impactBase;
}

function phaseFor(project: WorldProject) {
  const fundingRatio = project.fundingRequired <= 0 ? 1 : project.fundingRaised / project.fundingRequired;
  const laborRatio = project.laborRequired <= 0 ? 1 : project.laborContributed / project.laborRequired;
  if (project.progress >= 100) return "complete";
  if (fundingRatio < 0.5) return "resourcing";
  if (laborRatio < 0.85) return "work";
  return "ready";
}

function milestoneFor(project: WorldProject) {
  if (project.phase === "planning") return "Turn the approved request into a concrete plan.";
  if (project.phase === "resourcing") return "Gather enough money or shared support to make it real.";
  if (project.phase === "work") return "Citizens need to spend effort on the project.";
  if (project.phase === "ready") return "Ready for a future world or map change.";
  return "Completed and available as town history.";
}

export function createProjectFromRequest(sim: SimulationState, request: WorldRequest, sourceDecisionId?: string) {
  if (request.status !== "approved" || projectExists(sim, request.id)) return null;

  const fundingRequired = fundingFor(request);
  const laborRequired = laborFor(request);
  const project: WorldProject = {
    id: `${sim.day}-${Math.round(sim.minute)}-${sim.worldProjects.length}-${request.kind}-${request.title}`,
    day: sim.day,
    time: formatTime(sim.minute),
    status: "active",
    phase: "planning",
    kind: request.kind,
    impact: request.impact,
    title: projectTitleFor(request),
    summary: request.proposal,
    sourceRequestId: request.id,
    sourceDecisionId,
    sponsorId: request.requestedById,
    sponsorName: request.requestedByName,
    relatedCitizenIds: request.relatedCitizenIds,
    relatedBuildingIds: request.relatedBuildingIds,
    needs: request.needs,
    fundingRequired,
    fundingRaised: Math.round(fundingRequired * 0.12),
    laborRequired,
    laborContributed: 0,
    progress: 8,
    nextMilestone: "Turn the approved request into a concrete plan.",
    expectedEffect: request.expectedEffect,
    history: [`Day ${sim.day} ${formatTime(sim.minute)}: Created from approved request "${request.title}".`],
  };

  sim.worldProjects.unshift(project);
  sim.worldProjects = sim.worldProjects.slice(0, 80);
  addFeed(sim, `${project.title} became an active town project.`);
  return project;
}

export function advanceWorldProjects(sim: SimulationState) {
  for (const project of sim.worldProjects) {
    if (project.status !== "active") continue;

    const supporters = project.relatedCitizenIds
      .map((id) => sim.citizens.find((citizen) => citizen.id === id))
      .filter(Boolean);
    const supporterCount = Math.max(1, supporters.length);
    const previousPhase = project.phase;
    const previousProgress = project.progress;

    project.fundingRaised = clamp(project.fundingRaised + supporterCount * 6 + (project.impact === "high" ? 18 : 8), 0, project.fundingRequired);
    project.laborContributed = clamp(project.laborContributed + supporterCount * 0.25 + (project.kind === "employment" ? 0.4 : 0.2), 0, project.laborRequired);

    const fundingRatio = project.fundingRequired <= 0 ? 1 : project.fundingRaised / project.fundingRequired;
    const laborRatio = project.laborRequired <= 0 ? 1 : project.laborContributed / project.laborRequired;
    project.progress = Math.round(clamp(8 + fundingRatio * 42 + laborRatio * 42, 0, 100));
    project.phase = phaseFor(project);
    project.nextMilestone = milestoneFor(project);

    if (project.phase !== previousPhase || project.progress - previousProgress >= 18) {
      project.history.unshift(`Day ${sim.day} ${formatTime(sim.minute)}: ${project.nextMilestone}`);
      project.history = project.history.slice(0, 8);
    }

    if (project.progress >= 100) {
      project.status = "completed";
      project.phase = "complete";
      project.nextMilestone = "Completed and available as town history.";
      project.history.unshift(`Day ${sim.day} ${formatTime(sim.minute)}: Project completed.`);
      addWorldDecision(sim, {
        category: project.kind === "employment" || project.kind === "money" || project.kind === "food" ? "economy" : "civic",
        status: "automatic",
        impact: project.impact,
        title: `Project completed: ${project.title}`,
        summary: project.summary,
        actorId: project.sponsorId,
        actorName: project.sponsorName,
        relatedCitizenIds: project.relatedCitizenIds,
        relatedBuildingId: project.relatedBuildingIds[0],
        requiresApproval: false,
        reason: "The project gathered enough support, money, and effort to count as complete.",
        effect: project.expectedEffect,
      });
      addFeed(sim, `${project.title} is complete.`);
    }
  }
}
