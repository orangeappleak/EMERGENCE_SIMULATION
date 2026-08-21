import type { Building, Citizen, DailyActivity, FamilyRole, Household, LifeStage, SimulationSnapshot, SimulationState, WeatherState } from "../types/simulation";
import {
  refreshPersonalGoals as brainRefreshPersonalGoals,
  totalMinute as brainTotalMinute,
  updateEmotionAndProblems as brainUpdateEmotionAndProblems,
  updateGoalProgress as brainUpdateGoalProgress,
} from "./brain";
import { chooseCitizenBrainDecision } from "./brainAdapter";
import { applyAuthorityConsequences, updateGuardianCare } from "./authoritySystem";
import { BUILDINGS, FACTORY_RUMOR } from "./constants";
import { knows, learn, maybeTalk } from "./conversationSystem";
import { detectCivicIssues, detectWorldObservations } from "./civicSystem";
import { maybeApplyPlaceTransaction, maybePayCompletedShift, payHouseholdCost, payPersonalCost, updateHouseholdFinanceStatus } from "./economySystem";
import { addFeed, addLifeJournal, addWorldDecision } from "./eventLog";
import { buildingById, homeStartSlot, isAtDestination, moveCitizen, setDestination } from "./movementSystem";
import { clamp, mulberry32, pick } from "./random";
import { formatTime } from "./time";
import { detectWorldRequests } from "./worldRequestSystem";

export { buildingById, placeSlotById } from "./movementSystem";

const FIRST_NAMES = [
  "Maya", "Daniel", "Sarah", "Noah", "Ari", "Lena", "Jon", "Priya", "Owen", "Iris",
  "Sam", "Nia", "Theo", "June", "Ezra", "Mina", "Cal", "Rosa", "Eli", "Tara",
];
const LAST_NAMES = ["Chen", "Rivera", "Patel", "Moore", "Kim", "Morgan", "Reed", "Singh", "Brooks", "Vale"];
const HOME_IDS = BUILDINGS.filter((building) => building.kind === "home").map((building) => building.id);

function weatherForDay(day: number): WeatherState {
  const rand = mulberry32(51000 + day * 317);
  const roll = rand();
  const kind = roll < 0.52 ? "clear" : roll < 0.76 ? "cloudy" : roll < 0.91 ? "rain" : "fog";
  const base = kind === "rain" ? 61 : kind === "fog" ? 58 : kind === "cloudy" ? 64 : 70;
  return {
    kind,
    temperature: Math.round(base + rand() * 13),
  };
}

function createDailyActivity(day: number): DailyActivity {
  return {
    day,
    workedMinutes: 0,
    schoolMinutes: 0,
    socialMinutes: 0,
    restMinutes: 0,
    errandMinutes: 0,
    meals: 0,
    skippedWork: false,
    skippedSchool: false,
    authorityEvents: 0,
    conversations: 0,
    goalProgress: 0,
    earned: 0,
    spent: 0,
  };
}

function lifeStageForAge(age: number): LifeStage {
  if (age < 13) return "child";
  if (age < 19) return "teen";
  if (age >= 65) return "elder";
  return "adult";
}

function jobFor(workplaceId: string | null, lifeStage: LifeStage) {
  if (lifeStage === "child") return "Student";
  if (lifeStage === "teen") return workplaceId ? "Part-time clerk" : "Student";
  if (lifeStage === "elder") return workplaceId ? "Part-time worker" : "Retired";
  if (workplaceId === "school") return "Teacher";
  if (workplaceId === "factory") return "Factory worker";
  if (workplaceId === "office") return "Analyst";
  if (workplaceId === "market") return "Clerk";
  return "Unemployed";
}

function chooseWorkplace(index: number, lifeStage: LifeStage, rand: () => number) {
  if (lifeStage === "child") return null;
  if (lifeStage === "teen") return rand() < 0.28 ? "market" : null;
  if (lifeStage === "elder") return rand() < 0.18 ? pick(rand, ["market", "office"]) : null;
  if (index % 10 < 4) return "factory";
  if (index % 10 < 7) return "office";
  if (index % 10 < 9) return "market";
  return null;
}

function citizenJobSatisfactionSeed(workplaceId: string | null) {
  if (workplaceId === "office") return 16;
  if (workplaceId === "school") return 14;
  if (workplaceId === "market") return 8;
  if (workplaceId === "factory") return 4;
  return 0;
}

function startingCashFor(lifeStage: LifeStage, workplaceId: string | null, rand: () => number) {
  if (lifeStage === "child") return Math.round(5 + rand() * 45);
  if (lifeStage === "teen") return workplaceId ? Math.round(80 + rand() * 260) : Math.round(20 + rand() * 120);
  if (lifeStage === "elder") return Math.round(120 + rand() * 620);
  return Math.round(260 + rand() * 900);
}

function dailyPersonalCost(citizen: Citizen) {
  if (citizen.lifeStage === "child") return 2;
  if (citizen.schoolClass && !citizen.workplaceId) return 8;
  if (citizen.lifeStage === "teen") return 15;
  if (citizen.lifeStage === "elder") return 24;
  return 38;
}

