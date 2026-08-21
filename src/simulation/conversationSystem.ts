import type { Citizen, ConversationClassification, ConversationImportance, ConversationTopic, RelationshipStage, SimulationState } from "../types/simulation";
import {
  classifyConversation as brainClassifyConversation,
  conversationText as brainConversationText,
  emotionAfterConversation,
} from "./brain";
import { FACTORY_RUMOR } from "./constants";
import { addFeed, addLifeJournal, addWorldDecision } from "./eventLog";
import { buildingById, buildingContains, isAtDestination, placeSlotById } from "./movementSystem";
import { clamp, mulberry32 } from "./random";
import { formatTime } from "./time";

export type AddMemory = (sim: SimulationState, citizen: Citizen, text: string) => void;

type ConversationContext = {
  zone: "home" | "work" | "school" | "public" | "street";
  multiplier: number;
};

type ConversationLocation = ReturnType<typeof conversationLocation>;

type ConversationPlan = {
  topic: ConversationTopic;
  classification: ConversationClassification;
  classificationReason: string;
  relationshipStage: RelationshipStage;
  aText: string;
  bText: string;
  location: ConversationLocation;
  contextZone: ConversationContext["zone"];
  evidenceSummary: string;
  evidenceTags: string[];
  importance: ConversationImportance;
  relationshipDelta: number;
  shouldLogWorldDecision: boolean;
  shouldWriteMemory: boolean;
};

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

