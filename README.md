# EMERGENCE App

This is the proper React + TypeScript version of the Northbridge simulation.

The earlier `emergence-v0.2` folder is a dependency-free proof prototype. This app is the version meant to grow into the real project.

## Stack

- React
- TypeScript
- Vite
- PixiJS world renderer
- Simulation code separated from UI code

## Run

```bash
npm install
npm run dev
```

Then open:

```text
http://localhost:5173
```

## Current Features

- 50 procedural citizens
- 10 homes, households, families, children, teens, elders, roommates
- school, factory, office, market, and clinic
- visible commute movement
- relationships with familiarity, friendship, trust, and dislike
- stronger family and household relationships
- household rent, shared cash, food stock, and stress
- children and some teens attend school
- social conversations
- conversation browser with topic/classification filters
- observable decision reasoning and conversation classification reasons
- stage-one authority/obligation checks for school and work
- social memories
- life journals, needs, emotions, problems, and personal goals
- factory rumor propagation
- factory collapse experiment
- clickable citizen profile panel
- searchable people browser with clickable relationships
- real pixel assets from `emergence_assets/Tiny Village Pack`
- tile-style map layer with roads, sidewalks, paths, lots, and props
- drag-to-pan camera
- scroll-wheel zoom

## Project Shape

```text
src/
  components/
    CitizenProfile.tsx
    ConversationsBrowser.tsx
    ControlsPanel.tsx
    MetricsBar.tsx
    PeopleBrowser.tsx
    PixiWorld.tsx
  rendering/
    assets.ts
    pixiWorld.ts
  simulation/
    brain.ts
    constants.ts
    random.ts
    time.ts
    world.ts
  state/
    useSimulation.ts
  types/
    simulation.ts
```
