import type { AuthorityCheck, AuthorityEvent, Citizen, CitizenIntention, SimulationState } from "../types/simulation";
import { totalMinute as brainTotalMinute } from "./brain";
import { hasRecentTransaction, markTransaction, spendAtBuilding } from "./economySystem";
import { addFeed, addLifeJournal, addWorldDecision } from "./eventLog";
import { setDestination } from "./movementSystem";
import { clamp, mulberry32 } from "./random";
import { formatTime } from "./time";

export type AddMemory = (sim: SimulationState, citizen: Citizen, text: string) => void;

function addAuthorityEvent(
  sim: SimulationState,
  citizen: Citizen,
  authority: AuthorityCheck,
  actualIntention: AuthorityEvent["actualIntention"],
  consequence: string,
) {
  if (!authority.expectedIntention || authority.outcome === "free") return;
  const tick = brainTotalMinute(sim);
  const repeatedTooSoon = citizen.recentAuthorityEvents.some((event) => (
    event.day === sim.day
    && event.expectedIntention === authority.expectedIntention
    && event.outcome === authority.outcome
    && tick - (event.day * 1440 + Number(event.time.slice(0, 2)) * 60 + Number(event.time.slice(3, 5))) < 120
  ));
  if (repeatedTooSoon) return;

  const event: AuthorityEvent = {
    id: `${citizen.id}-authority-${sim.day}-${Math.round(sim.minute)}-${citizen.recentAuthorityEvents.length}`,
    day: sim.day,
    time: formatTime(sim.minute),
    outcome: authority.outcome,
    authority: authority.authority,
    expectedIntention: authority.expectedIntention,
    actualIntention,
    pressure: authority.pressure,
    resistance: authority.resistance,
    consequence,
  };
  citizen.recentAuthorityEvents.unshift(event);
  citizen.recentAuthorityEvents = citizen.recentAuthorityEvents.slice(0, 10);
  citizen.today.authorityEvents += 1;
  addWorldDecision(sim, {
    category: "authority",
    status: "automatic",
    impact: authority.outcome === "blocked" || authority.outcome === "defied" ? "medium" : "low",
    title: `${citizen.name} ${authority.outcome} a ${authority.expectedIntention} expectation`,
    summary: consequence,
    actorId: citizen.id,
    actorName: citizen.name,
    householdId: citizen.householdId,
    relatedCitizenIds: [citizen.id],
    relatedBuildingId: authority.expectedDestinationId ?? undefined,
    requiresApproval: false,
    reason: authority.reason,
    effect: `Expected ${authority.expectedIntention}, actual ${actualIntention}.`,
  });
}

type ChildCareNeed = {
  kind: "hungry" | "exhausted" | "lonely" | "sick";
  destinationId: string;
  childIntention: CitizenIntention;
  guardianIntention: CitizenIntention;
  childThought: string;
  guardianThought: string;
};

function childCareNeedFor(child: Citizen): ChildCareNeed | null {
  if (child.lifeStage !== "child") return null;
  if (child.mood < 30 && (child.needs.rest > 76 || child.energy < 34)) {
    return {
      kind: "sick",
      destinationId: "clinic",
      childIntention: "recover",
      guardianIntention: "errand",
      childThought: "I do not feel good. I need an adult to help me.",
      guardianThought: `${child.name} seems unwell. I should help with the clinic.`,
    };
  }
  if (child.needs.hunger > 78) {
    return {
      kind: "hungry",
      destinationId: child.homeId,
      childIntention: "eat",
      guardianIntention: "home",
      childThought: "I am hungry. I need someone at home to help me.",
      guardianThought: `${child.name} is hungry. I should make sure they get food.`,
    };
  }
  if (child.needs.rest > 88 || child.energy < 24) {
    return {
      kind: "exhausted",
      destinationId: child.homeId,
      childIntention: "sleep",
      guardianIntention: "home",
      childThought: "I am too tired. I want someone familiar nearby.",
      guardianThought: `${child.name} looks exhausted. I should get them settled.`,
    };
  }
  if (child.needs.belonging > 86 || child.social < 22 || child.mood < 34) {
    return {
      kind: "lonely",
      destinationId: child.homeId,
      childIntention: "socialize",
      guardianIntention: "socialize",
      childThought: "I want to be near someone who knows me.",
      guardianThought: `${child.name} needs attention. I should check on them.`,
    };
  }
  return null;
}

