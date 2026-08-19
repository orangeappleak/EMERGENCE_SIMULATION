import { useEffect, useRef, useState } from "react";
import type { SimulationState } from "../types/simulation";
import { createPixiWorld } from "../rendering/pixiWorld";

type PixiWorldProps = {
  sim: SimulationState;
  selectedCitizenId: string;
  followSelected: boolean;
  onSelectCitizen: (citizenId: string) => void;
  onSelectBuilding: (buildingId: string) => void;
};

export function PixiWorld({ sim, selectedCitizenId, followSelected, onSelectCitizen, onSelectBuilding }: PixiWorldProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<Awaited<ReturnType<typeof createPixiWorld>> | null>(null);
  const selectRef = useRef(onSelectCitizen);
  const buildingRef = useRef(onSelectBuilding);
  const [bootError, setBootError] = useState<string | null>(null);

  selectRef.current = onSelectCitizen;
  buildingRef.current = onSelectBuilding;

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      if (!hostRef.current || worldRef.current) return;
      try {
        const world = await createPixiWorld(
          hostRef.current,
          (id) => selectRef.current(id),
          (id) => buildingRef.current(id)
        );
        if (cancelled) {
          world.destroy();
          return;
        }
        worldRef.current = world;
        world.update(sim, selectedCitizenId, followSelected);
      } catch (error) {
        if (!cancelled) {
          setBootError(error instanceof Error ? error.message : "Pixi failed to start.");
        }
      }
    }

    boot();
    return () => {
      cancelled = true;
      worldRef.current?.destroy();
      worldRef.current = null;
    };
  }, []);

  useEffect(() => {
    worldRef.current?.update(sim, selectedCitizenId, followSelected);
  }, [sim, selectedCitizenId, followSelected, sim.day, sim.minute, sim.totalConversations, sim.weather.kind]);

  return (
    <section ref={hostRef} className="map-stage" aria-label="Northbridge map">
      <div className="map-loading">{bootError ? `Renderer failed: ${bootError}` : "Loading Northbridge..."}</div>
      <div className="map-hint">Drag to pan · Scroll to zoom</div>
    </section>
  );
}
