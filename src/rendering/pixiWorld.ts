import * as PIXI from "pixi.js";
import type { Citizen, SimulationState } from "../types/simulation";
import { BUILDINGS, FACTORY_RUMOR, PLACE_SLOTS } from "../simulation/constants";
import { GAME_ASSETS } from "./assets";

export const WORLD_WIDTH = 1440;
export const WORLD_HEIGHT = 960;
const TILE_SIZE = 32;
const MIN_ZOOM = 0.75;
const MAX_ZOOM = 2.25;

type CitizenSprite = {
  root: PIXI.Container;
  sprite: PIXI.Sprite;
  frames: PIXI.Texture[];
  facingFrame: number;
  marker: PIXI.Sprite;
  talkBubble: PIXI.Container;
  selection: PIXI.Graphics;
};

type PixiWorld = {
  app: PIXI.Application;
  viewport: PIXI.Container;
  dynamicLayer: PIXI.Container;
  atmosphereLayer: PIXI.Container;
  citizenSprites: Map<string, CitizenSprite>;
  isDraggingCamera: () => boolean;
  update: (sim: SimulationState, selectedCitizenId: string, followSelected: boolean) => void;
  destroy: () => void;
};

const buildingSprites: Record<string, string> = {
  home_01: GAME_ASSETS.buildings.apartments,
  home_02: GAME_ASSETS.buildings.pineCourt,
  home_03: GAME_ASSETS.buildings.market,
  home_04: GAME_ASSETS.buildings.office,
  home_05: GAME_ASSETS.buildings.apartments,
  home_06: GAME_ASSETS.buildings.pineCourt,
  home_07: GAME_ASSETS.buildings.market,
  home_08: GAME_ASSETS.buildings.office,
  home_09: GAME_ASSETS.buildings.apartments,
  home_10: GAME_ASSETS.buildings.pineCourt,
  market: GAME_ASSETS.buildings.market,
  office: GAME_ASSETS.buildings.office,
  clinic: GAME_ASSETS.buildings.clinic,
  school: GAME_ASSETS.buildings.clinic,
  factory: GAME_ASSETS.buildings.factoryOffice,
};

function makeLabel(text: string, x: number, y: number) {
  const label = new PIXI.Text({
    text,
    style: {
      fill: "#202326",
      fontFamily: "system-ui, sans-serif",
      fontSize: 15,
      fontWeight: "700",
    },
  });
  label.position.set(x, y);
  return label;
}

function drawTileGrid(stage: PIXI.Container) {
  const ground = new PIXI.Graphics();
  const cols = Math.ceil(WORLD_WIDTH / TILE_SIZE);
  const rows = Math.ceil(WORLD_HEIGHT / TILE_SIZE);

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = col * TILE_SIZE;
      const y = row * TILE_SIZE;
      const shade = (row * 13 + col * 7) % 5;
      const color = ["#c9d7c3", "#c3d1bc", "#cedbc8", "#bed0b9", "#cad8c1"][shade];
      ground.rect(x, y, TILE_SIZE, TILE_SIZE).fill(color);
    }
  }

  const lots = [
    [126, 76, 280, 170],
    [124, 444, 276, 170],
    [74, 670, 360, 190],
    [660, 78, 292, 190],
    [444, 312, 244, 160],
    [686, 454, 240, 150],
    [982, 62, 360, 190],
    [990, 398, 300, 190],
    [998, 660, 350, 190],
  ];
  for (const [x, y, width, height] of lots) {
    ground.rect(x, y, width, height).fill("#b9c4aa");
    ground.rect(x + 8, y + 8, width - 16, height - 16).stroke({ color: "#a6b096", width: 2 });
  }

  ground.rect(0, 284, WORLD_WIDTH, 76).fill("#535b62");
  ground.rect(412, 0, 88, WORLD_HEIGHT).fill("#535b62");
  ground.rect(0, 264, WORLD_WIDTH, 16).fill("#9cae9b");
  ground.rect(0, 364, WORLD_WIDTH, 16).fill("#9cae9b");
  ground.rect(392, 0, 16, WORLD_HEIGHT).fill("#9cae9b");
  ground.rect(504, 0, 16, WORLD_HEIGHT).fill("#9cae9b");

  for (let x = 0; x < WORLD_WIDTH; x += 48) {
    ground.rect(x + 8, 320, 24, 4).fill("#d7c66b");
  }
  for (let y = 0; y < WORLD_HEIGHT; y += 48) {
    ground.rect(454, y + 8, 4, 24).fill("#d7c66b");
  }

  const paths = [
    [260, 246, 24, 38],
    [260, 360, 24, 84],
    [564, 280, 24, 32],
    [780, 268, 24, 56],
    [808, 380, 24, 74],
  ];
  for (const [x, y, width, height] of paths) {
    ground.rect(x, y, width, height).fill("#b7aa83");
  }

  stage.addChild(ground);
}

