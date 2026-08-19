import type { Building, PlaceSlot, PlaceSlotKind } from "../types/simulation";

export const FACTORY_RUMOR = "factory_layoffs_may_happen";

export const WALK_PIXELS_PER_SIM_MINUTE = 12;

export const BUILDINGS: Building[] = [
  { id: "home_01", name: "Maple House", kind: "home", x: 145, y: 118, width: 116, height: 92, color: "#c78452" },
  { id: "home_02", name: "Oak Duplex", kind: "home", x: 292, y: 116, width: 116, height: 92, color: "#bd6f5c" },
  { id: "home_03", name: "Cedar Walk", kind: "home", x: 96, y: 428, width: 116, height: 92, color: "#c78452" },
  { id: "home_04", name: "Pine Court", kind: "home", x: 265, y: 468, width: 116, height: 92, color: "#bd6f5c" },
  { id: "home_05", name: "Juniper Flats", kind: "home", x: 96, y: 706, width: 116, height: 92, color: "#c78452" },
  { id: "home_06", name: "Willow House", kind: "home", x: 292, y: 732, width: 116, height: 92, color: "#bd6f5c" },
  { id: "home_07", name: "Birch Place", kind: "home", x: 1000, y: 90, width: 116, height: 92, color: "#c78452" },
  { id: "home_08", name: "Rowan House", kind: "home", x: 1185, y: 118, width: 116, height: 92, color: "#bd6f5c" },
  { id: "home_09", name: "Elm Terrace", kind: "home", x: 1025, y: 690, width: 116, height: 92, color: "#c78452" },
  { id: "home_10", name: "Ash Lane", kind: "home", x: 1195, y: 730, width: 116, height: 92, color: "#bd6f5c" },
  { id: "factory", name: "Northbridge Works", kind: "factory", x: 690, y: 120, width: 220, height: 120, color: "#7f8b96" },
  { id: "market", name: "Corner Market", kind: "market", x: 475, y: 350, width: 180, height: 100, color: "#4f9b75" },
  { id: "office", name: "Civic Data", kind: "office", x: 725, y: 505, width: 170, height: 100, color: "#5d80b8" },
  { id: "clinic", name: "Clinic", kind: "clinic", x: 920, y: 505, width: 92, height: 100, color: "#c46262" },
  { id: "school", name: "Northbridge School", kind: "school", x: 1040, y: 430, width: 210, height: 110, color: "#b68b4f" },
];

const homeSlotPlan: Array<{ kind: PlaceSlotKind; name: string; x: number; y: number; radius: number }> = [
  { kind: "living", name: "living room", x: 0.5, y: 0.55, radius: 18 },
  { kind: "kitchen", name: "kitchen", x: 0.28, y: 0.42, radius: 14 },
  { kind: "bedroom", name: "bedroom", x: 0.72, y: 0.34, radius: 14 },
  { kind: "yard", name: "front yard", x: 0.5, y: 1.12, radius: 20 },
];

const slotPlans: Record<Building["kind"], Array<{ kind: PlaceSlotKind; name: string; x: number; y: number; radius: number }>> = {
  home: homeSlotPlan,
  factory: [
    { kind: "work", name: "factory floor", x: 0.42, y: 0.62, radius: 30 },
    { kind: "break", name: "break area", x: 0.74, y: 0.42, radius: 18 },
    { kind: "entry", name: "loading entrance", x: 0.15, y: 0.85, radius: 18 },
  ],
  market: [
    { kind: "counter", name: "front counter", x: 0.38, y: 0.68, radius: 16 },
    { kind: "aisle", name: "shop aisle", x: 0.66, y: 0.5, radius: 22 },
    { kind: "entry", name: "market entrance", x: 0.5, y: 1.1, radius: 18 },
  ],
  office: [
    { kind: "work", name: "desk area", x: 0.45, y: 0.6, radius: 24 },
    { kind: "break", name: "coffee corner", x: 0.72, y: 0.42, radius: 15 },
    { kind: "entry", name: "office lobby", x: 0.25, y: 0.84, radius: 17 },
  ],
  clinic: [
    { kind: "waiting", name: "waiting room", x: 0.46, y: 0.68, radius: 18 },
    { kind: "exam", name: "exam room", x: 0.66, y: 0.38, radius: 14 },
    { kind: "entry", name: "clinic entrance", x: 0.5, y: 1.1, radius: 14 },
  ],
  school: [
    { kind: "classroom", name: "classroom", x: 0.35, y: 0.58, radius: 26 },
    { kind: "hallway", name: "hallway", x: 0.6, y: 0.55, radius: 20 },
    { kind: "office", name: "school office", x: 0.78, y: 0.42, radius: 16 },
    { kind: "yard", name: "school yard", x: 0.5, y: 1.18, radius: 28 },
  ],
};

export const PLACE_SLOTS: PlaceSlot[] = BUILDINGS.flatMap((building) => (
  slotPlans[building.kind].map((slot) => ({
    id: `${building.id}_${slot.kind}`,
    buildingId: building.id,
    name: slot.name,
    kind: slot.kind,
    x: Math.round(building.x + building.width * slot.x),
    y: Math.round(building.y + building.height * slot.y),
    radius: slot.radius,
  }))
));