function dailyMoneyMoodDelta(citizen: Citizen) {
  if (citizen.lifeStage === "child") return 0;
  if (citizen.schoolClass && !citizen.workplaceId) return citizen.cash < 35 ? -1 : 0.5;
  if (citizen.lifeStage === "teen") return citizen.cash < 70 ? -2 : 0.5;
  return citizen.cash < 250 ? -4 : 1;
}

function createCitizen(
  idNumber: number,
  household: Household,
  age: number,
  familyRole: FamilyRole,
  firstName: string,
  lastName: string,
): Citizen {
  const rand = mulberry32(7000 + idNumber * 97);
  const lifeStage = lifeStageForAge(age);
  const workplaceId = chooseWorkplace(idNumber, lifeStage, rand);
  const schoolClass = age < 11 ? "elementary" : age < 14 ? "middle" : age < 19 ? "high" : null;
  const homeSlot = homeStartSlot(household.homeId);
  const punctuality = rand();
  const personality = {
    responsibility: Math.round(30 + rand() * 70),
    sociability: Math.round(25 + rand() * 75),
    curiosity: Math.round(25 + rand() * 75),
    ambition: Math.round(25 + rand() * 75),
    independence: Math.round(20 + rand() * 80),
  };
  const workStartMinute = lifeStage === "child" || (lifeStage === "teen" && !workplaceId)
    ? 500 + Math.round(rand() * 35)
    : workplaceId === "market"
      ? 540 + Math.round(rand() * 105)
      : 480 + Math.round((1 - punctuality) * 70 + rand() * 35);
  const workEndMinute = lifeStage === "child" || (lifeStage === "teen" && !workplaceId)
    ? 900 + Math.round(rand() * 40)
    : workplaceId === "market"
      ? 990 + Math.round(rand() * 150)
      : 930 + Math.round(rand() * 165);
  const mood = Math.round(58 + rand() * 32);
  const cash = startingCashFor(lifeStage, workplaceId, rand);
  const energy = Math.round(65 + rand() * 25);
  const social = Math.round(35 + rand() * 45);

  return {
    id: `citizen_${idNumber}`,
    name: `${firstName} ${lastName}`,
    age,
    lifeStage,
    householdId: household.id,
    familyRole,
    institutionRole: schoolClass ? "student" : null,
    schoolClass,
    homeId: household.homeId,
    workplaceId,
    job: jobFor(workplaceId, lifeStage),
    x: homeSlot.x + (rand() - 0.5) * homeSlot.radius * 2,
    y: homeSlot.y + (rand() - 0.5) * homeSlot.radius * 2,
    targetX: homeSlot.x,
    targetY: homeSlot.y,
    route: [],
    destinationId: household.homeId,
    currentSlotId: homeSlot.id,
    destinationSlotId: homeSlot.id,
    mood,
    cash,
    energy,
    social,
    currentThought: "I am getting ready for the day.",
    currentIntention: "home",
    currentEmotion: mood < 45 ? "worried" : social < 45 ? "lonely" : energy < 50 ? "tired" : "calm",
    decisionReasoning: null,
    brainDebug: null,
    goalFocus: "settle into the day",
    personalGoals: [],
    problems: [],
    problemAwareness: {
      money: 0,
      household: 0,
      food: 0,
      health: 0,
    },
    recentAuthorityEvents: [],
    recentConversations: [],
    committedUntil: 0,
    today: createDailyActivity(1),
    lifeJournal: [],
    schoolProgress: schoolClass
      ? {
        attendance: Math.round(58 + personality.responsibility * 0.25 + rand() * 18),
        grades: Math.round(48 + personality.ambition * 0.22 + personality.curiosity * 0.18 + rand() * 20),
        teacherSupport: Math.round(35 + rand() * 35),
        motivation: Math.round(42 + personality.ambition * 0.35 + rand() * 20),
      }
      : null,
    careerProgress: !schoolClass && workplaceId
      ? {
        reliability: Math.round(52 + personality.responsibility * 0.28 + rand() * 22),
        reputation: Math.round(42 + personality.ambition * 0.22 + rand() * 24),
        satisfaction: Math.round(38 + citizenJobSatisfactionSeed(workplaceId) + rand() * 28),
        burnout: Math.round(18 + (100 - personality.independence) * 0.12 + rand() * 22),
      }
      : null,
    personality,
    needs: {
      hunger: Math.round(20 + rand() * 45),
      belonging: Math.round(25 + rand() * 55),
      fun: Math.round(20 + rand() * 55),
      rest: Math.round(100 - (65 + rand() * 25)),
    },
    lastTransactionAt: {},
    knownFacts: [],
    memories: [],
    relationships: {},
    conversationUntil: 0,
    conversationWithId: null,
    lastTalkedAt: {},
    routine: {
      wakeMinute: lifeStage === "teen" ? 410 + Math.round(rand() * 120) : 360 + Math.round(rand() * 150),
      workStartMinute,
      lunchMinute: 705 + Math.round(rand() * 90),
      workEndMinute,
      sleepMinute: lifeStage === "child" ? 1200 + Math.round(rand() * 45) : 1260 + Math.round(rand() * 120),
      errandChance: lifeStage === "child" ? 0.05 : 0.18 + rand() * 0.5,
      sociability: 0.45 + rand() * 0.8,
      punctuality,
      walkingSpeed: lifeStage === "elder" ? 0.55 + rand() * 0.35 : 0.75 + rand() * 0.65,
    },
    style: {
      clothes: pick(rand, ["#305f8c", "#7e5a9b", "#c25c45", "#2f7d5c", "#b67d25", "#4d5d65"]),
      skin: pick(rand, ["#8f573a", "#b9784e", "#d69b6c", "#edc099", "#6d4632"]),
      hair: pick(rand, ["#211816", "#5c3424", "#87603e", "#d9c58c", "#2f2d2b"]),
      accent: pick(rand, ["#f7d35f", "#eef2f2", "#2e9cca", "#111820", "#d86f45"]),
      hairStyle: pick(rand, ["cap", "short", "bob", "tall", "bald"]),
      build: lifeStage === "child" ? "small" : pick(rand, ["small", "average", "broad"]),
      accessory: pick(rand, ["none", "none", "glasses", "bag", "hat"]),
    },
  };
}

