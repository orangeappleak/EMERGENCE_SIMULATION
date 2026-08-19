import type { Building, InteriorLayout, PlaceSlot, PlaceSlotKind } from "../types/simulation";

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

export const INTERIOR_LAYOUTS: Record<Building["kind"], InteriorLayout> = {
  home: {
    id: "home_interior",
    name: "Home interior",
    rooms: [
      { id: "living", name: "Living room", slotKinds: ["living"], x: 8, y: 42, width: 42, height: 32, color: "#d9b08a" },
      { id: "kitchen", name: "Kitchen", slotKinds: ["kitchen"], x: 8, y: 8, width: 42, height: 30, color: "#bfd1b5" },
      { id: "bedroom", name: "Bedroom", slotKinds: ["bedroom"], x: 54, y: 8, width: 38, height: 36, color: "#c9b6d8" },
      { id: "yard", name: "Front yard", slotKinds: ["yard", "entry"], x: 54, y: 48, width: 38, height: 26, color: "#b8caad" },
    ],
    furniture: [
      { id: "home_sofa", kind: "sofa", x: 16, y: 56, width: 20, height: 8, color: "#b54c4c" },
      { id: "home_table", kind: "table", x: 34, y: 52, width: 10, height: 12, color: "#8c5a3a" },
      { id: "home_counter", kind: "counter", x: 12, y: 14, width: 28, height: 7, color: "#e7e2cf" },
      { id: "home_bed", kind: "bed", x: 62, y: 18, width: 20, height: 13, color: "#ce4f4f" },
      { id: "home_plant", kind: "plant", x: 76, y: 57, width: 8, height: 8, color: "#3f8a4f" },
    ],
  },
  factory: {
    id: "factory_interior",
    name: "Factory interior",
    rooms: [
      { id: "floor", name: "Factory floor", slotKinds: ["work"], x: 8, y: 18, width: 52, height: 56, color: "#8b969f" },
      { id: "break", name: "Break area", slotKinds: ["break"], x: 64, y: 18, width: 28, height: 26, color: "#c7baa0" },
      { id: "loading", name: "Loading entrance", slotKinds: ["entry"], x: 64, y: 48, width: 28, height: 26, color: "#9aa4a8" },
    ],
    furniture: [
      { id: "factory_machine_1", kind: "machine", x: 16, y: 30, width: 16, height: 13, color: "#53606a" },
      { id: "factory_machine_2", kind: "machine", x: 38, y: 48, width: 16, height: 13, color: "#53606a" },
      { id: "factory_table", kind: "table", x: 70, y: 27, width: 14, height: 8, color: "#8c5a3a" },
      { id: "factory_shelf", kind: "shelf", x: 70, y: 56, width: 16, height: 10, color: "#6f5f4c" },
    ],
  },
  market: {
    id: "market_interior",
    name: "Market interior",
    rooms: [
      { id: "counter", name: "Front counter", slotKinds: ["counter"], x: 8, y: 48, width: 84, height: 26, color: "#d6bd8c" },
      { id: "aisle", name: "Shop aisle", slotKinds: ["aisle"], x: 8, y: 8, width: 56, height: 36, color: "#c7d2bc" },
      { id: "entry", name: "Market entrance", slotKinds: ["entry"], x: 68, y: 8, width: 24, height: 36, color: "#b9c9d0" },
    ],
    furniture: [
      { id: "market_counter", kind: "counter", x: 14, y: 58, width: 36, height: 8, color: "#9b5647" },
      { id: "market_shelf_1", kind: "shelf", x: 16, y: 17, width: 40, height: 6, color: "#63784e" },
      { id: "market_shelf_2", kind: "shelf", x: 16, y: 31, width: 40, height: 6, color: "#63784e" },
      { id: "market_plant", kind: "plant", x: 76, y: 20, width: 8, height: 8, color: "#3f8a4f" },
    ],
  },
  office: {
    id: "office_interior",
    name: "Office interior",
    rooms: [
      { id: "desk", name: "Desk area", slotKinds: ["work"], x: 8, y: 8, width: 56, height: 66, color: "#c7d2df" },
      { id: "coffee", name: "Coffee corner", slotKinds: ["break"], x: 68, y: 8, width: 24, height: 28, color: "#d6c2a5" },
      { id: "lobby", name: "Office lobby", slotKinds: ["entry"], x: 68, y: 40, width: 24, height: 34, color: "#ccd6d2" },
    ],
    furniture: [
      { id: "office_desk_1", kind: "desk", x: 16, y: 18, width: 16, height: 10, color: "#7d92ac" },
      { id: "office_desk_2", kind: "desk", x: 40, y: 18, width: 16, height: 10, color: "#7d92ac" },
      { id: "office_desk_3", kind: "desk", x: 16, y: 48, width: 16, height: 10, color: "#7d92ac" },
      { id: "office_counter", kind: "counter", x: 73, y: 17, width: 12, height: 8, color: "#87604b" },
      { id: "office_plant", kind: "plant", x: 76, y: 52, width: 8, height: 8, color: "#3f8a4f" },
    ],
  },
  clinic: {
    id: "clinic_interior",
    name: "Clinic interior",
    rooms: [
      { id: "waiting", name: "Waiting room", slotKinds: ["waiting", "entry"], x: 8, y: 42, width: 84, height: 32, color: "#d6e0da" },
      { id: "exam", name: "Exam room", slotKinds: ["exam"], x: 8, y: 8, width: 84, height: 30, color: "#d8eef0" },
    ],
    furniture: [
      { id: "clinic_bed", kind: "bed", x: 18, y: 18, width: 24, height: 10, color: "#e7e2cf" },
      { id: "clinic_desk", kind: "desk", x: 58, y: 18, width: 16, height: 10, color: "#7d92ac" },
      { id: "clinic_chair_1", kind: "chair", x: 20, y: 55, width: 8, height: 8, color: "#8c5a3a" },
      { id: "clinic_chair_2", kind: "chair", x: 34, y: 55, width: 8, height: 8, color: "#8c5a3a" },
      { id: "clinic_plant", kind: "plant", x: 76, y: 54, width: 8, height: 8, color: "#3f8a4f" },
    ],
  },
  school: {
    id: "school_interior",
    name: "School interior",
    rooms: [
      { id: "classroom", name: "Classroom", slotKinds: ["classroom"], x: 8, y: 8, width: 46, height: 42, color: "#d8c69f" },
      { id: "hallway", name: "Hallway", slotKinds: ["hallway"], x: 8, y: 54, width: 84, height: 20, color: "#e0d6bc" },
      { id: "office", name: "School office", slotKinds: ["office"], x: 58, y: 8, width: 34, height: 42, color: "#c6d6dd" },
      { id: "yard", name: "School yard", slotKinds: ["yard", "entry"], x: 58, y: 54, width: 34, height: 20, color: "#b7caa8" },
    ],
    furniture: [
      { id: "school_board", kind: "board", x: 14, y: 14, width: 34, height: 6, color: "#3f7656" },
      { id: "school_desk_1", kind: "desk", x: 16, y: 28, width: 10, height: 8, color: "#8c5a3a" },
      { id: "school_desk_2", kind: "desk", x: 34, y: 28, width: 10, height: 8, color: "#8c5a3a" },
      { id: "school_office_desk", kind: "desk", x: 66, y: 24, width: 16, height: 10, color: "#7d92ac" },
      { id: "school_plant", kind: "plant", x: 74, y: 60, width: 8, height: 8, color: "#3f8a4f" },
    ],
  },
};