function guardianForChild(sim: SimulationState, child: Citizen) {
  const household = sim.households.find((item) => item.id === child.householdId);
  if (!household) return null;
  const members = household.memberIds
    .map((id) => sim.citizens.find((citizen) => citizen.id === id))
    .filter((citizen): citizen is Citizen => Boolean(citizen));
  return members.find((citizen) => citizen.familyRole === "parent" || citizen.familyRole === "partner")
    ?? members.find((citizen) => citizen.lifeStage === "adult" || citizen.lifeStage === "elder")
    ?? null;
}

function resolveChildCare(sim: SimulationState, child: Citizen, guardian: Citizen, need: ChildCareNeed) {
  if (Math.hypot(child.x - guardian.x, child.y - guardian.y) > 54) return;
  const key = `care-resolved:${child.id}:${need.kind}`;
  if (hasRecentTransaction(sim, guardian, key, 130)) return;

  if (need.kind === "hungry") {
    const household = sim.households.find((item) => item.id === child.householdId);
    child.needs.hunger = clamp(child.needs.hunger - 46, 0, 100);
    child.mood = clamp(child.mood + 3.5, 0, 100);
    guardian.currentThought = `${child.name} has eaten. That helps.`;
    child.currentThought = `${guardian.name} helped me get food.`;
    if (household) household.foodStock = clamp(household.foodStock - 3, 0, 100);
    addLifeJournal(sim, child, `${guardian.name} helped me get food when I was hungry.`);
    addLifeJournal(sim, guardian, `I helped ${child.name} get food.`);
  } else if (need.kind === "exhausted") {
    child.needs.rest = clamp(child.needs.rest - 38, 0, 100);
    child.energy = clamp(child.energy + 10, 0, 100);
    child.mood = clamp(child.mood + 2.5, 0, 100);
    guardian.currentThought = `${child.name} is resting now.`;
    child.currentThought = `${guardian.name} helped me rest.`;
    addLifeJournal(sim, child, `${guardian.name} helped me settle down and rest.`);
    addLifeJournal(sim, guardian, `I helped ${child.name} rest.`);
  } else if (need.kind === "lonely") {
    child.needs.belonging = clamp(child.needs.belonging - 48, 0, 100);
    child.social = clamp(child.social + 24, 0, 100);
    child.mood = clamp(child.mood + 5, 0, 100);
    guardian.social = clamp(guardian.social + 4, 0, 100);
    guardian.currentThought = `${child.name} seems more settled now.`;
    child.currentThought = `${guardian.name} stayed with me for a bit.`;
    addLifeJournal(sim, child, `${guardian.name} spent time with me when I felt alone.`);
    addLifeJournal(sim, guardian, `I checked on ${child.name} when they needed company.`);
  } else if (need.kind === "sick") {
    if (child.destinationId !== "clinic" || guardian.destinationId !== "clinic") return;
    const paid = spendAtBuilding(sim, guardian, "clinic", "clinic", 42, `${guardian.name} paid for ${child.name}'s clinic care.`);
    const benefit = paid > 0 ? clamp(paid / 42, 0.25, 1) : 0.2;
    child.needs.rest = clamp(child.needs.rest - 30 * benefit, 0, 100);
    child.energy = clamp(child.energy + 14 * benefit, 0, 100);
    child.mood = clamp(child.mood + 4 * benefit, 0, 100);
    guardian.currentThought = paid > 0 ? `${child.name} got some care at the clinic.` : `I could not really afford care for ${child.name}.`;
    child.currentThought = paid > 0 ? `${guardian.name} helped me at the clinic.` : "I still do not feel right.";
    addLifeJournal(sim, child, `${guardian.name} took me for care at the clinic.`);
    addLifeJournal(sim, guardian, `I took ${child.name} to the clinic.`);
  }

  markTransaction(guardian, sim, key);
  markTransaction(child, sim, key);
}

