import type { Citizen, EconomyTransaction, Household, SimulationState, TransactionCategory } from "../types/simulation";
import { totalMinute as brainTotalMinute } from "./brain";
import { BUILDINGS } from "./constants";
import { addFeed, addLifeJournal, addWorldDecision } from "./eventLog";
import { clamp } from "./random";
import { formatTime } from "./time";

function buildingById(id: string) {
  const building = BUILDINGS.find((item) => item.id === id);
  if (!building) throw new Error(`Unknown building: ${id}`);
  return building;
}

function isAtDestination(citizen: Citizen) {
  return Math.hypot(citizen.targetX - citizen.x, citizen.targetY - citizen.y) < 22;
}

function transactionKey(category: TransactionCategory, buildingId = "town") {
  return `${category}:${buildingId}`;
}

function adjustBusiness(sim: SimulationState, id: string, delta: number) {
  sim.businessAccounts[id] = Math.round((sim.businessAccounts[id] ?? 0) + delta);
}

function addTransaction(
  sim: SimulationState,
  transaction: Omit<EconomyTransaction, "id" | "day" | "time">,
) {
  const entry: EconomyTransaction = {
    id: `${sim.day}-${Math.round(sim.minute)}-${sim.transactionLog.length}-${transaction.category}-${transaction.fromId}-${transaction.toId}`,
    day: sim.day,
    time: formatTime(sim.minute),
    ...transaction,
  };
  sim.transactionLog.unshift(entry);
  sim.transactionLog = sim.transactionLog.slice(0, 260);
}

function payCitizenWage(sim: SimulationState, citizen: Citizen, amount: number) {
  if (amount <= 0 || !citizen.workplaceId) return;
  const workplace = buildingById(citizen.workplaceId);
  citizen.cash += amount;
  citizen.today.earned += amount;
  adjustBusiness(sim, workplace.id, -amount);
  addTransaction(sim, {
    category: "wage",
    amount,
    fromId: workplace.id,
    fromName: workplace.name,
    toId: citizen.id,
    toName: citizen.name,
    citizenId: citizen.id,
    householdId: citizen.householdId,
    buildingId: workplace.id,
    note: `${citizen.name} earned wages from ${workplace.name}.`,
  });
  addWorldDecision(sim, {
    category: "economy",
    status: "automatic",
    impact: amount >= 100 ? "medium" : "low",
    title: `${citizen.name} earned a paycheck`,
    summary: `${citizen.name} earned $${Math.round(amount).toLocaleString()} from ${workplace.name}.`,
    actorId: citizen.id,
    actorName: citizen.name,
    householdId: citizen.householdId,
    relatedCitizenIds: [citizen.id],
    relatedBuildingId: workplace.id,
    requiresApproval: false,
    reason: "They completed enough of their work shift to be paid.",
    effect: "Personal cash increased and their employer account paid wages.",
  });
}

export function payHouseholdCost(sim: SimulationState, household: Household, category: "rent" | "living", amount: number, note: string) {
  const paid = Math.min(household.sharedCash, amount);
  const shortfall = amount - paid;
  household.sharedCash -= paid;
  household.unpaidBills = Math.round(Math.max(0, household.unpaidBills + shortfall - (paid >= amount ? paid * 0.08 : 0)));
  household.stress = clamp(household.stress + (shortfall > 0 ? 5 + shortfall * 0.03 : -1), 0, 100);
  adjustBusiness(sim, "town", paid);
  addTransaction(sim, {
    category,
    amount: paid,
    fromId: household.id,
    fromName: household.name,
    toId: "town",
    toName: "Town services",
    householdId: household.id,
    note: shortfall > 0 ? `${note} They could only cover $${Math.round(paid)} and carried $${Math.round(shortfall)} forward.` : note,
  });
}