function drawStaticWorld(stage: PIXI.Container, textures: Record<string, PIXI.Texture>) {
  drawTileGrid(stage);

  const scenery = [
    { asset: GAME_ASSETS.props.tree, x: 44, y: 48, scale: 1.7 },
    { asset: GAME_ASSETS.props.tree, x: 84, y: 72, scale: 1.5 },
    { asset: GAME_ASSETS.props.tree, x: 865, y: 35, scale: 1.5 },
    { asset: GAME_ASSETS.props.tree, x: 914, y: 48, scale: 1.4 },
    { asset: GAME_ASSETS.props.tree, x: 76, y: 420, scale: 1.5 },
    { asset: GAME_ASSETS.props.tree, x: 34, y: 486, scale: 1.6 },
    { asset: GAME_ASSETS.props.tree, x: 585, y: 520, scale: 1.4 },
    { asset: GAME_ASSETS.props.tree, x: 602, y: 60, scale: 1.35 },
    { asset: GAME_ASSETS.props.bush, x: 372, y: 130, scale: 2 },
    { asset: GAME_ASSETS.props.bush, x: 118, y: 258, scale: 2 },
    { asset: GAME_ASSETS.props.bush, x: 664, y: 462, scale: 2 },
    { asset: GAME_ASSETS.props.bench, x: 330, y: 374, scale: 1.4 },
    { asset: GAME_ASSETS.props.bench, x: 604, y: 266, scale: 1.25 },
    { asset: GAME_ASSETS.props.streetlight, x: 404, y: 238, scale: 1.5 },
    { asset: GAME_ASSETS.props.streetlight, x: 512, y: 378, scale: 1.5 },
    { asset: GAME_ASSETS.props.streetlight, x: 404, y: 418, scale: 1.5 },
    { asset: GAME_ASSETS.props.streetlight, x: 512, y: 198, scale: 1.5 },
    { asset: GAME_ASSETS.props.signLarge, x: 548, y: 316, scale: 1.2 },
    { asset: GAME_ASSETS.props.fountain, x: 544, y: 388, scale: 1.2 },
  ];

  for (const item of scenery) {
    const sprite = new PIXI.Sprite(textures[item.asset]);
    sprite.position.set(item.x, item.y);
    sprite.scale.set(item.scale);
    stage.addChild(sprite);
  }

  for (const building of BUILDINGS) {
    if (building.id === "factory") {
      const factory = new PIXI.Graphics();
      factory.rect(building.x, building.y + 30, building.width, building.height - 30).fill("#7f8b96");
      factory.rect(building.x + 150, building.y - 18, 28, 48).fill("#56616b");
      factory.rect(building.x + 14, building.y + 48, 32, 24).fill("#dce7ea");
      factory.rect(building.x + 62, building.y + 48, 32, 24).fill("#dce7ea");
      factory.rect(building.x + 110, building.y + 48, 32, 24).fill("#dce7ea");
      factory.rect(building.x, building.y + 30, building.width, building.height - 30).stroke({ color: "#202326", width: 3 });
      stage.addChild(factory);
    } else if (building.id === "school") {
      const school = new PIXI.Graphics();
      school.rect(building.x, building.y + 20, building.width, building.height - 20).fill("#b68b4f");
      school.rect(building.x + 18, building.y + 48, 32, 24).fill("#f1ead2");
      school.rect(building.x + 68, building.y + 48, 32, 24).fill("#f1ead2");
      school.rect(building.x + 118, building.y + 48, 32, 24).fill("#f1ead2");
      school.rect(building.x + building.width / 2 - 14, building.y + building.height - 34, 28, 34).fill("#574533");
      school.rect(building.x, building.y + 20, building.width, building.height - 20).stroke({ color: "#202326", width: 3 });
      stage.addChild(school);
    } else {
      const sprite = new PIXI.Sprite(textures[buildingSprites[building.id]]);
      const scale = Math.min(building.width / sprite.texture.width, building.height / sprite.texture.height) * 0.95;
      sprite.anchor.set(0.5, 1);
      sprite.scale.set(scale);
      sprite.position.set(building.x + building.width / 2, building.y + building.height);
      stage.addChild(sprite);
    }

    stage.addChild(makeLabel(building.name, building.x + 8, building.y - 16));
  }

  const slotLayer = new PIXI.Graphics();
  for (const slot of PLACE_SLOTS) {
    const color = slot.kind === "yard" || slot.kind === "entry" ? 0x7f9a79 : 0xf1ead2;
    slotLayer.circle(slot.x, slot.y, Math.max(3, Math.min(7, slot.radius * 0.28))).fill({ color, alpha: 0.42 });
  }
  stage.addChild(slotLayer);
}

