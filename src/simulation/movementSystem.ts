import type { Building, Citizen, CitizenIntention, PlaceSlot, RoutePoint } from "../types/simulation";
import { BUILDINGS, PLACE_SLOTS, WALK_PIXELS_PER_SIM_MINUTE } from "./constants";

const TOWN_ROUTE_SPINE_Y = 322;
const TOWN_ROUTE_SPINE_X = 456;
const ROUTE_EPSILON = 6;
const ROUTE_LANES: RoutePoint[] = [
  { x: -18, y: -10 },
  { x: -9, y: 8 },
  { x: 0, y: -14 },
  { x: 10, y: 10 },
  { x: 18, y: -4 },
  { x: -22, y: 14 },
  { x: 22, y: 14 },
];

const BUILDING_ROUTE_ANCHORS: Record<string, RoutePoint> = {
  home_01: { x: 202, y: 264 },
  home_02: { x: 350, y: 264 },
  home_03: { x: 154, y: 380 },
  home_04: { x: 323, y: 380 },
  home_05: { x: 154, y: 620 },
  home_06: { x: 350, y: 620 },
  home_07: { x: 1058, y: 264 },
  home_08: { x: 1243, y: 264 },
  home_09: { x: 1083, y: 620 },
  home_10: { x: 1253, y: 620 },
  factory: { x: 800, y: 264 },
  market: { x: 565, y: 380 },
  office: { x: 810, y: 380 },
  clinic: { x: 966, y: 380 },
  school: { x: 1145, y: 380 },
};