export function updateHouseholdFinanceStatus(sim: SimulationState, household: Household, members: Citizen[]) {
  const monthlyCushion = household.rent > 0 ? household.sharedCash / household.rent : 1;
  const pressure = household.unpaidBills * 0.09
    + Math.max(0, 45 - household.foodStock) * 0.8
    + Math.max(0, 0.5 - monthlyCushion) * 42;

  const previousStatus = household.financialStatus;
  household.financialStatus = pressure > 62 || household.unpaidBills > household.rent * 0.45
    ? "critical"
    : pressure > 28 || household.unpaidBills > 0 || monthlyCushion < 0.75
      ? "strained"
      : "stable";

  household.stress = clamp(18 + pressure + (household.financialStatus === "critical" ? 18 : household.financialStatus === "strained" ? 7 : 0), 0, 100);
  household.lastMoneyNote = household.financialStatus === "critical"
    ? `Unpaid bills are at $${Math.round(household.unpaidBills).toLocaleString()}, and the household is under real pressure.`
    : household.financialStatus === "strained"
      ? `Money is tight with $${Math.round(household.sharedCash).toLocaleString()} shared and $${Math.round(household.unpaidBills).toLocaleString()} unpaid.`
      : `The household is keeping up with bills and has $${Math.round(household.sharedCash).toLocaleString()} shared.`;

  if (previousStatus !== household.financialStatus && household.financialStatus !== "stable") {
    addFeed(sim, `${household.name} is now financially ${household.financialStatus}.`);
    addWorldDecision(sim, {
      category: "economy",
      status: "automatic",
      impact: household.financialStatus === "critical" ? "high" : "medium",
      title: `${household.name} became financially ${household.financialStatus}`,
      summary: household.lastMoneyNote,
      householdId: household.id,
      householdName: household.name,
      relatedCitizenIds: members.map((citizen) => citizen.id),
      relatedBuildingId: household.homeId,
      requiresApproval: false,
      reason: "Unpaid bills, shared cash, and food stock crossed a household pressure threshold.",
      effect: "Household members become more worried and may make more money-conscious choices.",
    });
  }

  if (household.financialStatus === "stable") return;
  for (const citizen of members) {
    citizen.mood = clamp(citizen.mood - (household.financialStatus === "critical" ? 2.4 : 1.1), 0, 100);
    citizen.needs.belonging = clamp(citizen.needs.belonging + (household.financialStatus === "critical" ? 3 : 1.2), 0, 100);
    citizen.problems = Array.from(new Set([
      ...citizen.problems,
      household.financialStatus === "critical" ? "Household bills are becoming urgent." : "Household money feels tight.",
    ]));
    if (citizen.familyRole === "parent" || citizen.familyRole === "partner") {
      citizen.currentThought = household.financialStatus === "critical"
        ? "The household bills are getting urgent. I need to make careful choices."
        : "Money at home is tight, so I should be careful today.";
    }
  }
}

export function spendAtBuilding(sim: SimulationState, citizen: Citizen, buildingId: string, category: "market" | "clinic", amount: number, note: string) {
  const building = buildingById(buildingId);
  const household = sim.households.find((item) => item.id === citizen.householdId);
  let paidFrom = "cash";
  let paid = Math.min(citizen.cash, amount);
  citizen.cash -= paid;

  if (paid < amount && household) {
    const householdPaid = Math.min(household.sharedCash, amount - paid);
    household.sharedCash -= householdPaid;
    paid += householdPaid;
    paidFrom = "cash and household funds";
  }

  citizen.today.spent += paid;
  adjustBusiness(sim, building.id, paid);
  addTransaction(sim, {
    category,
    amount: paid,
    fromId: citizen.id,
    fromName: citizen.name,
    toId: building.id,
    toName: building.name,
    citizenId: citizen.id,
    householdId: citizen.householdId,
    buildingId: building.id,
    note: paid < amount ? `${note} They could not afford the full $${amount}.` : `${note} Paid from ${paidFrom}.`,
  });

  if (paid < amount) {
    citizen.mood = clamp(citizen.mood - 2.5, 0, 100);
    citizen.problems = Array.from(new Set([...citizen.problems, "Money feels tight."]));
  }
  if (paid >= 25 || paid < amount) {
    addWorldDecision(sim, {
      category: "economy",
      status: "automatic",
      impact: paid < amount ? "medium" : "low",
      title: `${citizen.name} spent money at ${building.name}`,
      summary: `${citizen.name} paid $${Math.round(paid).toLocaleString()} at ${building.name}.`,
      actorId: citizen.id,
      actorName: citizen.name,
      householdId: citizen.householdId,
      relatedCitizenIds: [citizen.id],
      relatedBuildingId: building.id,
      requiresApproval: false,
      reason: note,
      effect: paid < amount ? "The shortfall increased personal money pressure." : "Money moved from the citizen or household to a town business.",
    });
  }
  return paid;
}