function addBuildingHitAreas(stage: PIXI.Container, onSelectBuilding: (id: string) => void, isDraggingCamera: () => boolean) {
  const hitLayer = new PIXI.Container();
  hitLayer.eventMode = "passive";
  hitLayer.zIndex = 5000;

  for (const building of BUILDINGS) {
    const hit = new PIXI.Graphics();
    hit.rect(building.x, building.y, building.width, building.height).fill({ color: 0xffffff, alpha: 0.001 });
    hit.eventMode = "static";
    hit.hitArea = new PIXI.Rectangle(building.x, building.y, building.width, building.height);
    hit.cursor = "pointer";
    hit.on("pointerup", () => {
      if (!isDraggingCamera()) onSelectBuilding(building.id);
    });
    hitLayer.addChild(hit);
  }

  stage.addChild(hitLayer);
}

function timeLight(minute: number) {
  const hour = minute / 60;
  if (hour < 5.2) return { color: 0x10213d, alpha: 0.48 };
  if (hour < 7.2) return { color: 0xf0a45f, alpha: 0.24 - (hour - 5.2) * 0.07 };
  if (hour < 16.8) return { color: 0xffffff, alpha: 0 };
  if (hour < 19.2) return { color: 0xf08c51, alpha: 0.1 + (hour - 16.8) * 0.08 };
  if (hour < 21.3) return { color: 0x24375e, alpha: 0.2 + (hour - 19.2) * 0.1 };
  return { color: 0x10213d, alpha: 0.46 };
}

function drawAtmosphere(layer: PIXI.Container, app: PIXI.Application, sim: SimulationState) {
  layer.removeChildren();

  const width = app.screen.width;
  const height = app.screen.height;
  const light = timeLight(sim.minute);
  if (light.alpha > 0) {
    const tint = new PIXI.Graphics();
    tint.rect(0, 0, width, height).fill({ color: light.color, alpha: light.alpha });
    layer.addChild(tint);
  }

  if (sim.weather.kind === "cloudy") {
    const cloud = new PIXI.Graphics();
    cloud.rect(0, 0, width, height).fill({ color: 0xd8dee0, alpha: 0.16 });
    layer.addChild(cloud);
  }

  if (sim.weather.kind === "fog") {
    const fog = new PIXI.Graphics();
    fog.rect(0, 0, width, height).fill({ color: 0xe8eeee, alpha: 0.22 });
    for (let y = 40; y < height; y += 90) {
      fog.rect(0, y, width, 18).fill({ color: 0xffffff, alpha: 0.12 });
    }
    layer.addChild(fog);
  }

  if (sim.weather.kind === "rain") {
    const rainShade = new PIXI.Graphics();
    rainShade.rect(0, 0, width, height).fill({ color: 0x4d5f6d, alpha: 0.2 });
    for (let i = 0; i < 130; i += 1) {
      const x = (i * 47 + sim.minute * 5) % (width + 80) - 40;
      const y = (i * 73 + sim.minute * 9) % (height + 80) - 40;
      rainShade.moveTo(x, y).lineTo(x - 9, y + 22).stroke({ color: 0xcad8e6, alpha: 0.45, width: 1 });
    }
    layer.addChild(rainShade);
  }
}

function clampCamera(viewport: PIXI.Container, app: PIXI.Application) {
  const scale = viewport.scale.x;
  const screenWidth = app.screen.width;
  const screenHeight = app.screen.height;
  const minX = Math.min(0, screenWidth - WORLD_WIDTH * scale);
  const minY = Math.min(0, screenHeight - WORLD_HEIGHT * scale);
  viewport.x = Math.max(minX, Math.min(0, viewport.x));
  viewport.y = Math.max(minY, Math.min(0, viewport.y));

  if (WORLD_WIDTH * scale <= screenWidth) viewport.x = (screenWidth - WORLD_WIDTH * scale) / 2;
  if (WORLD_HEIGHT * scale <= screenHeight) viewport.y = (screenHeight - WORLD_HEIGHT * scale) / 2;
}

function followCitizen(viewport: PIXI.Container, app: PIXI.Application, citizen: Citizen) {
  const nextScale = Math.max(viewport.scale.x, 1.45);
  viewport.scale.set(nextScale);
  viewport.x = app.screen.width / 2 - citizen.x * nextScale;
  viewport.y = app.screen.height / 2 - citizen.y * nextScale;
  clampCamera(viewport, app);
}

