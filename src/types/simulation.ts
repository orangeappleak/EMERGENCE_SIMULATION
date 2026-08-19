export type BuildingKind = "home" | "factory" | "market" | "office" | "clinic" | "school";

export type Building = {
  id: string;
  name: string;
  kind: BuildingKind;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
};

export type PlaceSlotKind = "entry" | "living" | "kitchen" | "bedroom" | "yard" | "classroom" | "hallway" | "office" | "work" | "break" | "counter" | "aisle" | "waiting" | "exam";

export type PlaceSlot = {
  id: string;
  buildingId: string;
  name: string;
  kind: PlaceSlotKind;
  x: number;
  y: number;
  radius: number;
};

export type InteriorRoom = {
  id: string;
  name: string;
  slotKinds: PlaceSlotKind[];
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
};

export type InteriorFurnitureKind = "bed" | "table" | "chair" | "counter" | "desk" | "shelf" | "sofa" | "machine" | "board" | "plant";

export type InteriorFurniture = {
  id: string;
  kind: InteriorFurnitureKind;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
};

export type InteriorLayout = {
  id: string;
  name: string;
  rooms: InteriorRoom[];
  furniture: InteriorFurniture[];
};

export type Relationship = {
  friendship: number;
  trust: number;
  dislike: number;
  familiarity: number;
};

export type LifeStage = "child" | "teen" | "adult" | "elder";

export type FamilyRole = "parent" | "child" | "teen" | "partner" | "roommate" | "elder";

export type CitizenIntention = "sleep" | "home" | "work" | "school" | "eat" | "errand" | "socialize" | "wander" | "recover";

export type CitizenEmotion = "calm" | "happy" | "worried" | "stressed" | "lonely" | "curious" | "tired" | "hopeful" | "connected";

export type ConversationTopic = "workplace gossip" | "people gossip" | "money stress" | "family" | "school" | "future plans" | "personal problem" | "daily life" | "rumor";

export type ConversationClassification = "casual" | "serious" | "secretive" | "supportive" | "planning";

export type PersonalGoalKind = "school" | "career" | "money" | "friendship" | "family" | "wellbeing" | "curiosity";

export type AuthorityOutcome = "free" | "guided" | "blocked" | "defied";

export type WeatherKind = "clear" | "cloudy" | "rain" | "fog";

export type WeatherState = {
  kind: WeatherKind;
  temperature: number;
};

export type TransactionCategory = "wage" | "market" | "clinic" | "rent" | "living";

export type WorldDecisionCategory = "personal" | "social" | "economy" | "authority" | "civic";

export type WorldDecisionStatus = "automatic" | "pending" | "approved" | "rejected" | "modified";

export type WorldDecisionImpact = "low" | "medium" | "high";

export type WorldDecision = {
  id: string;
  day: number;
  time: string;
  category: WorldDecisionCategory;
  status: WorldDecisionStatus;
  impact: WorldDecisionImpact;
  title: string;
  summary: string;
  actorId?: string;
  actorName?: string;
  householdId?: string;
  householdName?: string;
  relatedCitizenIds: string[];
  relatedBuildingId?: string;
  requiresApproval: boolean;
  reason: string;
  effect: string;
};

export type EconomyTransaction = {
  id: string;
  day: number;
  time: string;
  category: TransactionCategory;
  amount: number;
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  citizenId?: string;
  householdId?: string;
  buildingId?: string;
  note: string;
};

export type DecisionScore = {
  intention: CitizenIntention;
  destinationId: string;
  destinationName: string;
  score: number;
  reason: string;
};

export type AuthorityCheck = {
  expectedIntention: CitizenIntention | null;
  expectedDestinationId: string | null;
  authority: string;
  pressure: number;
  resistance: number;
  outcome: AuthorityOutcome;
  reason: string;
};

export type AuthorityEvent = {
  id: string;
  day: number;
  time: string;
  outcome: AuthorityOutcome;
  authority: string;
  expectedIntention: CitizenIntention;
  actualIntention: CitizenIntention;
  pressure: number;
  resistance: number;
  consequence: string;
};

export type DecisionReasoning = {
  decidedAtDay: number;
  decidedAtTime: string;
  chosen: DecisionScore;
  alternatives: DecisionScore[];
  authority: AuthorityCheck;
  summary: string;
};

