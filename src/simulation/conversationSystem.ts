import type {
  Citizen,
  ConversationClassification,
  ConversationDialogueLine,
  ConversationImportance,
  ConversationIntent,
  ConversationScope,
  ConversationTone,
  ConversationTopic,
  RelationshipStage,
  SimulationState,
} from "../types/simulation";
import {
  hasDiscoveredMoneyPressure,
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
  dialogue: ConversationDialogueLine[];
  location: ConversationLocation;
  contextZone: ConversationContext["zone"];
  evidenceSummary: string;
  evidenceTags: string[];
  importance: ConversationImportance;
  intent: ConversationIntent;
  scope: ConversationScope;
  tone: ConversationTone;
  aiUsefulness: ConversationImportance;
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

function conversationIntent(topic: ConversationTopic, stage: RelationshipStage, relationshipInteractions: number): ConversationIntent {
  if (topic === "future plans") return "planning";
  if (topic === "personal problem" || topic === "money stress") return "disclosure";
  if (topic === "workplace gossip" || topic === "people gossip" || topic === "rumor") return "complaint";
  if (topic === "school" && stage === "authority") return "advice";
  if (relationshipInteractions >= 2) return "follow-up";
  if (stage === "stranger") return "greeting";
  return "check-in";
}

function conversationScope(topic: ConversationTopic, context: ConversationContext, location: ConversationLocation, a: Citizen, b: Citizen): ConversationScope {
  if (topic === "money stress" || topic === "personal problem" || topic === "future plans") return "personal";
  if (topic === "family" || a.householdId === b.householdId) return "household";
  if (topic === "school" || location.building.kind === "school" || context.zone === "school") return "school";
  if (topic === "workplace gossip" || context.zone === "work" || location.building.kind === "factory" || location.building.kind === "office") return "workplace";
  if (topic === "rumor" || topic === "people gossip") return "town";
  return "relationship";
}

function conversationTone(topic: ConversationTopic, classification: ConversationClassification, a: Citizen, b: Citizen): ConversationTone {
  if (topic === "money stress" || topic === "personal problem" || classification === "supportive") return "worried";
  if (topic === "future plans" || classification === "planning") return "hopeful";
  if (a.currentEmotion === "tired" || b.currentEmotion === "tired" || a.needs.rest > 78 || b.needs.rest > 78) return "tired";
  if (classification === "casual" && (a.currentEmotion === "happy" || b.currentEmotion === "happy" || a.currentEmotion === "connected" || b.currentEmotion === "connected")) return "warm";
  return "neutral";
}

function conversationAiUsefulness(importance: ConversationImportance, intent: ConversationIntent, scope: ConversationScope, relationshipInteractions: number): ConversationImportance {
  if (importance === "high" || intent === "disclosure" || intent === "planning") return "high";
  if (importance === "medium" || intent === "complaint" || scope === "town" || relationshipInteractions >= 5) return "medium";
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
  if (relationship.interactions >= 14 && relationship.trust >= 72 && relationship.friendship >= 64) return "close";
  if (relationship.interactions >= 7 && score >= 62) return "friend";
  if (relationship.interactions >= 3 && score >= 42) return "familiar";
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

function sharedInteractions(a: Citizen, b: Citizen) {
  return Math.min(a.relationships[b.id]?.interactions ?? 0, b.relationships[a.id]?.interactions ?? 0);
}

function socialWarmupActive(sim: SimulationState, stage: RelationshipStage, context: ConversationContext, a: Citizen, b: Citizen) {
  if (stage === "family" && context.zone === "home") return false;
  if (sim.day <= 1 && sim.minute < 13 * 60) return true;
  return sharedInteractions(a, b) < 2 && stage !== "family" && stage !== "authority";
}

function canShareDeeperTopic(sim: SimulationState, stage: RelationshipStage, context: ConversationContext, a: Citizen, b: Citizen, minimumInteractions: number) {
  if (a.lifeStage === "child" || b.lifeStage === "child") return false;
  if (socialWarmupActive(sim, stage, context, a, b)) return false;
  if (sim.day < 2) return false;
  if (stage === "family" || stage === "close") return true;
  if (stage === "friend") return sharedInteractions(a, b) >= minimumInteractions;
  if (stage === "familiar") return sharedInteractions(a, b) >= minimumInteractions + 1;
  return false;
}

function possibleTopics(sim: SimulationState, a: Citizen, b: Citizen, context: ConversationContext, stage: RelationshipStage) {
  const aHousehold = sim.households.find((household) => household.id === a.householdId);
  const bHousehold = sim.households.find((household) => household.id === b.householdId);
  const moneyDiscovered = hasDiscoveredMoneyPressure(sim, a, aHousehold) || hasDiscoveredMoneyPressure(sim, b, bHousehold);
  const options: ConversationTopic[] = ["daily life"];
  const warmup = socialWarmupActive(sim, stage, context, a, b);
  if (sim.day >= 2 && a.workplaceId && a.workplaceId === b.workplaceId && !warmup && sharedInteractions(a, b) >= 3) options.push("workplace gossip");
  if ((a.problems.length || b.problems.length) && canShareDeeperTopic(sim, stage, context, a, b, 4)) options.push("personal problem");
  if (
    moneyDiscovered
    && canShareDeeperTopic(sim, stage, context, a, b, 5)
    && (a.cash < 180 || b.cash < 180 || a.problems.some((problem) => problem.toLowerCase().includes("money")) || b.problems.some((problem) => problem.toLowerCase().includes("money")))
  ) options.push("money stress");
  if (a.householdId === b.householdId || a.familyRole === "parent" || b.familyRole === "parent") options.push("family");
  if (a.schoolClass || b.schoolClass || a.workplaceId === "school" || b.workplaceId === "school") options.push("school");
  if ((a.goalFocus || b.goalFocus) && canShareDeeperTopic(sim, stage, context, a, b, 3)) options.push("future plans");
  if (sim.day >= 2 && !warmup && (a.knownFacts.includes(FACTORY_RUMOR) || b.knownFacts.includes(FACTORY_RUMOR))) options.push("rumor");
  if (sim.day >= 2 && !warmup && sim.citizens.length > 3) options.push("people gossip");
  return options.filter((topic, index, topics) => (
    topics.indexOf(topic) === index && canDiscussTopic(topic, stage, context, a, b)
  ));
}

function pickConversationTopic(sim: SimulationState, topics: ConversationTopic[], stage: RelationshipStage, context: ConversationContext, a: Citizen, b: Citizen, rand: () => number) {
  if (!topics.length) return "daily life";
  if (topics.includes("daily life")) {
    const ordinaryBias = socialWarmupActive(sim, stage, context, a, b)
      ? 0.9
      : sim.day <= 1
        ? 0.72
        : stage === "family" || stage === "close"
          ? 0.42
          : 0.56;
    if (rand() < ordinaryBias) return "daily life";
  }
  return topics[Math.floor(rand() * topics.length)];
}

function isGuardianChildTalk(speaker: Citizen, listener: Citizen) {
  return speaker.householdId === listener.householdId
    && (
      (speaker.familyRole === "parent" && listener.lifeStage === "child")
      || (listener.familyRole === "parent" && speaker.lifeStage === "child")
    );
}

function contextLabel(sim: SimulationState, context: ConversationContext, location: ConversationLocation) {
  if (sim.minute < 11 * 60) return "morning check-in";
  if (location.building.kind === "market") return "errand talk";
  if (location.building.kind === "clinic") return "clinic check-in";
  if (location.building.kind === "school") return "school check-in";
  if (location.building.kind === "factory" || location.building.kind === "office") return "work check-in";
  if (context.zone === "home") return "home check-in";
  if (context.zone === "street") return "street greeting";
  return "daily check-in";
}

function addPlaceSpecificLines(lines: string[], speaker: Citizen, listener: Citizen, location: ConversationLocation) {
  const place = location.building.name;
  const slot = location.slot.name;
  if (location.building.kind === "home") {
    if (location.slot.kind === "kitchen") {
      lines.push(
        `${speaker.name} asked ${listener.name} if there was anything quick to eat in the kitchen.`,
        `${speaker.name} and ${listener.name} talked about breakfast while passing through the kitchen.`,
      );
    } else if (location.slot.kind === "bedroom") {
      lines.push(`${speaker.name} asked ${listener.name} if they had slept okay.`);
    } else if (location.slot.kind === "yard") {
      lines.push(`${speaker.name} and ${listener.name} talked for a moment outside ${place}.`);
    } else {
      lines.push(`${speaker.name} checked in with ${listener.name} around the ${slot}.`);
    }
  }

  if (location.building.kind === "school") {
    if (speaker.institutionRole === "principal" || speaker.institutionRole === "teacher") {
      lines.push(`${speaker.name} asked ${listener.name} how class was going today.`);
    } else if (listener.institutionRole === "principal" || listener.institutionRole === "teacher") {
      lines.push(`${speaker.name} asked ${listener.name} what they should focus on at school today.`);
    } else {
      lines.push(`${speaker.name} and ${listener.name} talked about class and the school day.`);
    }
  }

  if (location.building.kind === "market") {
    lines.push(
      `${speaker.name} asked ${listener.name} what they were picking up at ${place}.`,
      `${speaker.name} and ${listener.name} talked about what looked useful in the ${slot}.`,
    );
    if (speaker.needs.hunger > 62 || listener.needs.hunger > 62) {
      lines.push(`${speaker.name} mentioned that food sounded good while they were at ${place}.`);
    }
  }

  if (location.building.kind === "clinic") {
    lines.push(
      `${speaker.name} asked ${listener.name} if they had been waiting long at the clinic.`,
      `${speaker.name} and ${listener.name} kept the conversation quiet in the ${slot}.`,
    );
    if (speaker.needs.rest > 72 || listener.needs.rest > 72) {
      lines.push(`${speaker.name} asked ${listener.name} if they were feeling worn out too.`);
    }
  }

  if (location.building.kind === "factory" || location.building.kind === "office") {
    lines.push(
      `${speaker.name} asked ${listener.name} how the shift was going at ${place}.`,
      `${speaker.name} and ${listener.name} traded a quick check-in near the ${slot}.`,
    );
    if (location.slot.kind === "break") {
      lines.push(`${speaker.name} asked ${listener.name} if they had time for a real break.`);
    }
  }
}

function dailyLifeLine(sim: SimulationState, speaker: Citizen, listener: Citizen, context: ConversationContext, location: ConversationLocation, rand: () => number) {
  const prior = speaker.relationships[listener.id];
  const morning = sim.minute < 11 * 60;
  const midday = sim.minute >= 11 * 60 && sim.minute < 15 * 60;
  const evening = sim.minute >= 17 * 60;
  const weather = sim.weather.kind === "clear"
    ? "nice out"
    : sim.weather.kind === "rain"
      ? "rainy out"
      : `${sim.weather.kind} today`;
  const lines = [
    `${speaker.name} asked ${listener.name} how their day was going.`,
    `${speaker.name} checked in with ${listener.name} for a moment.`,
    `${speaker.name} and ${listener.name} talked about the ${weather} weather.`,
  ];
  addPlaceSpecificLines(lines, speaker, listener, location);
  if (isGuardianChildTalk(speaker, listener)) {
    if (speaker.familyRole === "parent") {
      lines.push(
        `${speaker.name} asked ${listener.name} if they had everything they needed today.`,
        `${speaker.name} reminded ${listener.name} to take the day one step at a time.`,
      );
    } else {
      lines.push(`${speaker.name} told ${listener.name} how the morning was going so far.`);
    }
  } else if (speaker.lifeStage === "child" || listener.lifeStage === "child") {
    lines.push(`${speaker.name} and ${listener.name} kept the conversation simple and light.`);
  }
  if (prior?.lastTopic && prior.interactions >= 2 && rand() < 0.45) {
    if (prior.lastConversationSummary && prior.lastTopic !== "daily life") {
      lines.push(`${speaker.name} remembered their last talk with ${listener.name} and checked whether anything had changed.`);
    }
    if (prior.lastTopic === "daily life") lines.push(`${speaker.name} followed up with ${listener.name} after their last everyday check-in.`);
    if (prior.lastTopic === "school") lines.push(`${speaker.name} asked ${listener.name} how school had gone since they last talked.`);
    if (prior.lastTopic === "family") lines.push(`${speaker.name} asked ${listener.name} if things at home were still okay.`);
    if (prior.lastTopic === "workplace gossip") lines.push(`${speaker.name} asked ${listener.name} whether work had settled down since their last chat.`);
    if (prior.lastTopic === "future plans") lines.push(`${speaker.name} asked ${listener.name} whether they were still thinking about that future plan.`);
    if (prior.lastTopic === "personal problem") lines.push(`${speaker.name} gently checked whether ${listener.name} was doing any better.`);
    if (prior.lastTopic === "money stress") lines.push(`${speaker.name} quietly asked ${listener.name} if things felt any easier today.`);
    if (prior.lastTopic === "rumor" || prior.lastTopic === "people gossip") lines.push(`${speaker.name} asked ${listener.name} if they had heard anything new.`);
  }
  if (morning) {
    lines.push(
      `${speaker.name} asked ${listener.name} if they had eaten breakfast yet.`,
      `${speaker.name} asked ${listener.name} what they had planned for the morning.`,
      `${speaker.name} and ${listener.name} talked about getting started for the day.`,
    );
  }
  if (midday) {
    lines.push(
      `${speaker.name} asked ${listener.name} if lunch sounded good soon.`,
      `${speaker.name} and ${listener.name} traded a quick midday check-in.`,
    );
  }
  if (evening) {
    lines.push(
      `${speaker.name} asked ${listener.name} how the day had been.`,
      `${speaker.name} and ${listener.name} talked about heading home and winding down.`,
    );
  }
  if (context.zone === "work") lines.push(`${speaker.name} asked ${listener.name} how work was going so far.`);
  if (context.zone === "school") lines.push(`${speaker.name} asked ${listener.name} how school was going today.`);
  if (context.zone === "home") lines.push(`${speaker.name} checked whether ${listener.name} needed anything at home.`);
  return lines[Math.floor(rand() * lines.length)];
}

function conversationLine(sim: SimulationState, speaker: Citizen, listener: Citizen, topic: ConversationTopic, stage: RelationshipStage, context: ConversationContext, location: ConversationLocation, rand: () => number) {
  if (topic === "daily life" && stage === "stranger") {
    return `${speaker.name} introduced themselves to ${listener.name} near the ${location.slot.name} and kept it light.`;
  }
  if (topic === "daily life" && stage === "acquaintance") {
    return dailyLifeLine(sim, speaker, listener, context, location, rand);
  }
  if (topic === "daily life") return dailyLifeLine(sim, speaker, listener, context, location, rand);
  return brainConversationText(sim, speaker, listener, topic, rand);
}

function firstName(citizen: Citizen) {
  return citizen.name.split(" ")[0];
}

type DialoguePair = {
  opener: string;
  reply: string;
};

function dialoguePairs(sim: SimulationState, speaker: Citizen, listener: Citizen, topic: ConversationTopic, context: ConversationContext, location: ConversationLocation) {
  const listenerFirst = firstName(listener);
  const prior = speaker.relationships[listener.id];
  const place = location.building.name;
  const slot = location.slot.name.toLowerCase();
  const morning = sim.minute < 11 * 60;
  const midday = sim.minute >= 11 * 60 && sim.minute < 15 * 60;
  const evening = sim.minute >= 17 * 60;
  const weather = sim.weather.kind === "rain"
    ? "this rain"
    : sim.weather.kind === "clear"
      ? "the weather"
      : `this ${sim.weather.kind} weather`;

  const pairs: DialoguePair[] = [];

  if (topic === "daily life") {
    pairs.push(
      { opener: `Hey ${listenerFirst}, how's your day going?`, reply: "I'm okay. Just taking the day one step at a time." },
      { opener: `Hi ${listenerFirst}, are you doing okay today?`, reply: "Pretty normal so far. Nothing too strange yet." },
      { opener: `Hey ${listenerFirst}, ${weather} is something today, right?`, reply: "Yeah, it definitely changes the mood around town." },
    );
    if (morning) {
      pairs.push(
        { opener: `Morning, ${listenerFirst}. Did you eat breakfast yet?`, reply: "Not yet. I should probably eat something soon." },
        { opener: `Hey ${listenerFirst}, what are you trying to get done this morning?`, reply: "I want to get through the morning without falling behind." },
      );
    }
    if (midday) pairs.push({ opener: `Hey ${listenerFirst}, are you thinking about lunch soon?`, reply: "Yeah, lunch sounds pretty good right now." });
    if (evening) pairs.push({ opener: `Hey ${listenerFirst}, how did the day treat you?`, reply: "It was a lot, but I'm glad it's slowing down." });
    if (context.zone === "work") pairs.push({ opener: `Hey ${listenerFirst}, how's the shift going?`, reply: "Busy, but manageable. I'm trying to keep pace." });
    if (context.zone === "school") pairs.push({ opener: `Hey ${listenerFirst}, how's school going today?`, reply: "It's okay. I'm trying to pay attention." });
    if (context.zone === "home") pairs.push({ opener: `Hey ${listenerFirst}, do you need anything at home?`, reply: "I think I'm fine. I just wanted to check in." });
    if (location.building.kind === "market") pairs.push({ opener: `Hey ${listenerFirst}, what are you picking up?`, reply: "Just something quick. I got hungry." });
    if (location.building.kind === "clinic") pairs.push({ opener: `Hey ${listenerFirst}, have you been waiting long?`, reply: "A little. I just want to feel better." });
    if (prior?.lastTopic && prior.interactions >= 2 && prior.lastTopic !== "daily life") {
      pairs.push({ opener: `Hey ${listenerFirst}, I remembered what you said last time. Any update?`, reply: "A little. Thanks for asking instead of just moving on." });
    }
  } else if (topic === "school") {
    pairs.push(
      { opener: `How's class going today, ${listenerFirst}?`, reply: "It's going okay. I'm trying to stay focused." },
      { opener: "Are you keeping up with school today?", reply: "Some of it makes sense. Some of it is hard." },
      { opener: "What are you working on in class?", reply: "Mostly the same lesson from earlier. I think I need a little more time with it." },
    );
  } else if (topic === "family") {
    pairs.push(
      { opener: "How is everyone at home doing?", reply: "Mostly okay. I think everyone is just busy." },
      { opener: "Has home felt okay lately?", reply: "It has been alright, but I notice the little things." },
      { opener: "Did anything change around the house today?", reply: "Nothing huge. I just want home to feel steady." },
    );
  } else if (topic === "future plans") {
    pairs.push(
      { opener: "I've been thinking about what I want to work toward next.", reply: "That sounds worth thinking through." },
      { opener: "Do you ever think about what should change for us?", reply: "Maybe. I think we should start small and see what happens." },
      { opener: "I have an idea for later, but I'm still sorting it out.", reply: "I get that. It helps to say it out loud." },
    );
  } else if (topic === "personal problem") {
    pairs.push(
      { opener: "Can I tell you something that's been sitting with me?", reply: "Yeah, I'm listening." },
      { opener: "I've had something on my mind today.", reply: "You can tell me. I won't make it weird." },
      { opener: "I don't want to make it a big thing, but I'm dealing with something.", reply: "That sounds heavy. I'm here for a minute." },
    );
  } else if (topic === "money stress") {
    pairs.push(
      { opener: "I'm starting to worry about money a little.", reply: "Yeah, I understand. It adds up fast." },
      { opener: "Have things felt tight for you too?", reply: "A little. It's hard not to notice." },
      { opener: "I keep thinking about what everything costs.", reply: "Maybe we should pay attention before it gets worse." },
    );
  } else if (topic === "workplace gossip") {
    pairs.push(
      { opener: `Have you noticed anything strange around ${place}?`, reply: "I noticed it too, but I don't know what it means yet." },
      { opener: "Does work feel different to you lately?", reply: "Maybe. I don't want to jump to conclusions." },
      { opener: `Something about the ${slot} felt off today.`, reply: "Let's keep an eye on it." },
    );
  } else if (topic === "people gossip") {
    pairs.push(
      { opener: "Have you noticed people acting different today?", reply: "I noticed that too." },
      { opener: "People seem to be carrying a lot today.", reply: "Maybe we should be careful with what we assume." },
      { opener: "I heard a few people talking earlier.", reply: "I don't know the whole story yet." },
    );
  } else if (topic === "rumor") {
    pairs.push(
      { opener: "I heard something about Northbridge Works, but I'm not sure yet.", reply: "I won't spread it without knowing more." },
      { opener: "Can I trust you with something I heard?", reply: "Yes, but we should be careful with it." },
      { opener: "There might be something going on at the factory.", reply: "Let's see if anyone else confirms it." },
    );
  }

  if (!pairs.length) {
    pairs.push({ opener: `Hey ${listenerFirst}, can we talk for a second?`, reply: "Sure, what's going on?" });
  }

  return pairs;
}

function createDialogue(sim: SimulationState, a: Citizen, b: Citizen, topic: ConversationTopic, context: ConversationContext, location: ConversationLocation, rand: () => number): ConversationDialogueLine[] {
  const pairs = dialoguePairs(sim, a, b, topic, context, location);
  const pair = pairs[Math.floor(rand() * pairs.length)];
  return [
    {
      speakerId: a.id,
      speakerName: a.name,
      text: pair.opener,
    },
    {
      speakerId: b.id,
      speakerName: b.name,
      text: pair.reply,
    },
  ];
}

function evidenceTags(sim: SimulationState, topic: ConversationTopic, classification: ConversationClassification, context: ConversationContext, stage: RelationshipStage, a: Citizen, b: Citizen, location: ConversationLocation) {
  const tags = new Set<string>([topic, classification, context.zone, location.building.kind, `relationship-${stage}`]);
  if (a.householdId === b.householdId) tags.add("same household");
  if (a.workplaceId && a.workplaceId === b.workplaceId) tags.add("same workplace");
  if (a.lifeStage === "child" || b.lifeStage === "child") tags.add("child present");
  if (a.problems.length || b.problems.length) tags.add("active problem");
  if (stage === "stranger" || stage === "acquaintance") tags.add("early relationship");
  if (stage === "friend" || stage === "close" || stage === "family") tags.add("trusted relationship");
  if (topic === "money stress") tags.add("economy");
  if (topic === "school") tags.add("education");
  if (topic === "workplace gossip") tags.add("employment");
  if (topic === "family") tags.add("household");
  if (topic === "daily life") tags.add(contextLabel(sim, context, location));
  return Array.from(tags);
}

function evidenceSummary(sim: SimulationState, topic: ConversationTopic, classification: ConversationClassification, context: ConversationContext, a: Citizen, b: Citizen, location: ConversationLocation) {
  if (topic === "money stress") return `${a.name} and ${b.name} surfaced money pressure during a ${context.zone} conversation.`;
  if (topic === "personal problem") return `${a.name} and ${b.name} shared a personal pressure that may matter later.`;
  if (topic === "future plans") return `${a.name} and ${b.name} talked about something they may want to do later.`;
  if (topic === "workplace gossip") return `${a.name} and ${b.name} checked in about the workday.`;
  if (topic === "school") return `${a.name} and ${b.name} checked in about school.`;
  if (topic === "family") return `${a.name} and ${b.name} checked in about home life.`;
  if (classification === "secretive") return `${a.name} and ${b.name} exchanged information that may spread through trust.`;
  return `${a.name} and ${b.name} had a ${contextLabel(sim, context, location)} near the ${location.slot.name}.`;
}

function createConversationPlan(sim: SimulationState, a: Citizen, b: Citizen, context: ConversationContext, stage: RelationshipStage, rand: () => number): ConversationPlan {
  const topics = possibleTopics(sim, a, b, context, stage);
  const topic = pickConversationTopic(sim, topics, stage, context, a, b, rand);
  const location = conversationLocation(a, b);
  const aText = conversationLine(sim, a, b, topic, stage, context, location, rand);
  const bText = conversationLine(sim, b, a, topic, stage, context, location, rand);
  const dialogue = createDialogue(sim, a, b, topic, context, location, rand);
  const classified = brainClassifyConversation(topic, a, b);
  const classification = topic === "daily life" || (topic === "family" && sim.day <= 1 && context.zone === "home")
    ? "casual"
    : classified.classification;
  const classificationReason = classification === "casual"
    ? "They are still building ordinary familiarity, so the exchange stays light."
    : classified.reason;
  const importance = conversationImportance(topic, classification, a, b);
  const interactionCount = sharedInteractions(a, b);
  const intent = conversationIntent(topic, stage, interactionCount);
  const scope = conversationScope(topic, context, location, a, b);
  const tone = conversationTone(topic, classification, a, b);
  const aiUsefulness = conversationAiUsefulness(importance, intent, scope, interactionCount);
  const tags = Array.from(new Set([
    ...evidenceTags(sim, topic, classification, context, stage, a, b, location),
    intent,
    scope,
    tone,
    `ai-${aiUsefulness}`,
  ]));
  const relationshipDelta = topic === "personal problem" || topic === "future plans" ? 4 : topic === "rumor" || topic === "people gossip" ? 3 : 2;

  return {
    topic,
    classification,
    classificationReason,
    relationshipStage: stage,
    aText,
    bText,
    dialogue,
    location,
    contextZone: context.zone,
    evidenceSummary: evidenceSummary(sim, topic, classification, context, a, b, location),
    evidenceTags: tags,
    importance,
    intent,
    scope,
    tone,
    aiUsefulness,
    relationshipDelta,
    shouldLogWorldDecision: classification === "secretive"
      || (sim.day >= 2 && classification === "planning" && topic === "future plans"),
    shouldWriteMemory: importance !== "low",
  };
}

function addConversationEntry(sim: SimulationState, speaker: Citizen, listener: Citizen, plan: ConversationPlan, text: string) {
  const dialogue = plan.dialogue.filter((line) => line.speakerId === speaker.id || line.speakerId === listener.id);
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
    intent: plan.intent,
    scope: plan.scope,
    tone: plan.tone,
    aiUsefulness: plan.aiUsefulness,
    evidenceSummary: plan.evidenceSummary,
    evidenceTags: plan.evidenceTags,
    dialogue,
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
    intent: plan.intent,
    scope: plan.scope,
    tone: plan.tone,
    aiUsefulness: plan.aiUsefulness,
    evidenceSummary: plan.evidenceSummary,
    evidenceTags: plan.evidenceTags,
    locationId: plan.location.building.id,
    locationName: plan.location.building.name,
    locationSlotId: plan.location.slot.id,
    locationSlotName: plan.location.slot.name,
    dialogue: plan.dialogue,
    text,
  });
  sim.conversationLog = sim.conversationLog.slice(0, 240);
}

