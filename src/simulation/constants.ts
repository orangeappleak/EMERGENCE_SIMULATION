import type { Building } from "../types/simulation";

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