function assignSchoolStaff(citizens: Citizen[]) {
  const candidates = citizens.filter((citizen) => citizen.lifeStage === "adult");
  const staffPlan = [
    { job: "Principal", role: "school principal", start: 455, end: 980 },
    { job: "Elementary teacher", role: "elementary teacher", start: 470, end: 940 },
    { job: "Middle school teacher", role: "middle school teacher", start: 470, end: 940 },
    { job: "High school teacher", role: "high school teacher", start: 475, end: 950 },
    { job: "School counselor", role: "school counselor", start: 500, end: 930 },
  ];

  staffPlan.forEach((staff, index) => {
    const teacher = candidates[(index * 7 + 2) % candidates.length];
    if (!teacher) return;
    teacher.workplaceId = "school";
    teacher.job = staff.job;
    teacher.institutionRole = staff.role;
    teacher.careerProgress = teacher.careerProgress ?? {
      reliability: Math.round(56 + teacher.personality.responsibility * 0.28),
      reputation: Math.round(44 + teacher.personality.ambition * 0.24),
      satisfaction: Math.round(44 + teacher.personality.sociability * 0.2),
      burnout: Math.round(18 + (100 - teacher.personality.independence) * 0.1),
    };
    teacher.routine.workStartMinute = staff.start;
    teacher.routine.workEndMinute = staff.end;
    teacher.routine.lunchMinute = 720 + index * 8;
    teacher.routine.errandChance = Math.max(0.12, teacher.routine.errandChance - 0.18);
  });
}