function attachCameraControls(app: PIXI.Application, viewport: PIXI.Container) {
  let dragging = false;
  let moved = false;
  let lastX = 0;
  let lastY = 0;

  app.stage.eventMode = "static";
  app.stage.hitArea = new PIXI.Rectangle(0, 0, app.screen.width, app.screen.height);

  app.stage.on("pointerdown", (event) => {
    dragging = true;
    moved = false;
    lastX = event.global.x;
    lastY = event.global.y;
    app.canvas.classList.add("is-panning");
  });

  app.stage.on("pointerup", () => {
    dragging = false;
    app.canvas.classList.remove("is-panning");
    window.setTimeout(() => {
      moved = false;
    }, 0);
  });

  app.stage.on("pointerupoutside", () => {
    dragging = false;
    app.canvas.classList.remove("is-panning");
    window.setTimeout(() => {
      moved = false;
    }, 0);
  });

  app.stage.on("pointermove", (event) => {
    if (!dragging) return;
    const dx = event.global.x - lastX;
    const dy = event.global.y - lastY;
    if (Math.hypot(dx, dy) > 2) moved = true;
    viewport.x += dx;
    viewport.y += dy;
    lastX = event.global.x;
    lastY = event.global.y;
    clampCamera(viewport, app);
    app.render();
  });

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = app.canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    const before = viewport.toLocal(new PIXI.Point(screenX, screenY));
    const nextScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, viewport.scale.x * (event.deltaY > 0 ? 0.9 : 1.1)));
    viewport.scale.set(nextScale);
    const after = viewport.toGlobal(before);
    viewport.x += screenX - after.x;
    viewport.y += screenY - after.y;
    clampCamera(viewport, app);
    app.render();
  };

  app.canvas.addEventListener("wheel", onWheel, { passive: false });

  return {
    isDragging: () => moved,
    cleanup: () => app.canvas.removeEventListener("wheel", onWheel),
  };
}

function fitRendererToHost(app: PIXI.Application, host: HTMLElement, viewport: PIXI.Container) {
  const resize = () => {
    const width = Math.max(320, Math.floor(host.clientWidth));
    const height = Math.max(320, Math.floor(host.clientHeight));
    app.renderer.resize(width, height);
    app.stage.hitArea = new PIXI.Rectangle(0, 0, width, height);
    clampCamera(viewport, app);
    app.render();
  };

  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  return () => observer.disconnect();
}

function npcFrames(texture: PIXI.Texture, index: number) {
  const frameWidth = 32;
  const frameHeight = 32;
  const row = index % 5;
  return Array.from({ length: 4 }, (_, frameIndex) => new PIXI.Texture({
    source: texture.source,
    frame: new PIXI.Rectangle(frameIndex * frameWidth, row * frameHeight, frameWidth, frameHeight),
  }));
}

function makeTalkBubble() {
  const bubble = new PIXI.Container();
  const back = new PIXI.Graphics();
  back.roundRect(-11, -38, 22, 14, 4).fill("#ffffff").stroke({ color: "#202326", width: 2 });
  const dots = new PIXI.Graphics();
  dots.rect(-5, -33, 3, 3).fill("#202326");
  dots.rect(1, -33, 3, 3).fill("#202326");
  bubble.addChild(back, dots);
  return bubble;
}

function makeCitizenSprite(citizen: Citizen, textures: Record<string, PIXI.Texture>, onSelect: (id: string) => void, isDraggingCamera: () => boolean): CitizenSprite {
  const root = new PIXI.Container();
  root.eventMode = "static";
  root.cursor = "pointer";
  root.on("pointertap", () => {
    if (!isDraggingCamera()) onSelect(citizen.id);
  });

  const sheet = GAME_ASSETS.npcs[Number(citizen.id.split("_")[1]) % GAME_ASSETS.npcs.length];
  const frames = npcFrames(textures[sheet], Number(citizen.id.split("_")[1]));
  const sprite = new PIXI.Sprite(frames[0]);
  sprite.anchor.set(0.5, 0.82);
  sprite.scale.set(1.6);

  const selection = new PIXI.Graphics();
  const marker = new PIXI.Sprite(textures[GAME_ASSETS.props.coin]);
  marker.anchor.set(0.5);
  marker.scale.set(1.6);
  marker.position.set(11, -26);

  const talkBubble = makeTalkBubble();
  root.addChild(selection, sprite, marker, talkBubble);
  return { root, sprite, frames, facingFrame: 0, marker, talkBubble, selection };
}