export function updateGuardianCare(sim: SimulationState, child: Citizen) {
  const need = childCareNeedFor(child);
  if (!need) return;
  const guardian = guardianForChild(sim, child);
  if (!guardian) return;
  const requestKey = `care-request:${child.id}:${need.kind}`;
  const rand = mulberry32(sim.day * 16000 + sim.minute * 17 + Number(child.id.split("_")[1]) * 19);

  if (!hasRecentTransaction(sim, guardian, requestKey, 70)) {
    child.currentIntention = need.childIntention;
    child.currentThought = need.childThought;
    child.committedUntil = brainTotalMinute(sim) + 35;
    setDestination(child, need.destinationId, rand, need.childIntention);

    guardian.currentIntention = need.guardianIntention;
    guardian.currentThought = need.guardianThought;
    guardian.committedUntil = brainTotalMinute(sim) + 45;
    setDestination(guardian, need.destinationId, rand, need.guardianIntention);
    addWorldDecision(sim, {
      category: "social",
      status: "automatic",
      impact: need.kind === "sick" ? "medium" : "low",
      title: `${guardian.name} responded to ${child.name}'s ${need.kind} need`,
      summary: `${child.name} needed help, so ${guardian.name} changed plans to provide care.`,
      actorId: guardian.id,
      actorName: guardian.name,
      householdId: child.householdId,
      householdName: sim.households.find((household) => household.id === child.householdId)?.name,
      relatedCitizenIds: [guardian.id, child.id],
      relatedBuildingId: need.destinationId,
      requiresApproval: false,
      reason: "A child had a need they should not solve independently.",
      effect: "The guardian redirected toward care instead of leaving the child to act like an adult.",
    });
    markTransaction(guardian, sim, requestKey);
    markTransaction(child, sim, requestKey);
  }

  resolveChildCare(sim, child, guardian, need);
}

export function applyAuthorityConsequences(
  sim: SimulationState,
  citizen: Citizen,
  authority: AuthorityCheck,
  actualIntention: AuthorityEvent["actualIntention"],
  addMemory: AddMemory,
) {
  if (!authority.expectedIntention || authority.outcome === "free") return;

  const household = sim.households.find((item) => item.id === citizen.householdId);
  let consequence = "";

  if (authority.expectedIntention === "school") {
    if (authority.outcome === "defied") {
      citizen.today.skippedSchool = true;
      citizen.schoolProgress = citizen.schoolProgress
        ? {
          ...citizen.schoolProgress,
          attendance: clamp(citizen.schoolProgress.attendance - 2.6, 0, 100),
          motivation: clamp(citizen.schoolProgress.motivation - 1.4, 0, 100),
        }
        : citizen.schoolProgress;
      if (household) household.stress = clamp(household.stress + 2.5, 0, 100);
      consequence = "Attendance slipped, home stress rose, and adults may bring it up later.";
      addMemory(sim, citizen, `I ignored school expectations and chose ${actualIntention} instead.`);
      addLifeJournal(sim, citizen, "I pushed against school expectations today.");
      addFeed(sim, `${citizen.name} defied school expectations.`);
    } else if (authority.outcome === "blocked") {
      citizen.mood = clamp(citizen.mood - 1.2, 0, 100);
      citizen.needs.rest = clamp(citizen.needs.rest + 2, 0, 100);
      consequence = "They still went to school, but it left them more tired and frustrated.";
      addMemory(sim, citizen, "School pressure overruled my need to recover.");
    } else {
      citizen.mood = clamp(citizen.mood - 0.5, 0, 100);
      consequence = "They complied with school expectations after being redirected.";
    }
  } else if (authority.expectedIntention === "work") {
    if (authority.outcome === "defied") {
      citizen.today.skippedWork = true;
      citizen.careerProgress = citizen.careerProgress
        ? {
          ...citizen.careerProgress,
          reliability: clamp(citizen.careerProgress.reliability - 2.8, 0, 100),
          reputation: clamp(citizen.careerProgress.reputation - 1.4, 0, 100),
        }
        : citizen.careerProgress;
      consequence = "Reliability and reputation dropped because work noticed the absence.";
      addMemory(sim, citizen, `I ignored work expectations and chose ${actualIntention} instead.`);
      addLifeJournal(sim, citizen, "I pushed against work expectations today.");
      addFeed(sim, `${citizen.name} defied work expectations.`);
    } else if (authority.outcome === "blocked") {
      citizen.mood = clamp(citizen.mood - 1.4, 0, 100);
      if (citizen.careerProgress) citizen.careerProgress.burnout = clamp(citizen.careerProgress.burnout + 1.8, 0, 100);
      consequence = "They showed up, but burnout rose because they wanted to recover.";
      addMemory(sim, citizen, "Work pressure overruled my need to recover.");
    } else {
      citizen.mood = clamp(citizen.mood - 0.5, 0, 100);
      consequence = "They complied with work expectations after being redirected.";
    }
  }

  if (consequence) addAuthorityEvent(sim, citizen, authority, actualIntention, consequence);
}