function conversationMemoryText(other: Citizen, plan: ConversationPlan, otherText: string) {
  const place = `${plan.location.building.name}${plan.location.slot.name ? `, ${plan.location.slot.name}` : ""}`;
  const stage = plan.relationshipStage === "family" || plan.relationshipStage === "authority"
    ? plan.relationshipStage
    : `${plan.relationshipStage} relationship`;

  if (plan.topic === "personal problem") {
    return `${other.name} trusted me with a personal problem at ${place}. I remember: "${otherText}"`;
  }
  if (plan.topic === "money stress") {
    return `${other.name} talked about money pressure at ${place}. I remember: "${otherText}"`;
  }
  if (plan.topic === "future plans") {
    return `${other.name} shared a future plan at ${place}. I remember: "${otherText}"`;
  }
  if (plan.topic === "rumor" || plan.topic === "people gossip") {
    return `${other.name} shared something sensitive at ${place}. I should be careful with that trust.`;
  }
  return `${other.name} and I had a ${plan.classification} ${plan.topic} conversation at ${place} as a ${stage}.`;
}

function followUpGoalKind(plan: ConversationPlan) {
  if (plan.topic === "money stress") return "money";
  if (plan.topic === "personal problem") return "wellbeing";
  if (plan.topic === "future plans") return "curiosity";
  if (plan.topic === "family") return "family";
  return "friendship";
}