function availableCashFor(sim: SimulationState, citizen: Citizen) {
  const household = sim.households.find((item) => item.id === citizen.householdId);
  return citizen.cash + (household?.sharedCash ?? 0);
}

export function payPersonalCost(sim: SimulationState, citizen: Citizen, amount: number) {
  if (amount <= 0) return;
  const paid = Math.min(citizen.cash, amount);
  citizen.cash -= paid;
  citizen.today.spent += paid;
  adjustBusiness(sim, "town", paid);
  addTransaction(sim, {
    category: "living",
    amount: paid,
    fromId: citizen.id,
    fromName: citizen.name,
    toId: "town",
    toName: "Daily living costs",
    citizenId: citizen.id,
    householdId: citizen.householdId,
    note: paid < amount ? `${citizen.name} could not fully cover daily costs.` : `${citizen.name} covered daily personal costs.`,
  });
  if (paid < amount) {
    citizen.mood = clamp(citizen.mood - 2, 0, 100);
    citizen.problems = Array.from(new Set([...citizen.problems, "Daily costs are hard to cover."]));
  }
}

function contributeToHousehold(sim: SimulationState, citizen: Citizen, amount: number) {
  const household = sim.households.find((item) => item.id === citizen.householdId);
  if (!household || amount <= 0) return;
  const contribution = Math.min(citizen.cash, amount);
  if (contribution <= 0) return;
  citizen.cash -= contribution;
  household.sharedCash += contribution;
  addTransaction(sim, {
    category: "living",
    amount: contribution,
    fromId: citizen.id,
    fromName: citizen.name,
    toId: household.id,
    toName: household.name,
    citizenId: citizen.id,
    householdId: household.id,
    note: `${citizen.name} contributed to shared household money.`,
  });
}

export function hasRecentTransaction(sim: SimulationState, citizen: Citizen, key: string, withinMinutes: number) {
  const tick = brainTotalMinute(sim);
  return (citizen.lastTransactionAt[key] ?? -Infinity) + withinMinutes > tick;
}

export function markTransaction(citizen: Citizen, sim: SimulationState, key: string) {
  citizen.lastTransactionAt[key] = brainTotalMinute(sim);
}

function payFor(citizen: Citizen) {
  if (citizen.workplaceId === "factory") return 95;
  if (citizen.workplaceId === "office") return 125;
  if (citizen.workplaceId === "market") return 80;
  if (citizen.workplaceId === "school") return 105;
  return 0;
}

export function maybePayCompletedShift(sim: SimulationState, citizen: Citizen, minute = sim.minute) {
  if (!citizen.workplaceId) return;
  if (sim.factoryClosed && citizen.workplaceId === "factory") return;
  if (minute < citizen.routine.workEndMinute) return;

  const key = `wage:${sim.day}:${citizen.workplaceId}`;
  if (citizen.lastTransactionAt[key] !== undefined) return;
  markTransaction(citizen, sim, key);

  const expectedMinutes = Math.max(1, citizen.routine.workEndMinute - citizen.routine.workStartMinute);
  const workRatio = clamp(citizen.today.workedMinutes / expectedMinutes, 0, 1);
  if (workRatio < 0.15) {
    citizen.currentThought = "I barely worked today, so there is no real paycheck coming.";
    citizen.problems = Array.from(new Set([...citizen.problems, "Missed too much work to earn much."]));
    return;
  }

  const earned = Math.round(payFor(citizen) * workRatio);
  payCitizenWage(sim, citizen, earned);
  contributeToHousehold(sim, citizen, Math.round(earned * 0.32));
}