function createTownPopulation(): { households: Household[]; citizens: Citizen[] } {
  const citizens: Citizen[] = [];
  const households: Household[] = [];
  let citizenId = 0;

  HOME_IDS.forEach((homeId, householdIndex) => {
    const rand = mulberry32(13000 + householdIndex * 431);
    const lastName = LAST_NAMES[householdIndex % LAST_NAMES.length];
    const household: Household = {
      id: `household_${householdIndex + 1}`,
      name: `${lastName} household`,
      homeId,
      memberIds: [],
      rent: 650 + Math.round(rand() * 950),
      sharedCash: 700 + Math.round(rand() * 3200),
      foodStock: 35 + Math.round(rand() * 65),
      stress: 20 + Math.round(rand() * 42),
      unpaidBills: 0,
      financialStatus: "stable",
      moneyFriction: 0,
      foodFriction: 0,
      lastMoneyNote: "The household is keeping up with bills.",
    };

    const householdType = householdIndex % 5;
    const members: Array<{ age: number; role: FamilyRole; first: string; last: string }> = [];
    if (householdType === 0) {
      members.push(
        { age: 34 + Math.round(rand() * 16), role: "parent", first: FIRST_NAMES[citizenId % FIRST_NAMES.length], last: lastName },
        { age: 32 + Math.round(rand() * 18), role: "partner", first: FIRST_NAMES[(citizenId + 1) % FIRST_NAMES.length], last: lastName },
        { age: 7 + Math.round(rand() * 9), role: "child", first: FIRST_NAMES[(citizenId + 2) % FIRST_NAMES.length], last: lastName },
        { age: 3 + Math.round(rand() * 12), role: "child", first: FIRST_NAMES[(citizenId + 3) % FIRST_NAMES.length], last: lastName },
      );
    } else if (householdType === 1) {
      members.push(
        { age: 27 + Math.round(rand() * 28), role: "parent", first: FIRST_NAMES[citizenId % FIRST_NAMES.length], last: lastName },
        { age: 13 + Math.round(rand() * 5), role: "teen", first: FIRST_NAMES[(citizenId + 1) % FIRST_NAMES.length], last: lastName },
        { age: 6 + Math.round(rand() * 6), role: "child", first: FIRST_NAMES[(citizenId + 2) % FIRST_NAMES.length], last: lastName },
      );
    } else if (householdType === 2) {
      members.push(
        { age: 22 + Math.round(rand() * 15), role: "roommate", first: FIRST_NAMES[citizenId % FIRST_NAMES.length], last: LAST_NAMES[(householdIndex + 1) % LAST_NAMES.length] },
        { age: 22 + Math.round(rand() * 18), role: "roommate", first: FIRST_NAMES[(citizenId + 1) % FIRST_NAMES.length], last: LAST_NAMES[(householdIndex + 2) % LAST_NAMES.length] },
        { age: 24 + Math.round(rand() * 20), role: "roommate", first: FIRST_NAMES[(citizenId + 2) % FIRST_NAMES.length], last: LAST_NAMES[(householdIndex + 3) % LAST_NAMES.length] },
      );
    } else if (householdType === 3) {
      members.push(
        { age: 66 + Math.round(rand() * 14), role: "elder", first: FIRST_NAMES[citizenId % FIRST_NAMES.length], last: lastName },
        { age: 35 + Math.round(rand() * 22), role: "parent", first: FIRST_NAMES[(citizenId + 1) % FIRST_NAMES.length], last: lastName },
        { age: 10 + Math.round(rand() * 7), role: "child", first: FIRST_NAMES[(citizenId + 2) % FIRST_NAMES.length], last: lastName },
      );
    } else {
      members.push(
        { age: 29 + Math.round(rand() * 20), role: "partner", first: FIRST_NAMES[citizenId % FIRST_NAMES.length], last: lastName },
        { age: 27 + Math.round(rand() * 20), role: "partner", first: FIRST_NAMES[(citizenId + 1) % FIRST_NAMES.length], last: lastName },
      );
    }

    for (const member of members) {
      const citizen = createCitizen(citizenId, household, member.age, member.role, member.first, member.last);
      household.memberIds.push(citizen.id);
      citizens.push(citizen);
      citizenId += 1;
    }
    households.push(household);
  });

  while (citizens.length < 50) {
    const household = households[citizens.length % households.length];
    const rand = mulberry32(22000 + citizens.length * 19);
    const age = 19 + Math.round(rand() * 45);
    const citizen = createCitizen(citizenId, household, age, "roommate", FIRST_NAMES[citizenId % FIRST_NAMES.length], LAST_NAMES[(citizenId + 4) % LAST_NAMES.length]);
    household.memberIds.push(citizen.id);
    citizens.push(citizen);
    citizenId += 1;
  }

  assignSchoolStaff(citizens);
  const goalSim = { day: 1, minute: 475, households, citizens } as SimulationState;
  for (const citizen of citizens) brainRefreshPersonalGoals(goalSim, citizen, addLifeJournal);

  for (const a of citizens) {
    for (const b of citizens) {
      if (a.id === b.id) continue;
      const sameHousehold = a.householdId === b.householdId;
      const sameHome = a.homeId === b.homeId;
      const coworkers = a.workplaceId !== null && a.workplaceId === b.workplaceId;
      const family = sameHousehold && a.familyRole !== "roommate" && b.familyRole !== "roommate";
      const schoolLink = (a.workplaceId === "school" && b.schoolClass) || (b.workplaceId === "school" && a.schoolClass);
      const rand = mulberry32(a.id.length * 1009 + b.id.length * 917 + a.name.charCodeAt(0) * b.name.charCodeAt(1));
      const seedHistory = family ? 24 : sameHome ? 8 : coworkers || schoolLink ? 2 : 0;
      const familiarity = clamp(
        (family ? 86 : sameHome ? 48 : 4)
        + (coworkers ? 22 : 0)
        + (schoolLink ? 28 : 0)
        + rand() * (family ? 12 : sameHome ? 14 : 10),
        0,
        100,
      );
      a.relationships[b.id] = {
        friendship: clamp((family ? 68 : sameHome ? 18 : 0) + (schoolLink ? 12 : 0) + familiarity * (family ? 0.35 : 0.22) + rand() * 12, 0, 100),
        trust: clamp((family ? 76 : sameHome ? 22 : 0) + (schoolLink ? 14 : 0) + familiarity * (family ? 0.38 : 0.24) + rand() * 12, 0, 100),
        dislike: clamp((family ? rand() * 7 : rand() * 22) - familiarity * 0.06, 0, 100),
        familiarity,
        interactions: seedHistory,
        firstMetDay: seedHistory > 0 ? 1 : undefined,
        lastInteractionDay: seedHistory > 0 ? 1 : undefined,
        lastTopic: seedHistory > 0 ? "daily life" : undefined,
        lastClassification: seedHistory > 0 ? "casual" : undefined,
        lastContextZone: seedHistory > 0 ? (sameHousehold ? "home" : coworkers ? "work" : schoolLink ? "school" : undefined) : undefined,
        lastConversationSummary: seedHistory > 0
          ? family
            ? "They already have ordinary household history together."
            : sameHome
              ? "They have shared casual moments around home."
              : coworkers
                ? "They have had light workplace check-ins before."
                : schoolLink
                  ? "They have had light school check-ins before."
                  : undefined
          : undefined,
      };
    }
  }

  return { households, citizens };
}