export type PersonalGoal = {
  id: string;
  kind: PersonalGoalKind;
  title: string;
  reason: string;
  priority: number;
  progress: number;
  status: "active" | "completed";
  createdDay: number;
};

export type DailyActivity = {
  day: number;
  workedMinutes: number;
  schoolMinutes: number;
  socialMinutes: number;
  restMinutes: number;
  errandMinutes: number;
  meals: number;
  skippedWork: boolean;
  skippedSchool: boolean;
  authorityEvents: number;
  conversations: number;
  goalProgress: number;
  earned: number;
  spent: number;
};

export type LifeJournalEntry = {
  id: string;
  day: number;
  time: string;
  text: string;
};

export type ConversationEntry = {
  id: string;
  day: number;
  time: string;
  speakerId?: string;
  speakerName?: string;
  withId: string;
  withName: string;
  topic: ConversationTopic;
  classification: ConversationClassification;
  classificationReason?: string;
  locationId?: string;
  locationName?: string;
  locationSlotId?: string;
  locationSlotName?: string;
  text: string;
};

export type SchoolProgress = {
  attendance: number;
  grades: number;
  teacherSupport: number;
  motivation: number;
};

export type CareerProgress = {
  reliability: number;
  reputation: number;
  satisfaction: number;
  burnout: number;
};

export type Household = {
  id: string;
  name: string;
  homeId: string;
  memberIds: string[];
  rent: number;
  sharedCash: number;
  foodStock: number;
  stress: number;
  unpaidBills: number;
  financialStatus: "stable" | "strained" | "critical";
  lastMoneyNote: string;
};

export type Citizen = {
  id: string;
  name: string;
  age: number;
  lifeStage: LifeStage;
  householdId: string;
  familyRole: FamilyRole;
  institutionRole: string | null;
  schoolClass: "elementary" | "middle" | "high" | null;
  homeId: string;
  workplaceId: string | null;
  job: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  destinationId: string;
  currentSlotId: string;
  destinationSlotId: string;
  mood: number;
  cash: number;
  energy: number;
  social: number;
  currentThought: string;
  currentIntention: CitizenIntention;
  currentEmotion: CitizenEmotion;
  decisionReasoning: DecisionReasoning | null;
  goalFocus: string;
  personalGoals: PersonalGoal[];
  problems: string[];
  recentAuthorityEvents: AuthorityEvent[];
  recentConversations: ConversationEntry[];
  committedUntil: number;
  today: DailyActivity;
  lifeJournal: LifeJournalEntry[];
  schoolProgress: SchoolProgress | null;
  careerProgress: CareerProgress | null;
  personality: {
    responsibility: number;
    sociability: number;
    curiosity: number;
    ambition: number;
    independence: number;
  };
  needs: {
    hunger: number;
    belonging: number;
    fun: number;
    rest: number;
  };
  lastTransactionAt: Record<string, number>;
  knownFacts: string[];
  memories: string[];
  relationships: Record<string, Relationship>;
  conversationUntil: number;
  conversationWithId: string | null;
  lastTalkedAt: Record<string, number>;
  routine: {
    wakeMinute: number;
    workStartMinute: number;
    lunchMinute: number;
    workEndMinute: number;
    sleepMinute: number;
    errandChance: number;
    sociability: number;
    punctuality: number;
    walkingSpeed: number;
  };
  style: {
    clothes: string;
    skin: string;
    hair: string;
    accent: string;
    hairStyle: "cap" | "short" | "bob" | "tall" | "bald";
    build: "small" | "average" | "broad";
    accessory: "none" | "glasses" | "bag" | "hat";
  };
};

export type WorldEvent = {
  id: string;
  day: number;
  time: string;
  text: string;
};

export type SimulationState = {
  day: number;
  minute: number;
  speed: number;
  paused: boolean;
  factoryClosed: boolean;
  weather: WeatherState;
  totalConversations: number;
  worldDecisions: WorldDecision[];
  transactionLog: EconomyTransaction[];
  businessAccounts: Record<string, number>;
  conversationLog: ConversationEntry[];
  households: Household[];
  citizens: Citizen[];
  feed: WorldEvent[];
};

export type SimulationSnapshot = {
  day: number;
  time: string;
  weather: WeatherState;
  population: number;
  averageMood: number;
  rumorReach: number;
  totalConversations: number;
  townCash: number;
  businessRevenue: number;
  majorDecisions: number;
};