function updateCitizenSprite(view: CitizenSprite, citizen: Citizen, selected: boolean) {
  view.root.position.set(citizen.x, citizen.y);
  view.root.zIndex = citizen.y;
  view.marker.visible = citizen.knownFacts.includes(FACTORY_RUMOR);
  view.talkBubble.visible = citizen.conversationWithId !== null;
  view.selection.clear();

  if (selected) {
    view.selection.ellipse(0, 6, 16, 8).stroke({ color: "#f7d35f", width: 3 });
  }

  const dx = citizen.targetX - citizen.x;
  const dy = citizen.targetY - citizen.y;
  const distanceToTarget = Math.hypot(dx, dy);
  const walking = distanceToTarget > 5 && citizen.currentIntention !== "sleep";
  const citizenIndex = Number(citizen.id.split("_")[1]);
  const now = performance.now();

  if (walking) {
    if (Math.abs(dx) > Math.abs(dy)) {
      view.facingFrame = dx < 0 ? 3 : 1;
    } else {
      view.facingFrame = dy < 0 ? 2 : 0;
    }
  }

  view.sprite.texture = view.frames[view.facingFrame];
  view.sprite.scale.x = 1.6;
  view.sprite.scale.y = 1.6;
  view.sprite.y = walking
    ? Math.sin(now / 75 + citizenIndex) * 1.4
    : Math.sin(now / 820 + citizenIndex) * 0.45;
  view.sprite.rotation = 0;
  view.talkBubble.y = view.talkBubble.visible ? Math.sin(now / 180 + citizenIndex) * 1.2 : 0;
  view.marker.y = walking ? Math.sin(now / 140 + citizenIndex) * 0.8 : 0;
}

export async function createPixiWorld(
  host: HTMLElement,
  onSelectCitizen: (id: string) => void,
  onSelectBuilding: (id: string) => void
): Promise<PixiWorld> {
  const app = new PIXI.Application();
  await app.init({
    width: Math.max(320, Math.floor(host.clientWidth)),
    height: Math.max(320, Math.floor(host.clientHeight)),
    backgroundAlpha: 0,
    antialias: false,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
  });

  const assetUrls = [
    ...GAME_ASSETS.npcs,
    ...Object.values(GAME_ASSETS.buildings),
    ...Object.values(GAME_ASSETS.props),
  ];
  const loaded = await PIXI.Assets.load(assetUrls);
  const textures = loaded as Record<string, PIXI.Texture>;

  app.canvas.className = "pixi-canvas";
  host.querySelector(".map-loading")?.remove();
  host.querySelector("canvas")?.remove();
  host.prepend(app.canvas);

  const viewport = new PIXI.Container();
  const staticLayer = new PIXI.Container();
  const dynamicLayer = new PIXI.Container();
  const atmosphereLayer = new PIXI.Container();
  atmosphereLayer.eventMode = "none";
  atmosphereLayer.interactiveChildren = false;
  dynamicLayer.sortableChildren = true;
  app.stage.addChild(viewport);
  viewport.addChild(staticLayer, dynamicLayer);
  app.stage.addChild(atmosphereLayer);
  drawStaticWorld(staticLayer, textures);
  const cameraControls = attachCameraControls(app, viewport);
  addBuildingHitAreas(staticLayer, onSelectBuilding, cameraControls.isDragging);
  const stopResize = fitRendererToHost(app, host, viewport);
  clampCamera(viewport, app);

  const citizenSprites = new Map<string, CitizenSprite>();

  return {
    app,
    viewport,
    dynamicLayer,
    atmosphereLayer,
    citizenSprites,
    isDraggingCamera: cameraControls.isDragging,
    update(sim, selectedCitizenId, followSelected) {
      for (const citizen of sim.citizens) {
        let view = citizenSprites.get(citizen.id);
        if (!view) {
          view = makeCitizenSprite(citizen, textures, onSelectCitizen, cameraControls.isDragging);
          citizenSprites.set(citizen.id, view);
          dynamicLayer.addChild(view.root);
        }
        updateCitizenSprite(view, citizen, citizen.id === selectedCitizenId);
      }
      if (followSelected && !cameraControls.isDragging()) {
        const selectedCitizen = sim.citizens.find((citizen) => citizen.id === selectedCitizenId);
        if (selectedCitizen) followCitizen(viewport, app, selectedCitizen);
      }
      drawAtmosphere(atmosphereLayer, app, sim);
      app.render();
    },
    destroy() {
      stopResize();
      cameraControls.cleanup();
      app.destroy(true);
    },
  };
}
