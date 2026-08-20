import type { Citizen, ConversationClassification, ConversationTopic, SimulationState } from "../types/simulation";
import {
  chooseConversationTopic as brainChooseConversationTopic,
  classifyConversation as brainClassifyConversation,
  conversationText as brainConversationText,
  emotionAfterConversation,
} from "./brain";
import { FACTORY_RUMOR } from "./constants";
import { addFeed, addLifeJournal, addWorldDecision } from "./eventLog";
import { buildingById, buildingContains, isAtDestination, placeSlotById } from "./movementSystem";
import { clamp } from "./random";
import { formatTime } from "./time";

export type AddMemory = (sim: SimulationState, citizen: Citizen, text: string) => void;

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
  const shouldLogConversationDecision = classification === "secretive"
    || (sim.day >= 2 && classification === "planning" && topic === "future plans");
  if (shouldLogConversationDecision) {
    addWorldDecision(sim, {
      category: "social",
      status: "automatic",
      impact: "low",
      title: `${a.name} and ${b.name} had a ${classification} conversation`,
      summary: `${a.name} and ${b.name} talked about ${topic}.`,
      actorId: a.id,
      actorName: a.name,
      householdId: a.householdId === b.householdId ? a.householdId : undefined,
      relatedCitizenIds: [a.id, b.id],
      relatedBuildingId: conversationLocation(a, b).building.id,
      requiresApproval: false,
      reason: classificationReason,
      effect: "The conversation can shape memories, trust, goals, or civic awareness later.",
    });
  }
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