export function createSimulation(): SimulationState {
  const town = createTownPopulation();
  const weather = weatherForDay(1);
  return {
    day: 1,
    minute: 475,
    speed: 1,
    paused: false,
    factoryClosed: false,
    weather,
    totalConversations: 0,
    worldDecisions: [{
      id: "start-decision-log",
      day: 1,
      time: "07:55",
      category: "civic",
      status: "automatic",
      impact: "medium",
      title: "Northbridge starts observing town decisions",
      summary: "The town now keeps a civic record of important choices, pressures, and future approval items.",
      relatedCitizenIds: [],
      requiresApproval: false,
      reason: "Major autonomous behavior needs a visible history before AI and leadership systems arrive.",
      effect: "Important citizen, household, and civic events will appear in the World Decisions panel.",
    }],
    worldObservations: [],
    townConcerns: [],
    worldSignals: [],
    worldRequests: [],
    civicIssues: [],
    transactionLog: [],
    businessAccounts: {
      factory: 18000,
      market: 4200,
      office: 9600,
      clinic: 6800,
      school: 5200,
      town: 14000,
    },
    conversationLog: [],
    households: town.households,
    citizens: town.citizens,
    feed: [{ id: "start", day: 1, time: "07:55", text: `Northbridge starts its morning commute under ${weather.kind} skies.` }],
  };
}

function addMemory(sim: SimulationState, citizen: Citizen, text: string) {
  citizen.memories.unshift(`Day ${sim.day}: ${text}`);
  citizen.memories = citizen.memories.slice(0, 8);
}

function updateDailyActivity(citizen: Citizen, simMinutes: number) {
  if (citizen.currentIntention === "work") citizen.today.workedMinutes += simMinutes;
  if (citizen.currentIntention === "school") citizen.today.schoolMinutes += simMinutes;
  if (citizen.currentIntention === "socialize") citizen.today.socialMinutes += simMinutes;
  if (citizen.currentIntention === "recover" || citizen.currentIntention === "sleep") citizen.today.restMinutes += simMinutes;
  if (citizen.currentIntention === "errand") citizen.today.errandMinutes += simMinutes;
}

function summarizeDailyLife(citizen: Citizen, day: number) {
  const parts: string[] = [];
  if (citizen.today.workedMinutes > 120) parts.push(`worked ${Math.round(citizen.today.workedMinutes / 60)}h`);
  if (citizen.today.schoolMinutes > 120) parts.push(`attended school ${Math.round(citizen.today.schoolMinutes / 60)}h`);
  if (citizen.today.socialMinutes > 45) parts.push(`socialized ${Math.round(citizen.today.socialMinutes / 60)}h`);
  if (citizen.today.restMinutes > 90) parts.push(`rested ${Math.round(citizen.today.restMinutes / 60)}h`);
  if (citizen.today.meals > 0) parts.push(`ate ${citizen.today.meals} time${citizen.today.meals === 1 ? "" : "s"}`);
  if (citizen.today.skippedWork) parts.push("skipped work");
  if (citizen.today.skippedSchool) parts.push("missed school");
  if (citizen.today.authorityEvents > 0) parts.push(`${citizen.today.authorityEvents} authority event${citizen.today.authorityEvents === 1 ? "" : "s"}`);
  if (citizen.today.conversations > 0) parts.push(`${citizen.today.conversations} conversation${citizen.today.conversations === 1 ? "" : "s"}`);
  if (citizen.today.goalProgress > 1) parts.push(`made ${Math.round(citizen.today.goalProgress)}% goal progress`);
  if (citizen.today.earned > 0) parts.push(`earned $${Math.round(citizen.today.earned)}`);
  if (citizen.today.spent > 0) parts.push(`spent $${Math.round(citizen.today.spent)}`);

  const text = parts.length ? `Today I ${parts.join(", ")}.` : "Today passed quietly without anything major changing.";
  citizen.lifeJournal.unshift({
    id: `${citizen.id}-summary-${day}-${citizen.lifeJournal.length}`,
    day,
    time: "24:00",
    text,
  });
  citizen.lifeJournal = citizen.lifeJournal.slice(0, 24);
}

function updateSchoolProgress(sim: SimulationState, citizen: Citizen) {
  if (!citizen.schoolProgress) return;

  const schoolDayMinutes = Math.max(1, citizen.routine.workEndMinute - citizen.routine.workStartMinute);
  const attendanceRatio = clamp(citizen.today.schoolMinutes / schoolDayMinutes, 0, 1);
  const supportBoost = citizen.schoolProgress.teacherSupport * 0.025;
  const motivationBoost = citizen.schoolProgress.motivation * 0.018;
  const gradeDelta = attendanceRatio * 5.5 + supportBoost + motivationBoost - (citizen.today.skippedSchool ? 5.5 : 1.2);

  citizen.schoolProgress.attendance = clamp(citizen.schoolProgress.attendance + attendanceRatio * 3.4 - (citizen.today.skippedSchool ? 6 : 1.1), 0, 100);
  citizen.schoolProgress.grades = clamp(citizen.schoolProgress.grades + gradeDelta, 0, 100);
  citizen.schoolProgress.motivation = clamp(citizen.schoolProgress.motivation + attendanceRatio * 2.2 + (citizen.mood - 55) * 0.035 - citizen.needs.rest * 0.025, 0, 100);

  if (citizen.today.schoolMinutes > 180 && citizen.schoolProgress.grades > 78) {
    addLifeJournal(sim, citizen, "School felt like it was starting to make sense today.");
  } else if (citizen.schoolProgress.grades < 38 && citizen.today.skippedSchool) {
    addLifeJournal(sim, citizen, "I am falling behind at school and I can feel it.");
  }
}