export function buildingById(id: string): Building {
  const building = BUILDINGS.find((item) => item.id === id);
  if (!building) throw new Error(`Unknown building: ${id}`);
  return building;
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

export function homeStartSlot(homeId: string) {
  return slotForKind(homeId, ["living", "kitchen"]);
}

function citizenNumber(citizen: Citizen) {
  return Number(citizen.id.split("_")[1]) || 0;
}

function routeLaneFor(citizen: Citizen) {
  return ROUTE_LANES[citizenNumber(citizen) % ROUTE_LANES.length];
}

function routeAnchorFor(buildingId: string, citizen: Citizen) {
  const anchor = BUILDING_ROUTE_ANCHORS[buildingId] ?? centerOf(buildingId);
  const lane = routeLaneFor(citizen);
  return {
    x: anchor.x + lane.x,
    y: anchor.y + lane.y,
  };
}

function addRoutePoint(route: RoutePoint[], point: RoutePoint) {
  const previous = route[route.length - 1];
  if (!previous || Math.hypot(previous.x - point.x, previous.y - point.y) > ROUTE_EPSILON) {
    route.push({ x: Math.round(point.x), y: Math.round(point.y) });
  }
}

function routeToSpine(anchor: RoutePoint, citizen: Citizen) {
  const lane = routeLaneFor(citizen);
  const spineY = TOWN_ROUTE_SPINE_Y + lane.y * 0.45;
  const spineX = TOWN_ROUTE_SPINE_X + lane.x * 0.25;
  const route: RoutePoint[] = [];
  addRoutePoint(route, anchor);
  addRoutePoint(route, { x: anchor.x, y: spineY });
  addRoutePoint(route, { x: spineX, y: spineY });
  return route;
}

function routeFromSpine(anchor: RoutePoint, citizen: Citizen) {
  const lane = routeLaneFor(citizen);
  const spineY = TOWN_ROUTE_SPINE_Y + lane.y * 0.45;
  const spineX = TOWN_ROUTE_SPINE_X + lane.x * 0.25;
  const route: RoutePoint[] = [];
  addRoutePoint(route, { x: spineX, y: spineY });
  addRoutePoint(route, { x: anchor.x, y: spineY });
  addRoutePoint(route, anchor);
  return route;
}

function destinationStop(slot: PlaceSlot, citizen: Citizen, rand: () => number) {
  const index = citizenNumber(citizen);
  const angle = (index * 137.5 * Math.PI) / 180;
  const ring = 0.32 + (index % 5) * 0.16;
  const stableSpread = Math.max(8, slot.radius * Math.min(1.05, ring));
  const jitter = Math.max(2, slot.radius * 0.18);
  return {
    x: slot.x + Math.cos(angle) * stableSpread + (rand() - 0.5) * jitter,
    y: slot.y + Math.sin(angle) * stableSpread + (rand() - 0.5) * jitter,
  };
}

function buildRoute(citizen: Citizen, destinationId: string, target: RoutePoint) {
  const route: RoutePoint[] = [];

  addRoutePoint(route, { x: citizen.x, y: citizen.y });
  if (citizen.destinationId === destinationId) {
    addRoutePoint(route, target);
    return route.slice(1);
  }

  const startAnchor = routeAnchorFor(citizen.destinationId, citizen);
  const endAnchor = routeAnchorFor(destinationId, citizen);
  if (Math.hypot(citizen.x - startAnchor.x, citizen.y - startAnchor.y) > 28) {
    addRoutePoint(route, startAnchor);
  }

  if (Math.hypot(startAnchor.x - endAnchor.x, startAnchor.y - endAnchor.y) > 34) {
    for (const point of routeToSpine(startAnchor, citizen)) addRoutePoint(route, point);
    for (const point of routeFromSpine(endAnchor, citizen)) addRoutePoint(route, point);
  } else {
    addRoutePoint(route, endAnchor);
  }

  addRoutePoint(route, target);
  return route.slice(1);
}

export function setDestination(citizen: Citizen, destinationId: string, rand: () => number, intention: CitizenIntention = citizen.currentIntention) {
  const slot = chooseDestinationSlot(citizen, destinationId, intention, rand);
  if (citizen.destinationId === destinationId && Math.hypot(citizen.targetX - citizen.x, citizen.targetY - citizen.y) > 7) {
    return;
  }
  const target = destinationStop(slot, citizen, rand);
  citizen.route = buildRoute(citizen, destinationId, target);
  citizen.destinationId = destinationId;
  citizen.destinationSlotId = slot.id;
  citizen.targetX = target.x;
  citizen.targetY = target.y;
}

export function moveCitizen(citizen: Citizen, simMinutes: number) {
  let remainingStep = simMinutes * WALK_PIXELS_PER_SIM_MINUTE * citizen.routine.walkingSpeed;

  while (remainingStep > 0.01) {
    const waypoint = citizen.route[0] ?? { x: citizen.targetX, y: citizen.targetY };
    const dx = waypoint.x - citizen.x;
    const dy = waypoint.y - citizen.y;
    const distance = Math.hypot(dx, dy);

    if (distance < 1) {
      citizen.x = waypoint.x;
      citizen.y = waypoint.y;
      if (citizen.route.length > 0) {
        citizen.route.shift();
        if (citizen.route.length === 0) {
          citizen.currentSlotId = citizen.destinationSlotId;
        }
        continue;
      }
      citizen.currentSlotId = citizen.destinationSlotId;
      break;
    }

    const step = Math.min(distance, remainingStep);
    citizen.x += (dx / distance) * step;
    citizen.y += (dy / distance) * step;
    remainingStep -= step;

    if (distance <= step + 1) {
      citizen.x = waypoint.x;
      citizen.y = waypoint.y;
      if (citizen.route.length > 0) {
        citizen.route.shift();
        if (citizen.route.length === 0) {
          citizen.currentSlotId = citizen.destinationSlotId;
        }
      } else {
        citizen.currentSlotId = citizen.destinationSlotId;
        break;
      }
    }
  }
}

export function isAtDestination(citizen: Citizen) {
  return Math.hypot(citizen.targetX - citizen.x, citizen.targetY - citizen.y) < 22;
}

export function buildingContains(citizen: Citizen, building: Building, padding = 20) {
  return (
    citizen.x >= building.x - padding
    && citizen.x <= building.x + building.width + padding
    && citizen.y >= building.y - padding
    && citizen.y <= building.y + building.height + padding
  );
}