function conversationContext(a: Citizen, b: Citizen): ConversationContext | null {
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

function citizenIndex(citizen: Citizen) {
  return Number(citizen.id.split("_")[1]) || 0;
}

function conversationRand(sim: SimulationState, a: Citizen, b: Citizen, tick: number) {
  const first = Math.min(citizenIndex(a), citizenIndex(b));
  const second = Math.max(citizenIndex(a), citizenIndex(b));
  const window = Math.floor(tick / 15);
  return mulberry32(sim.day * 31000 + window * 97 + first * 131 + second * 197);
}

function conversationImportance(topic: ConversationTopic, classification: ConversationClassification, a: Citizen, b: Citizen): ConversationImportance {
  if (classification === "secretive") return "high";
  if (topic === "money stress" || topic === "personal problem") return "high";
  if (classification === "planning" && (a.goalFocus || b.goalFocus)) return "high";
  if (classification === "serious" || classification === "planning" || a.problems.length || b.problems.length) return "medium";
  return "low";
}

export function relationshipStage(a: Citizen, b: Citizen): RelationshipStage {
  const relationship = a.relationships[b.id];
  if (!relationship) return "stranger";
  if (a.householdId === b.householdId && a.familyRole !== "roommate" && b.familyRole !== "roommate") return "family";
  if (
    (a.familyRole === "parent" && b.householdId === a.householdId)
    || (b.familyRole === "parent" && a.householdId === b.householdId)
    || (a.workplaceId === "school" && Boolean(b.schoolClass))
    || (b.workplaceId === "school" && Boolean(a.schoolClass))
  ) return "authority";

  const score = relationship.familiarity * 0.42
    + relationship.trust * 0.28
    + relationship.friendship * 0.24
    + relationship.interactions * 3
    - relationship.dislike * 0.35;
  if (relationship.interactions >= 9 && relationship.trust >= 68 && relationship.friendship >= 58) return "close";
  if (relationship.interactions >= 5 && score >= 54) return "friend";
  if (relationship.interactions >= 2 && score >= 34) return "familiar";
  if (relationship.interactions >= 1 || relationship.familiarity >= 18) return "acquaintance";
  return "stranger";
}

function canDiscussTopic(topic: ConversationTopic, stage: RelationshipStage, context: ConversationContext, a: Citizen, b: Citizen) {
  if (topic === "daily life") return true;
  if (topic === "school") return context.zone === "school" || stage === "family" || stage === "authority" || stage === "friend" || stage === "close";
  if (topic === "workplace gossip") return context.zone === "work" && (stage === "familiar" || stage === "friend" || stage === "close");
  if (topic === "future plans") return stage === "familiar" || stage === "friend" || stage === "close" || stage === "family";
  if (topic === "family") return stage === "family" || stage === "close" || (stage === "friend" && Math.min(a.relationships[b.id]?.trust ?? 0, b.relationships[a.id]?.trust ?? 0) >= 45);
  if (topic === "personal problem") return stage === "friend" || stage === "close" || stage === "family" || stage === "authority";
  if (topic === "money stress") return stage === "close" || stage === "family" || (stage === "friend" && Math.min(a.relationships[b.id]?.trust ?? 0, b.relationships[a.id]?.trust ?? 0) >= 55);
  if (topic === "rumor" || topic === "people gossip") return stage === "friend" || stage === "close";
  return false;
}

function possibleTopics(sim: SimulationState, a: Citizen, b: Citizen, context: ConversationContext, stage: RelationshipStage) {
  const options: ConversationTopic[] = ["daily life"];
  if (a.workplaceId && a.workplaceId === b.workplaceId) options.push("workplace gossip");
  if (a.problems.length || b.problems.length) options.push("personal problem");
  if (a.cash < 180 || b.cash < 180 || a.problems.some((problem) => problem.toLowerCase().includes("money")) || b.problems.some((problem) => problem.toLowerCase().includes("money"))) options.push("money stress");
  if (a.householdId === b.householdId || a.familyRole === "parent" || b.familyRole === "parent") options.push("family");
  if (a.schoolClass || b.schoolClass || a.workplaceId === "school" || b.workplaceId === "school") options.push("school");
  if (a.goalFocus || b.goalFocus) options.push("future plans");
  if (a.knownFacts.includes(FACTORY_RUMOR) || b.knownFacts.includes(FACTORY_RUMOR)) options.push("rumor");
  if (sim.citizens.length > 3) options.push("people gossip");
  return options.filter((topic, index, topics) => (
    topics.indexOf(topic) === index && canDiscussTopic(topic, stage, context, a, b)
  ));
}

function conversationLine(sim: SimulationState, speaker: Citizen, listener: Citizen, topic: ConversationTopic, stage: RelationshipStage, rand: () => number) {
  if (topic === "daily life" && stage === "stranger") {
    return `${speaker.name} introduced themselves to ${listener.name} and kept the conversation light.`;
  }
  if (topic === "daily life" && stage === "acquaintance") {
    return `${speaker.name} made small talk with ${listener.name} while getting a little more familiar.`;
  }
  return brainConversationText(sim, speaker, listener, topic, rand);
}

function evidenceTags(topic: ConversationTopic, classification: ConversationClassification, context: ConversationContext, a: Citizen, b: Citizen, location: ConversationLocation) {
  const tags = new Set<string>([topic, classification, context.zone, location.building.kind]);
  if (a.householdId === b.householdId) tags.add("same household");
  if (a.workplaceId && a.workplaceId === b.workplaceId) tags.add("same workplace");
  if (a.lifeStage === "child" || b.lifeStage === "child") tags.add("child present");
  if (a.problems.length || b.problems.length) tags.add("active problem");
  if (topic === "money stress") tags.add("economy");
  if (topic === "school") tags.add("education");
  if (topic === "workplace gossip") tags.add("employment");
  if (topic === "family") tags.add("household");
  return Array.from(tags);
}

function evidenceSummary(topic: ConversationTopic, classification: ConversationClassification, context: ConversationContext, a: Citizen, b: Citizen) {
  if (topic === "money stress") return `${a.name} and ${b.name} surfaced money pressure during a ${context.zone} conversation.`;
  if (topic === "personal problem") return `${a.name} and ${b.name} shared a personal pressure that may matter later.`;
  if (topic === "future plans") return `${a.name} and ${b.name} compared future goals and possible next steps.`;
  if (topic === "workplace gossip") return `${a.name} and ${b.name} talked about workplace pressure.`;
  if (topic === "school") return `${a.name} and ${b.name} talked about school responsibilities.`;
  if (topic === "family") return `${a.name} and ${b.name} talked about household stability.`;
  if (classification === "secretive") return `${a.name} and ${b.name} exchanged information that may spread through trust.`;
  return `${a.name} and ${b.name} maintained an ordinary social tie.`;
}

function createConversationPlan(sim: SimulationState, a: Citizen, b: Citizen, context: ConversationContext, stage: RelationshipStage, rand: () => number): ConversationPlan {
  const topics = possibleTopics(sim, a, b, context, stage);
  const topic = topics.length ? topics[Math.floor(rand() * topics.length)] : "daily life";
  const aText = conversationLine(sim, a, b, topic, stage, rand);
  const bText = conversationLine(sim, b, a, topic, stage, rand);
  const classified = brainClassifyConversation(topic, a, b);
  const classification = topic === "daily life" && (stage === "stranger" || stage === "acquaintance")
    ? "casual"
    : classified.classification;
  const classificationReason = topic === "daily life" && (stage === "stranger" || stage === "acquaintance")
    ? "They are still building basic familiarity, so the exchange stays light."
    : classified.reason;
  const location = conversationLocation(a, b);
  const importance = conversationImportance(topic, classification, a, b);
  const tags = evidenceTags(topic, classification, context, a, b, location);
  const relationshipDelta = topic === "personal problem" || topic === "future plans" ? 4 : topic === "rumor" || topic === "people gossip" ? 3 : 2;

  return {
    topic,
    classification,
    classificationReason,
    relationshipStage: stage,
    aText,
    bText,
    location,
    contextZone: context.zone,
    evidenceSummary: evidenceSummary(topic, classification, context, a, b),
    evidenceTags: tags,
    importance,
    relationshipDelta,
    shouldLogWorldDecision: classification === "secretive"
      || (sim.day >= 2 && classification === "planning" && topic === "future plans"),
    shouldWriteMemory: importance !== "low",
  };
}

function addConversationEntry(sim: SimulationState, speaker: Citizen, listener: Citizen, plan: ConversationPlan, text: string) {
  speaker.recentConversations.unshift({
    id: `${speaker.id}-${listener.id}-${sim.day}-${Math.round(sim.minute)}-${speaker.recentConversations.length}`,
    day: sim.day,
    time: formatTime(sim.minute),
    speakerId: speaker.id,
    speakerName: speaker.name,
    withId: listener.id,
    withName: listener.name,
    topic: plan.topic,
    classification: plan.classification,
    classificationReason: plan.classificationReason,
    contextZone: plan.contextZone,
    relationshipStage: plan.relationshipStage,
    importance: plan.importance,
    evidenceSummary: plan.evidenceSummary,
    evidenceTags: plan.evidenceTags,
    text,
  });
  speaker.recentConversations = speaker.recentConversations.slice(0, 10);
}

function addGlobalConversation(sim: SimulationState, a: Citizen, b: Citizen, plan: ConversationPlan, text: string) {
  sim.conversationLog.unshift({
    id: `${sim.day}-${Math.round(sim.minute)}-${a.id}-${b.id}-${sim.conversationLog.length}`,
    day: sim.day,
    time: formatTime(sim.minute),
    speakerId: a.id,
    speakerName: a.name,
    withId: b.id,
    withName: b.name,
    topic: plan.topic,
    classification: plan.classification,
    classificationReason: plan.classificationReason,
    contextZone: plan.contextZone,
    relationshipStage: plan.relationshipStage,
    importance: plan.importance,
    evidenceSummary: plan.evidenceSummary,
    evidenceTags: plan.evidenceTags,
    locationId: plan.location.building.id,
    locationName: plan.location.building.name,
    locationSlotId: plan.location.slot.id,
    locationSlotName: plan.location.slot.name,
    text,
  });
  sim.conversationLog = sim.conversationLog.slice(0, 240);
}

export function knows(citizen: Citizen, fact: string) {
  return citizen.knownFacts.includes(fact);
}

export function learn(citizen: Citizen, fact: string) {
  if (!knows(citizen, fact)) citizen.knownFacts.push(fact);
}

export function maybeTalk(sim: SimulationState, a: Citizen, b: Citizen, tick: number, addMemory: AddMemory) {
  if (a.conversationUntil > tick || b.conversationUntil > tick) return;
  if ((a.lastTalkedAt[b.id] || 0) + 95 > tick) return;

  const relationship = a.relationships[b.id];
  const context = conversationContext(a, b);
  if (!context) return;
  const stage = relationshipStage(a, b);
  const socialMood = a.currentIntention === "socialize" || b.currentIntention === "socialize";
  const householdTalk = context.zone === "home" ? 1.7 : 1;
  const introductionBoost = stage === "stranger" ? 0.012 : stage === "acquaintance" ? 0.008 : 0;
  const chance = introductionBoost + ((relationship.familiarity + relationship.friendship + relationship.trust - relationship.dislike) / 5200)
    * a.routine.sociability
    * b.routine.sociability
    * context.multiplier
    * householdTalk
    * (socialMood ? 1.5 : 1);
  const rand = conversationRand(sim, a, b, tick);
  if (rand() > chance) return;

  const reverse = b.relationships[a.id];
  const plan = createConversationPlan(sim, a, b, context, stage, rand);
  const delta = plan.relationshipDelta;

  relationship.familiarity = clamp(relationship.familiarity + delta, 0, 100);
  relationship.friendship = clamp(relationship.friendship + delta * 0.6 - relationship.dislike * 0.02, 0, 100);
  relationship.trust = clamp(relationship.trust + delta * 0.35, 0, 100);
  reverse.familiarity = clamp(reverse.familiarity + delta, 0, 100);
  reverse.friendship = clamp(reverse.friendship + delta * 0.5 - reverse.dislike * 0.02, 0, 100);
  reverse.trust = clamp(reverse.trust + delta * 0.35, 0, 100);
  relationship.interactions += 1;
  reverse.interactions += 1;
  relationship.firstMetDay = relationship.firstMetDay ?? sim.day;
  reverse.firstMetDay = reverse.firstMetDay ?? sim.day;
  relationship.lastInteractionDay = sim.day;
  reverse.lastInteractionDay = sim.day;

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
  addConversationEntry(sim, a, b, plan, plan.aText);
  addConversationEntry(sim, b, a, plan, plan.bText);
  addGlobalConversation(sim, a, b, plan, `${plan.aText} ${plan.bText}`);
  if (plan.shouldLogWorldDecision) {
    addWorldDecision(sim, {
      category: "social",
      status: "automatic",
      impact: "low",
      title: `${a.name} and ${b.name} had a ${plan.classification} conversation`,
      summary: plan.evidenceSummary,
      actorId: a.id,
      actorName: a.name,
      householdId: a.householdId === b.householdId ? a.householdId : undefined,
      relatedCitizenIds: [a.id, b.id],
      relatedBuildingId: plan.location.building.id,
      requiresApproval: false,
      reason: plan.classificationReason,
      effect: "The conversation can shape memories, trust, goals, or civic awareness later.",
    });
  }
  a.currentThought = `I keep thinking about what ${b.name} said.`;
  b.currentThought = `I keep thinking about what ${a.name} said.`;
  a.currentEmotion = emotionAfterConversation(plan.topic);
  b.currentEmotion = emotionAfterConversation(plan.topic);

  const aCanTell = knows(a, FACTORY_RUMOR) && !knows(b, FACTORY_RUMOR) && plan.topic === "rumor" && relationship.trust > 28;
  const bCanTell = knows(b, FACTORY_RUMOR) && !knows(a, FACTORY_RUMOR) && plan.topic === "rumor" && reverse.trust > 28;
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
  } else if (plan.shouldWriteMemory) {
    addMemory(sim, a, `Talked with ${b.name} about ${plan.topic}. ${plan.evidenceSummary}`);
    addMemory(sim, b, `Talked with ${a.name} about ${plan.topic}. ${plan.evidenceSummary}`);
    addLifeJournal(sim, a, plan.bText.replace(b.name, `I heard ${b.name}`));
    addLifeJournal(sim, b, plan.aText.replace(a.name, `I heard ${a.name}`));
  }
}