function updateCareerProgress(sim: SimulationState, citizen: Citizen) {
  if (!citizen.careerProgress) return;

  const expectedWorkMinutes = citizen.workplaceId ? Math.max(1, citizen.routine.workEndMinute - citizen.routine.workStartMinute) : 1;
  const workRatio = clamp(citizen.today.workedMinutes / expectedWorkMinutes, 0, 1);
  citizen.careerProgress.reliability = clamp(citizen.careerProgress.reliability + workRatio * 3.2 - (citizen.today.skippedWork ? 7 : 1.1), 0, 100);
  citizen.careerProgress.reputation = clamp(citizen.careerProgress.reputation + workRatio * 2.3 + citizen.personality.ambition * 0.012 - (citizen.today.skippedWork ? 3 : 0.5), 0, 100);
  citizen.careerProgress.satisfaction = clamp(citizen.careerProgress.satisfaction + (citizen.mood - 55) * 0.04 + workRatio * 0.8 - citizen.careerProgress.burnout * 0.025, 0, 100);
  citizen.careerProgress.burnout = clamp(citizen.careerProgress.burnout + workRatio * 3.4 + citizen.needs.rest * 0.02 - citizen.today.restMinutes * 0.035, 0, 100);

  if (citizen.careerProgress.reputation > 82 && workRatio > 0.65) {
    addLifeJournal(sim, citizen, "People at work seem to trust me more now.");
  } else if (citizen.careerProgress.reliability < 35) {
    addLifeJournal(sim, citizen, "My work reliability is slipping, and that could catch up with me.");
  } else if (citizen.careerProgress.burnout > 78) {
    addLifeJournal(sim, citizen, "Work is wearing me down more than I want to admit.");
  }
}

function updateSchedule(sim: SimulationState, citizen: Citizen) {
  const rand = mulberry32(sim.day * 10000 + sim.minute * 13 + Number(citizen.id.split("_")[1]));
  const previousIntention = citizen.currentIntention;
  const tick = brainTotalMinute(sim);
  const distanceToTarget = Math.hypot(citizen.targetX - citizen.x, citizen.targetY - citizen.y);
  const urgentNeed = citizen.needs.hunger > 88 || citizen.needs.rest > 88 || citizen.mood < 28;
  if (tick < citizen.committedUntil && distanceToTarget > 16 && !urgentNeed) {
    return;
  }

  const decision = chooseCitizenBrainDecision(sim, citizen, rand);
  citizen.currentIntention = decision.intention;
  citizen.decisionReasoning = decision.reasoning;
  citizen.brainDebug = decision.debug;
  citizen.currentThought = decision.result.decision.thought;
  citizen.committedUntil = tick + decision.result.decision.expectedMinutes;
  setDestination(citizen, decision.destinationId, rand, decision.intention);
  const actualIntention = decision.reasoning.authority.outcome === "guided" || decision.reasoning.authority.outcome === "blocked"
    ? decision.reasoning.alternatives[0]?.intention ?? decision.intention
    : decision.intention;
  applyAuthorityConsequences(sim, citizen, decision.reasoning.authority, actualIntention, addMemory);

  if (decision.intention === "eat" && previousIntention !== "eat") {
    citizen.today.meals += 1;
  }
}

function isWeatherExposed(citizen: Citizen) {
  return citizen.currentIntention === "wander" || citizen.currentIntention === "errand" || !isAtDestination(citizen);
}

function applyWeatherEffects(sim: SimulationState, citizen: Citizen, simMinutes: number) {
  const exposed = isWeatherExposed(citizen);
  if (sim.weather.kind === "rain" && exposed) {
    citizen.mood = clamp(citizen.mood - simMinutes * 0.025, 0, 100);
    citizen.needs.fun = clamp(citizen.needs.fun + simMinutes * 0.035, 0, 100);
    citizen.needs.rest = clamp(citizen.needs.rest + simMinutes * 0.025, 0, 100);
  } else if (sim.weather.kind === "fog" && exposed) {
    citizen.energy = clamp(citizen.energy - simMinutes * 0.018, 0, 100);
    citizen.needs.rest = clamp(citizen.needs.rest + simMinutes * 0.018, 0, 100);
  } else if (sim.weather.kind === "cloudy" && citizen.currentIntention === "socialize") {
    citizen.needs.belonging = clamp(citizen.needs.belonging - simMinutes * 0.03, 0, 100);
  }

  if (sim.weather.temperature < 58 && exposed) {
    citizen.needs.rest = clamp(citizen.needs.rest + simMinutes * 0.018, 0, 100);
  }
  if (sim.weather.temperature > 82 && exposed) {
    citizen.needs.hunger = clamp(citizen.needs.hunger + simMinutes * 0.03, 0, 100);
    citizen.energy = clamp(citizen.energy - simMinutes * 0.025, 0, 100);
  }
}

