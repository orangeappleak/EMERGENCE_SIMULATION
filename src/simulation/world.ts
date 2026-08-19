import type { AuthorityCheck, AuthorityEvent, Building, Citizen, CitizenIntention, ConversationClassification, ConversationTopic, DailyActivity, EconomyTransaction, FamilyRole, Household, LifeStage, PlaceSlot, SimulationSnapshot, SimulationState, TransactionCategory, WeatherState, WorldEvent } from "../types/simulation";
import {
  chooseCitizenDecision as brainChooseCitizenDecision,
  chooseConversationTopic as brainChooseConversationTopic,
  classifyConversation as brainClassifyConversation,
  conversationText as brainConversationText,
  currentObligation as brainCurrentObligation,
  emotionAfterConversation,
  refreshPersonalGoals as brainRefreshPersonalGoals,
  thoughtFor as brainThoughtFor,
  totalMinute as brainTotalMinute,
  updateEmotionAndProblems as brainUpdateEmotionAndProblems,
  updateGoalProgress as brainUpdateGoalProgress,
} from "./brain";
import { BUILDINGS, FACTORY_RUMOR, PLACE_SLOTS, WALK_PIXELS_PER_SIM_MINUTE } from "./constants";
import { clamp, mulberry32, pick } from "./random";
import { formatTime } from "./time";

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

function centerOf(buildingId: string) {
  const building = buildingById(buildingId);
  return {
    x: building.x + building.width / 2,
    y: building.y + building.height / 2,
  };
}

export function placeSlotById(id: string): PlaceSlot {
  const slot = PLACE_SLOTS.find((item) => item.id === id);
  if (!slot) throw new Error(`Unknown place slot: ${id}`);
  return slot;
}

function slotsForBuilding(buildingId: string) {
  return PLACE_SLOTS.filter((slot) => slot.buildingId === buildingId);
}

function firstSlot(buildingId: string) {
  return slotsForBuilding(buildingId)[0] ?? {
    id: `${buildingId}_entry`,
    buildingId,
    name: "entry",
    kind: "entry" as const,
    ...centerOf(buildingId),
    radius: 18,
  };
}

function slotForKind(buildingId: string, kinds: PlaceSlot["kind"][]) {
  const slots = slotsForBuilding(buildingId);
  return kinds.map((kind) => slots.find((slot) => slot.kind === kind)).find((slot) => slot !== undefined) ?? firstSlot(buildingId);
}

function chooseDestinationSlot(citizen: Citizen, destinationId: string, intention: CitizenIntention, rand: () => number) {
  const building = buildingById(destinationId);
  if (building.kind === "home") {
    if (intention === "sleep" || intention === "recover") return slotForKind(destinationId, ["bedroom", "living"]);
    if (intention === "eat") return slotForKind(destinationId, ["kitchen", "living"]);
    if (intention === "socialize") return slotForKind(destinationId, ["living", "kitchen", "yard"]);
    if (intention === "wander") return slotForKind(destinationId, ["yard", "living"]);
    return slotForKind(destinationId, ["living", "kitchen", "bedroom"]);
  }
  if (building.kind === "school") {
    if (citizen.institutionRole && citizen.institutionRole !== "student") return slotForKind(destinationId, ["office", "hallway", "classroom"]);
    if (intention === "socialize" || intention === "wander") return slotForKind(destinationId, ["hallway", "yard", "classroom"]);
    return slotForKind(destinationId, ["classroom", "hallway"]);
  }
  if (building.kind === "factory" || building.kind === "office") {
    if (intention === "socialize" || intention === "eat") return slotForKind(destinationId, ["break", "entry", "work"]);
    return slotForKind(destinationId, ["work", "break", "entry"]);
  }
  if (building.kind === "market") {
    if (citizen.workplaceId === "market" && intention === "work") return slotForKind(destinationId, ["counter", "aisle"]);
    return slotForKind(destinationId, rand() < 0.5 ? ["aisle", "counter", "entry"] : ["counter", "aisle", "entry"]);
  }
  if (building.kind === "clinic") {
    return slotForKind(destinationId, intention === "work" ? ["exam", "waiting"] : ["waiting", "exam", "entry"]);
  }
  return firstSlot(destinationId);
}