export function maybeApplyPlaceTransaction(sim: SimulationState, citizen: Citizen) {
  if (!isAtDestination(citizen)) return;

  if (citizen.lifeStage === "child" && (citizen.destinationId === "market" || citizen.destinationId === "clinic")) {
    citizen.currentThought = citizen.destinationId === "clinic"
      ? "I need an adult to help me with the clinic."
      : "I should not be shopping by myself.";
    return;
  }

  if (citizen.destinationId === "market" && (citizen.currentIntention === "eat" || citizen.currentIntention === "errand")) {
    const key = transactionKey("market", "market");
    if (hasRecentTransaction(sim, citizen, key, 140)) return;
    const household = sim.households.find((item) => item.id === citizen.householdId);
    const mealCost = citizen.lifeStage === "child" ? 4 : citizen.lifeStage === "teen" ? 7 : 12;
    const groceryCost = household && household.foodStock < 45 ? 28 : 0;
    const amount = mealCost + groceryCost;
    const affordableRatio = amount > 0 ? clamp(availableCashFor(sim, citizen) / amount, 0, 1) : 1;
    const paid = spendAtBuilding(sim, citizen, "market", "market", amount, groceryCost ? "Bought food and household groceries." : "Bought something to eat.");
    if (paid > 0) {
      const benefit = clamp(paid / amount, 0.25, 1);
      citizen.needs.hunger = clamp(citizen.needs.hunger - 32 * benefit, 0, 100);
      citizen.needs.fun = clamp(citizen.needs.fun - 5 * benefit, 0, 100);
      citizen.mood = clamp(citizen.mood + 1.4 * benefit, 0, 100);
      if (household && groceryCost) household.foodStock = clamp(household.foodStock + 18 * benefit, 0, 100);
      addLifeJournal(sim, citizen, paid < amount || affordableRatio < 1 ? "I bought what I could afford at the market." : groceryCost ? "I spent money at the market and brought food back into the household." : "I bought food at the market.");
    } else {
      citizen.currentThought = "I wanted food, but I do not have the money for it right now.";
    }
    markTransaction(citizen, sim, key);
  }

  if (citizen.destinationId === "clinic" && (citizen.currentIntention === "recover" || citizen.currentIntention === "errand")) {
    const key = transactionKey("clinic", "clinic");
    if (hasRecentTransaction(sim, citizen, key, 320)) return;
    const amount = citizen.currentIntention === "errand" ? 18 : citizen.lifeStage === "child" ? 35 : citizen.lifeStage === "elder" ? 70 : 55;
    const paid = spendAtBuilding(sim, citizen, "clinic", "clinic", amount, citizen.currentIntention === "errand" ? "Paid for a quick clinic errand." : "Paid for care at the clinic.");
    if (paid > 0) {
      const benefit = clamp(paid / amount, 0.25, 1);
      citizen.energy = clamp(citizen.energy + (citizen.currentIntention === "errand" ? 4 : 12) * benefit, 0, 100);
      citizen.needs.rest = clamp(citizen.needs.rest - (citizen.currentIntention === "errand" ? 4 : 18) * benefit, 0, 100);
      citizen.mood = clamp(citizen.mood + 1 * benefit, 0, 100);
      addLifeJournal(sim, citizen, paid < amount ? "I could only afford part of the clinic visit." : citizen.currentIntention === "errand" ? "I paid for a quick clinic errand." : "I paid for a clinic visit and felt a little steadier after.");
    } else {
      citizen.currentThought = "I need care, but I cannot afford the clinic right now.";
    }
    markTransaction(citizen, sim, key);
  }
}