function updateNeeds(citizen: Citizen, simMinutes: number) {
  const activeDrain = citizen.currentIntention === "work" || citizen.currentIntention === "school" ? 0.9 : 0.45;
  citizen.needs.rest = clamp(citizen.needs.rest + activeDrain * simMinutes * 0.08, 0, 100);
  citizen.needs.hunger = clamp(citizen.needs.hunger + simMinutes * 0.11, 0, 100);
  citizen.needs.belonging = clamp(citizen.needs.belonging + simMinutes * 0.04, 0, 100);
  citizen.needs.fun = clamp(citizen.needs.fun + simMinutes * 0.05, 0, 100);

  if (citizen.currentIntention === "sleep" || citizen.currentIntention === "recover") {
    citizen.needs.rest = clamp(citizen.needs.rest - simMinutes * 0.36, 0, 100);
    citizen.energy = clamp(citizen.energy + simMinutes * 0.18, 0, 100);
  }
  if (citizen.currentIntention === "eat") {
    citizen.needs.hunger = clamp(citizen.needs.hunger - simMinutes * 0.44, 0, 100);
    citizen.mood = clamp(citizen.mood + simMinutes * 0.04, 0, 100);
  }
  if (citizen.currentIntention === "socialize") {
    citizen.needs.belonging = clamp(citizen.needs.belonging - simMinutes * 0.28, 0, 100);
    citizen.social = clamp(citizen.social + simMinutes * 0.2, 0, 100);
  }
  if (citizen.currentIntention === "wander") {
    citizen.needs.fun = clamp(citizen.needs.fun - simMinutes * 0.22, 0, 100);
    citizen.mood = clamp(citizen.mood + simMinutes * 0.025, 0, 100);
  }
  if (citizen.currentIntention === "work" || citizen.currentIntention === "school") {
    citizen.energy = clamp(citizen.energy - simMinutes * 0.08, 0, 100);
    citizen.social = clamp(citizen.social - simMinutes * 0.02, 0, 100);
  }
}