function addConversationFollowUpGoal(sim: SimulationState, citizen: Citizen, other: Citizen, plan: ConversationPlan) {
  if (plan.importance === "low") return;

  const kind = followUpGoalKind(plan);
  const title = plan.topic === "future plans"
    ? `Follow up with ${other.name} about their plans`
    : plan.topic === "money stress"
      ? `Check on ${other.name}'s money pressure`
      : plan.topic === "personal problem"
        ? `Check in on ${other.name}`
        : `Keep building trust with ${other.name}`;
  const existing = citizen.personalGoals.some((goal) => goal.title === title && goal.status === "active");
  if (existing) return;

  citizen.personalGoals.unshift({
    id: `${citizen.id}_${other.id}_${sim.day}_${Math.round(sim.minute)}_${kind}`,
    kind,
    title,
    reason: `${other.name} said something during a ${plan.classification} conversation that may matter later.`,
    priority: plan.importance === "high" ? 78 : 58,
    progress: 0,
    status: "active",
    createdDay: sim.day,
  });
  citizen.personalGoals = citizen.personalGoals.slice(0, 5);
  addLifeJournal(sim, citizen, `I should remember to follow up with ${other.name}.`);
}

function applyConversationConsequences(sim: SimulationState, speaker: Citizen, listener: Citizen, plan: ConversationPlan) {
  if (plan.classification === "supportive" || plan.topic === "personal problem") {
    speaker.needs.belonging = clamp(speaker.needs.belonging - 10, 0, 100);
    speaker.mood = clamp(speaker.mood + 4, 0, 100);
    speaker.social = clamp(speaker.social + 6, 0, 100);
    addConversationFollowUpGoal(sim, listener, speaker, plan);
  }

  if (plan.topic === "money stress") {
    speaker.needs.belonging = clamp(speaker.needs.belonging - 6, 0, 100);
    speaker.currentEmotion = "worried";
    addConversationFollowUpGoal(sim, listener, speaker, plan);
  }

  if (plan.topic === "future plans") {
    speaker.currentEmotion = "hopeful";
    listener.currentEmotion = listener.currentEmotion === "worried" ? "hopeful" : listener.currentEmotion;
    addConversationFollowUpGoal(sim, listener, speaker, plan);
  }

  if (plan.classification === "secretive") {
    speaker.needs.belonging = clamp(speaker.needs.belonging - 4, 0, 100);
    listener.currentEmotion = "curious";
  }
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
  if (plan.classification === "supportive" || plan.topic === "personal problem" || plan.topic === "money stress") {
    relationship.trust = clamp(relationship.trust + 1.5, 0, 100);
    reverse.trust = clamp(reverse.trust + 1.5, 0, 100);
  }
  if (plan.topic === "future plans") {
    relationship.friendship = clamp(relationship.friendship + 1, 0, 100);
    reverse.friendship = clamp(reverse.friendship + 1, 0, 100);
  }
  relationship.interactions += 1;
  reverse.interactions += 1;
  relationship.firstMetDay = relationship.firstMetDay ?? sim.day;
  reverse.firstMetDay = reverse.firstMetDay ?? sim.day;
  relationship.lastInteractionDay = sim.day;
  reverse.lastInteractionDay = sim.day;
  relationship.lastTopic = plan.topic;
  reverse.lastTopic = plan.topic;
  relationship.lastClassification = plan.classification;
  reverse.lastClassification = plan.classification;
  relationship.lastContextZone = plan.contextZone;
  reverse.lastContextZone = plan.contextZone;
  relationship.lastConversationSummary = `${b.name}: ${plan.bText}`;
  reverse.lastConversationSummary = `${a.name}: ${plan.aText}`;

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
  applyConversationConsequences(sim, a, b, plan);
  applyConversationConsequences(sim, b, a, plan);

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
    addMemory(sim, a, conversationMemoryText(b, plan, plan.bText));
    addMemory(sim, b, conversationMemoryText(a, plan, plan.aText));
    addLifeJournal(sim, a, plan.bText.replace(b.name, `I heard ${b.name}`));
    addLifeJournal(sim, b, plan.aText.replace(a.name, `I heard ${a.name}`));
  }
}