export function buildingById(id: string): Building {
  const building = BUILDINGS.find((item) => item.id === id);
  if (!building) throw new Error(`Unknown building: ${id}`);
  return building;
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
  const homeSlot = slotForKind(household.homeId, ["living", "kitchen"]);
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
    goalFocus: "settle into the day",
    personalGoals: [],
    problems: lifeStage === "adult" && cash < 420 ? ["Money feels tight."] : [],
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
      const familiarity = clamp((family ? 88 : sameHome ? 70 : 12) + (coworkers ? 26 : 0) + (schoolLink ? 34 : 0) + rand() * 16, 0, 100);
      a.relationships[b.id] = {
        friendship: clamp((family ? 72 : 0) + (schoolLink ? 18 : 0) + familiarity * 0.42 + rand() * 24, 0, 100),
        trust: clamp((family ? 78 : 0) + (schoolLink ? 22 : 0) + familiarity * 0.4 + rand() * 22, 0, 100),
        dislike: clamp((family ? rand() * 7 : rand() * 22) - familiarity * 0.06, 0, 100),
        familiarity,
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

function addLifeJournal(sim: SimulationState, citizen: Citizen, text: string) {
  const entry = {
    id: `${citizen.id}-${sim.day}-${Math.round(sim.minute)}-${citizen.lifeJournal.length}`,
    day: sim.day,
    time: formatTime(sim.minute),
    text,
  };
  if (citizen.lifeJournal[0]?.text !== text) citizen.lifeJournal.unshift(entry);
  citizen.lifeJournal = citizen.lifeJournal.slice(0, 24);
}

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
}

function addFeed(sim: SimulationState, text: string) {
  const event: WorldEvent = {
    id: `${sim.day}-${sim.minute}-${sim.feed.length}-${text}`,
    day: sim.day,
    time: formatTime(sim.minute),
    text,
  };
  if (sim.feed[0]?.text !== text) sim.feed.unshift(event);
  sim.feed = sim.feed.slice(0, 18);
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
}

function payHouseholdCost(sim: SimulationState, household: Household, category: "rent" | "living", amount: number, note: string) {
  const paid = Math.min(household.sharedCash, amount);
  household.sharedCash -= paid;
  household.stress = clamp(household.stress + (paid < amount ? 5 : 0), 0, 100);
  adjustBusiness(sim, "town", paid);
  addTransaction(sim, {
    category,
    amount: paid,
    fromId: household.id,
    fromName: household.name,
    toId: "town",
    toName: "Town services",
    householdId: household.id,
    note: paid < amount ? `${note} They could only cover $${Math.round(paid)}.` : note,
  });
}

function spendAtBuilding(sim: SimulationState, citizen: Citizen, buildingId: string, category: "market" | "clinic", amount: number, note: string) {
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
  return paid;
}

function payPersonalCost(sim: SimulationState, citizen: Citizen, amount: number) {
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

function hasRecentTransaction(sim: SimulationState, citizen: Citizen, key: string, withinMinutes: number) {
  const tick = brainTotalMinute(sim);
  return (citizen.lastTransactionAt[key] ?? -Infinity) + withinMinutes > tick;
}

function markTransaction(citizen: Citizen, sim: SimulationState, key: string) {
  citizen.lastTransactionAt[key] = brainTotalMinute(sim);
}

function applyAuthorityConsequences(sim: SimulationState, citizen: Citizen, authority: AuthorityCheck, actualIntention: AuthorityEvent["actualIntention"]) {
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

function payFor(citizen: Citizen) {
  if (citizen.workplaceId === "factory") return 95;
  if (citizen.workplaceId === "office") return 125;
  if (citizen.workplaceId === "market") return 80;
  if (citizen.workplaceId === "school") return 105;
  return 0;
}

function maybeApplyPlaceTransaction(sim: SimulationState, citizen: Citizen) {
  if (!isAtDestination(citizen)) return;

  if (citizen.destinationId === "market" && (citizen.currentIntention === "eat" || citizen.currentIntention === "errand")) {
    const key = transactionKey("market", "market");
    if (hasRecentTransaction(sim, citizen, key, 140)) return;
    const household = sim.households.find((item) => item.id === citizen.householdId);
    const mealCost = citizen.lifeStage === "child" ? 4 : citizen.lifeStage === "teen" ? 7 : 12;
    const groceryCost = household && household.foodStock < 45 ? 28 : 0;
    const amount = mealCost + groceryCost;
    const paid = spendAtBuilding(sim, citizen, "market", "market", amount, groceryCost ? "Bought food and household groceries." : "Bought something to eat.");
    if (paid > 0) {
      citizen.needs.hunger = clamp(citizen.needs.hunger - 32, 0, 100);
      citizen.needs.fun = clamp(citizen.needs.fun - 5, 0, 100);
      citizen.mood = clamp(citizen.mood + 1.4, 0, 100);
      if (household && groceryCost) household.foodStock = clamp(household.foodStock + 18, 0, 100);
      addLifeJournal(sim, citizen, groceryCost ? "I spent money at the market and brought food back into the household." : "I bought food at the market.");
    }
    markTransaction(citizen, sim, key);
  }

  if (citizen.destinationId === "clinic" && citizen.currentIntention === "recover") {
    const key = transactionKey("clinic", "clinic");
    if (hasRecentTransaction(sim, citizen, key, 320)) return;
    const amount = citizen.lifeStage === "child" ? 35 : citizen.lifeStage === "elder" ? 70 : 55;
    const paid = spendAtBuilding(sim, citizen, "clinic", "clinic", amount, "Paid for care at the clinic.");
    if (paid > 0) {
      citizen.energy = clamp(citizen.energy + 12, 0, 100);
      citizen.needs.rest = clamp(citizen.needs.rest - 18, 0, 100);
      citizen.mood = clamp(citizen.mood + 1, 0, 100);
      addLifeJournal(sim, citizen, "I paid for a clinic visit and felt a little steadier after.");
    }
    markTransaction(citizen, sim, key);
  }
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

function setDestination(citizen: Citizen, destinationId: string, rand: () => number, intention: CitizenIntention = citizen.currentIntention) {
  const slot = chooseDestinationSlot(citizen, destinationId, intention, rand);
  if (citizen.destinationId === destinationId && Math.hypot(citizen.targetX - citizen.x, citizen.targetY - citizen.y) > 7) {
    return;
  }
  citizen.destinationId = destinationId;
  citizen.destinationSlotId = slot.id;
  citizen.targetX = slot.x + (rand() - 0.5) * slot.radius * 1.6;
  citizen.targetY = slot.y + (rand() - 0.5) * slot.radius * 1.6;
}

function updateSchedule(sim: SimulationState, citizen: Citizen) {
  const rand = mulberry32(sim.day * 10000 + sim.minute * 13 + Number(citizen.id.split("_")[1]));
  const obligation = brainCurrentObligation(citizen, sim.minute, sim);
  const previousIntention = citizen.currentIntention;
  const tick = brainTotalMinute(sim);
  const distanceToTarget = Math.hypot(citizen.targetX - citizen.x, citizen.targetY - citizen.y);
  const urgentNeed = citizen.needs.hunger > 88 || citizen.needs.rest > 88 || citizen.mood < 28;
  if (tick < citizen.committedUntil && distanceToTarget > 16 && !urgentNeed) {
    return;
  }

  const decision = brainChooseCitizenDecision(sim, citizen, rand);
  citizen.currentIntention = decision.intention;
  citizen.decisionReasoning = decision.reasoning;
  citizen.currentThought = brainThoughtFor(citizen, decision.intention, decision.destinationId, obligation);
  const commitmentMinutes = decision.intention === "work" || decision.intention === "school"
    ? 95
    : decision.intention === "eat" || decision.intention === "errand"
      ? 45
      : decision.intention === "socialize" || decision.intention === "wander"
        ? 55
        : 35;
  citizen.committedUntil = tick + commitmentMinutes;
  setDestination(citizen, decision.destinationId, rand, decision.intention);
  const actualIntention = decision.reasoning.authority.outcome === "guided" || decision.reasoning.authority.outcome === "blocked"
    ? decision.reasoning.alternatives[0]?.intention ?? decision.intention
    : decision.intention;
  applyAuthorityConsequences(sim, citizen, decision.reasoning.authority, actualIntention);

  if (decision.intention === "eat" && previousIntention !== "eat") {
    citizen.today.meals += 1;
  }
}

function moveCitizen(citizen: Citizen, simMinutes: number) {
  const dx = citizen.targetX - citizen.x;
  const dy = citizen.targetY - citizen.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return;
  const step = Math.min(distance, simMinutes * WALK_PIXELS_PER_SIM_MINUTE * citizen.routine.walkingSpeed);
  citizen.x += (dx / distance) * step;
  citizen.y += (dy / distance) * step;
  if (distance <= step + 1) {
    citizen.currentSlotId = citizen.destinationSlotId;
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

function effectiveSlot(citizen: Citizen) {
  return isAtDestination(citizen) ? placeSlotById(citizen.destinationSlotId) : placeSlotById(citizen.currentSlotId);
}

function conversationLocation(a: Citizen, b: Citizen) {
  const slot = a.destinationSlotId === b.destinationSlotId ? placeSlotById(a.destinationSlotId) : Math.hypot(a.x - b.x, a.y - b.y) < 24 ? effectiveSlot(a) : effectiveSlot(b);
  return {
    building: buildingById(slot.buildingId),
    slot,
  };
}

function isAtDestination(citizen: Citizen) {
  return Math.hypot(citizen.targetX - citizen.x, citizen.targetY - citizen.y) < 22;
}

function buildingContains(citizen: Citizen, building: Building, padding = 20) {
  return (
    citizen.x >= building.x - padding
    && citizen.x <= building.x + building.width + padding
    && citizen.y >= building.y - padding
    && citizen.y <= building.y + building.height + padding
  );
}

function conversationContext(a: Citizen, b: Citizen): { zone: "home" | "work" | "school" | "public" | "street"; multiplier: number } | null {
  const distance = Math.hypot(a.x - b.x, a.y - b.y);
  if (distance > 44) return null;

  const aMoving = !isAtDestination(a);
  const bMoving = !isAtDestination(b);
  const bothMoving = aMoving && bMoving;
  if (bothMoving && distance > 24) return null;
  const aSlot = effectiveSlot(a);
  const bSlot = effectiveSlot(b);
  const sameSlot = aSlot.id === bSlot.id;

  if (a.householdId === b.householdId && a.destinationId === a.homeId && b.destinationId === b.homeId) {
    const home = buildingById(a.homeId);
    if (buildingContains(a, home, 36) && buildingContains(b, home, 36)) return { zone: "home", multiplier: sameSlot ? 3 : 2.2 };
  }

  if (a.destinationId === "school" && b.destinationId === "school") {
    const school = buildingById("school");
    if (buildingContains(a, school, 34) && buildingContains(b, school, 34)) return { zone: "school", multiplier: sameSlot ? 2.4 : 1.5 };
  }

  if (a.workplaceId && a.workplaceId === b.workplaceId && a.destinationId === a.workplaceId && b.destinationId === b.workplaceId) {
    const workplace = buildingById(a.workplaceId);
    if (buildingContains(a, workplace, 34) && buildingContains(b, workplace, 34)) return { zone: "work", multiplier: sameSlot ? 2.2 : 1.35 };
  }

  if (a.destinationId === b.destinationId && ["market", "clinic"].includes(a.destinationId)) {
    const place = buildingById(a.destinationId);
    if (buildingContains(a, place, 42) && buildingContains(b, place, 42)) return { zone: "public", multiplier: sameSlot ? 2 : 1.25 };
  }

  if (distance < 26 && !bothMoving) return { zone: "street", multiplier: 0.9 };
  return null;
}

function addConversationEntry(sim: SimulationState, speaker: Citizen, listener: Citizen, topic: ConversationTopic, classification: ConversationClassification, classificationReason: string, text: string) {
  speaker.recentConversations.unshift({
    id: `${speaker.id}-${listener.id}-${sim.day}-${Math.round(sim.minute)}-${speaker.recentConversations.length}`,
    day: sim.day,
    time: formatTime(sim.minute),
    speakerId: speaker.id,
    speakerName: speaker.name,
    withId: listener.id,
    withName: listener.name,
    topic,
    classification,
    classificationReason,
    text,
  });
  speaker.recentConversations = speaker.recentConversations.slice(0, 10);
}

function addGlobalConversation(sim: SimulationState, a: Citizen, b: Citizen, topic: ConversationTopic, classification: ConversationClassification, classificationReason: string, text: string) {
  const location = conversationLocation(a, b);
  sim.conversationLog.unshift({
    id: `${sim.day}-${Math.round(sim.minute)}-${a.id}-${b.id}-${sim.conversationLog.length}`,
    day: sim.day,
    time: formatTime(sim.minute),
    speakerId: a.id,
    speakerName: a.name,
    withId: b.id,
    withName: b.name,
    topic,
    classification,
    classificationReason,
    locationId: location.building.id,
    locationName: location.building.name,
    locationSlotId: location.slot.id,
    locationSlotName: location.slot.name,
    text,
  });
  sim.conversationLog = sim.conversationLog.slice(0, 240);
}

function knows(citizen: Citizen, fact: string) {
  return citizen.knownFacts.includes(fact);
}

function learn(citizen: Citizen, fact: string) {
  if (!knows(citizen, fact)) citizen.knownFacts.push(fact);
}

function maybeTalk(sim: SimulationState, a: Citizen, b: Citizen, tick: number) {
  if (a.conversationUntil > tick || b.conversationUntil > tick) return;
  if ((a.lastTalkedAt[b.id] || 0) + 95 > tick) return;

  const relationship = a.relationships[b.id];
  const context = conversationContext(a, b);
  if (!context) return;
  const socialMood = a.currentIntention === "socialize" || b.currentIntention === "socialize";
  const householdTalk = context.zone === "home" ? 1.7 : 1;
  const chance = ((relationship.familiarity + relationship.friendship + relationship.trust - relationship.dislike) / 5200)
    * a.routine.sociability
    * b.routine.sociability
    * context.multiplier
    * householdTalk
    * (socialMood ? 1.5 : 1);
  if (Math.random() > chance) return;

  const reverse = b.relationships[a.id];
  const rand = Math.random;
  const topic = brainChooseConversationTopic(sim, a, b, rand);
  const delta = topic === "personal problem" || topic === "future plans" ? 4 : topic === "rumor" || topic === "people gossip" ? 3 : 2;
  const aText = brainConversationText(sim, a, b, topic, rand);
  const bText = brainConversationText(sim, b, a, topic, rand);
  const classificationResult = brainClassifyConversation(topic, a, b);
  const { classification, reason: classificationReason } = classificationResult;

  relationship.familiarity = clamp(relationship.familiarity + delta, 0, 100);
  relationship.friendship = clamp(relationship.friendship + delta * 0.6 - relationship.dislike * 0.02, 0, 100);
  relationship.trust = clamp(relationship.trust + delta * 0.35, 0, 100);
  reverse.familiarity = clamp(reverse.familiarity + delta, 0, 100);
  reverse.friendship = clamp(reverse.friendship + delta * 0.5 - reverse.dislike * 0.02, 0, 100);
  reverse.trust = clamp(reverse.trust + delta * 0.35, 0, 100);

  a.social = clamp(a.social + 8, 0, 100);
  b.social = clamp(b.social + 8, 0, 100);
  a.conversationUntil = tick + 55;
  b.conversationUntil = tick + 55;
  a.conversationWithId = b.id;
  b.conversationWithId = a.id;
  a.lastTalkedAt[b.id] = tick;
  b.lastTalkedAt[a.id] = tick;
  a.today.conversations += 1;
  b.today.conversations += 1;
  sim.totalConversations += 1;
  addConversationEntry(sim, a, b, topic, classification, classificationReason, aText);
  addConversationEntry(sim, b, a, topic, classification, classificationReason, bText);
  addGlobalConversation(sim, a, b, topic, classification, classificationReason, `${aText} ${bText}`);
  a.currentThought = `I keep thinking about what ${b.name} said.`;
  b.currentThought = `I keep thinking about what ${a.name} said.`;
  a.currentEmotion = emotionAfterConversation(topic);
  b.currentEmotion = emotionAfterConversation(topic);

  const aCanTell = knows(a, FACTORY_RUMOR) && !knows(b, FACTORY_RUMOR) && topic === "rumor" && relationship.trust > 28;
  const bCanTell = knows(b, FACTORY_RUMOR) && !knows(a, FACTORY_RUMOR) && topic === "rumor" && reverse.trust > 28;
  if (aCanTell) {
    learn(b, FACTORY_RUMOR);
    addMemory(sim, b, `${a.name} said Northbridge Works may be in trouble.`);
    addLifeJournal(sim, b, `${a.name} told me the factory might be in trouble.`);
    addFeed(sim, `${a.name} told ${b.name} the factory rumor.`);
  } else if (bCanTell) {
    learn(a, FACTORY_RUMOR);
    addMemory(sim, a, `${b.name} said Northbridge Works may be in trouble.`);
    addLifeJournal(sim, a, `${b.name} told me the factory might be in trouble.`);
    addFeed(sim, `${b.name} told ${a.name} the factory rumor.`);
  } else if (Math.random() < 0.22 || topic === "personal problem" || topic === "future plans") {
    addMemory(sim, a, `Talked with ${b.name} about ${topic}.`);
    addMemory(sim, b, `Talked with ${a.name} about ${topic}.`);
    addLifeJournal(sim, a, bText.replace(b.name, `I heard ${b.name}`));
    addLifeJournal(sim, b, aText.replace(a.name, `I heard ${a.name}`));
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
  for (const citizen of sim.citizens) {
    if (citizen.workplaceId === "factory") {
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
}

export function stepSimulation(sim: SimulationState, realMs: number) {
  if (sim.paused) return sim;
  const minutesToAdvance = (realMs / 1000) * sim.speed * 4;
  const previousMinute = sim.minute;
  sim.minute += minutesToAdvance;

  if (sim.minute >= 1440) {
    const endedDay = sim.day;
    sim.minute -= 1440;
    sim.day += 1;
    sim.weather = weatherForDay(sim.day);
    for (const citizen of sim.citizens) {
      const earned = payFor(citizen);
      payCitizenWage(sim, citizen, earned);
      contributeToHousehold(sim, citizen, Math.round(earned * 0.32));
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
      household.stress = clamp(45 - household.foodStock * 0.25 + (household.sharedCash < household.rent ? 32 : 0), 0, 100);
    }
    addFeed(sim, `A new day begins with ${sim.weather.kind} weather around ${sim.weather.temperature}F.`);
  }

  if (Math.floor(previousMinute / 30) !== Math.floor(sim.minute / 30)) {
    for (const citizen of sim.citizens) updateSchedule(sim, citizen);
  }

  if (Math.floor(previousMinute / 120) !== Math.floor(sim.minute / 120)) {
    for (const citizen of sim.citizens) brainRefreshPersonalGoals(sim, citizen, addLifeJournal);
  }

  const tick = sim.day * 1440 + sim.minute;
  for (const citizen of sim.citizens) {
    updateNeeds(citizen, minutesToAdvance);
    applyWeatherEffects(sim, citizen, minutesToAdvance);
    brainUpdateEmotionAndProblems(sim, citizen);
    updateDailyActivity(citizen, minutesToAdvance);
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
      if (Math.hypot(a.x - b.x, a.y - b.y) < 38) maybeTalk(sim, a, b, tick);
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
  };
}