function applyPersonalSpace(citizens: Citizen[]) {
  for (let i = 0; i < citizens.length; i += 1) {
    for (let j = i + 1; j < citizens.length; j += 1) {
      const a = citizens[i];
      const b = citizens[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.max(0.001, Math.hypot(dx, dy));
      const minDistance = 15;
      if (distance >= minDistance) continue;

      const push = (minDistance - distance) * 0.08;
      const nx = dx / distance;
      const ny = dy / distance;
      a.x -= nx * push;
      a.y -= ny * push;
      b.x += nx * push;
      b.y += ny * push;
    }
  }
}


export function seedRumor(sim: SimulationState) {
  const starters = sim.citizens.filter((citizen) => citizen.workplaceId === "factory").slice(0, 3);
  for (const citizen of starters) {
    learn(citizen, FACTORY_RUMOR);
    addMemory(sim, citizen, "Heard a rumor that Northbridge Works may lay people off.");
    addLifeJournal(sim, citizen, "I heard a rumor that Northbridge Works may lay people off.");
  }
  addFeed(sim, "A factory layoff rumor starts with three workers.");
}

export function collapseFactory(sim: SimulationState) {
  if (sim.factoryClosed) return;
  sim.factoryClosed = true;
  const affectedCitizenIds: string[] = [];
  for (const citizen of sim.citizens) {
    if (citizen.workplaceId === "factory") {
      affectedCitizenIds.push(citizen.id);
      citizen.workplaceId = null;
      citizen.job = "Unemployed";
      citizen.careerProgress = null;
      citizen.mood = clamp(citizen.mood - 18, 0, 100);
      addMemory(sim, citizen, "I lost my job when Northbridge Works closed.");
      addLifeJournal(sim, citizen, "I lost my job when Northbridge Works closed.");
      setDestination(citizen, citizen.homeId, Math.random);
    }
  }
  addFeed(sim, "Northbridge Works closed. Factory workers lost their jobs.");
  addWorldDecision(sim, {
    category: "civic",
    status: "automatic",
    impact: "high",
    title: "Northbridge Works closed",
    summary: "Factory workers lost their jobs, and the town economy changed immediately.",
    relatedCitizenIds: affectedCitizenIds,
    relatedBuildingId: "factory",
    requiresApproval: false,
    reason: "The factory collapse was triggered from the controls panel.",
    effect: "Former factory workers lose income and may become part of future civic pressure.",
  });
}

export function stepSimulation(sim: SimulationState, realMs: number) {
  if (sim.paused) return sim;
  const minutesToAdvance = (realMs / 1000) * sim.speed * 4;
  const previousMinute = sim.minute;
  sim.minute += minutesToAdvance;

  if (sim.minute >= 1440) {
    for (const citizen of sim.citizens) maybePayCompletedShift(sim, citizen, 1439);
    const endedDay = sim.day;
    sim.minute -= 1440;
    sim.day += 1;
    sim.weather = weatherForDay(sim.day);
    for (const citizen of sim.citizens) {
      payPersonalCost(sim, citizen, dailyPersonalCost(citizen));
      citizen.energy = clamp(citizen.energy + 22, 0, 100);
      citizen.social = clamp(citizen.social - 10, 0, 100);
      citizen.needs.hunger = clamp(citizen.needs.hunger + 18, 0, 100);
      citizen.needs.belonging = clamp(citizen.needs.belonging + 8, 0, 100);
      citizen.needs.fun = clamp(citizen.needs.fun + 10, 0, 100);
      citizen.needs.rest = clamp(citizen.needs.rest - 28, 0, 100);
      const household = sim.households.find((item) => item.id === citizen.householdId);
      citizen.mood = clamp(citizen.mood + (citizen.social - 50) * 0.03 + dailyMoneyMoodDelta(citizen) - (household?.stress ?? 0) * 0.015, 0, 100);
      updateSchoolProgress(sim, citizen);
      updateCareerProgress(sim, citizen);
      summarizeDailyLife(citizen, endedDay);
      citizen.today = createDailyActivity(sim.day);
      citizen.currentThought = "A new day is starting. I need to see what matters first.";
      citizen.currentIntention = "home";
      citizen.committedUntil = brainTotalMinute(sim) + 30;
      brainRefreshPersonalGoals(sim, citizen, addLifeJournal);
      brainUpdateEmotionAndProblems(sim, citizen);
    }
    for (const household of sim.households) {
      const members = sim.citizens.filter((citizen) => citizen.householdId === household.id);
      const foodCost = Math.max(10, members.length * 9);
      household.foodStock = clamp(household.foodStock - members.length * 4, 0, 100);
      payHouseholdCost(sim, household, "rent", household.rent / 30, `${household.name} paid daily rent.`);
      payHouseholdCost(sim, household, "living", foodCost, `${household.name} covered shared utilities and pantry basics.`);
      updateHouseholdFinanceStatus(sim, household, members);
      for (const citizen of members) brainUpdateEmotionAndProblems(sim, citizen);
    }
    detectWorldObservations(sim);
    detectCivicIssues(sim);
    detectWorldRequests(sim);
    addFeed(sim, `A new day begins with ${sim.weather.kind} weather around ${sim.weather.temperature}F.`);
  }

  if (Math.floor(previousMinute / 30) !== Math.floor(sim.minute / 30)) {
    for (const citizen of sim.citizens) updateSchedule(sim, citizen);
  }

  if (Math.floor(previousMinute / 120) !== Math.floor(sim.minute / 120)) {
    for (const citizen of sim.citizens) brainRefreshPersonalGoals(sim, citizen, addLifeJournal);
    detectWorldObservations(sim);
    detectCivicIssues(sim);
    detectWorldRequests(sim);
  }

  const tick = sim.day * 1440 + sim.minute;
  for (const citizen of sim.citizens) {
    updateNeeds(citizen, minutesToAdvance);
    applyWeatherEffects(sim, citizen, minutesToAdvance);
    brainUpdateEmotionAndProblems(sim, citizen);
    if (citizen.lifeStage === "child") updateGuardianCare(sim, citizen);
    updateDailyActivity(citizen, minutesToAdvance);
    maybePayCompletedShift(sim, citizen);
    brainUpdateGoalProgress(sim, citizen, minutesToAdvance, addLifeJournal);
    moveCitizen(citizen, minutesToAdvance);
    maybeApplyPlaceTransaction(sim, citizen);
    if (citizen.conversationUntil <= tick) citizen.conversationWithId = null;
  }
  applyPersonalSpace(sim.citizens);

  for (let i = 0; i < sim.citizens.length; i += 1) {
    for (let j = i + 1; j < sim.citizens.length; j += 1) {
      const a = sim.citizens[i];
      const b = sim.citizens[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) < 38) maybeTalk(sim, a, b, tick, addMemory);
    }
  }

  return sim;
}

export function snapshot(sim: SimulationState): SimulationSnapshot {
  const averageMood = sim.citizens.reduce((sum, citizen) => sum + citizen.mood, 0) / sim.citizens.length;
  const rumorReach = sim.citizens.filter((citizen) => knows(citizen, FACTORY_RUMOR)).length / sim.citizens.length;
  const householdCash = sim.households.reduce((sum, household) => sum + household.sharedCash, 0);
  const citizenCash = sim.citizens.reduce((sum, citizen) => sum + citizen.cash, 0);
  const businessRevenue = ["market", "clinic"].reduce((sum, id) => sum + (sim.businessAccounts[id] ?? 0), 0);
  const majorDecisions = sim.worldDecisions.filter((decision) => decision.impact === "high" || decision.impact === "medium").length;
  const activeSignals = sim.worldSignals.filter((signal) => signal.status === "watched" || signal.status === "strong").length;
  const activeIssues = sim.civicIssues.filter((issue) => issue.status === "active" || issue.status === "urgent").length;
  const pendingRequests = sim.worldRequests.filter((request) => request.status === "pending").length;
  return {
    day: sim.day,
    time: formatTime(sim.minute),
    weather: sim.weather,
    population: sim.citizens.length,
    averageMood: Math.round(averageMood),
    rumorReach: Math.round(rumorReach * 100),
    totalConversations: sim.totalConversations,
    townCash: Math.round(householdCash + citizenCash),
    businessRevenue: Math.round(businessRevenue),
    majorDecisions,
    activeSignals,
    activeIssues,
    pendingRequests,
  };
}
