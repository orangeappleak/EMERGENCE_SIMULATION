import { useCallback, useMemo, useRef, useState } from "react";
import type { Citizen, SimulationState } from "../types/simulation";
import { collapseFactory, createSimulation, seedRumor, snapshot, stepSimulation } from "../simulation/world";
import { resolveWorldRequest } from "../simulation/worldRequestSystem";

export function useSimulation() {
  const [, forceRender] = useState(0);
  const simRef = useRef<SimulationState>(createSimulation());
  const [selectedCitizenId, setSelectedCitizenId] = useState(simRef.current.citizens[0].id);

  const tick = useCallback((realMs: number) => {
    stepSimulation(simRef.current, realMs);
    forceRender((value) => value + 1);
  }, []);

  const setSpeed = useCallback((speed: number) => {
    simRef.current.speed = speed;
    forceRender((value) => value + 1);
  }, []);

  const togglePaused = useCallback(() => {
    simRef.current.paused = !simRef.current.paused;
    forceRender((value) => value + 1);
  }, []);

  const toggleCitizenAiBrain = useCallback((citizenId: string) => {
    const citizen = simRef.current.citizens.find((item) => item.id === citizenId);
    if (!citizen) return;
    citizen.aiBrainEnabled = !citizen.aiBrainEnabled;
    citizen.aiBrainStatus = citizen.aiBrainEnabled
      ? { state: "fallback", message: "AI bridge mode is enabled. Scripted fallback stays active until a backend connector is configured." }
      : { state: "off", message: "Using the scripted brain." };
    forceRender((value) => value + 1);
  }, []);

  const selectedCitizen = useMemo<Citizen>(() => {
    return simRef.current.citizens.find((citizen) => citizen.id === selectedCitizenId) ?? simRef.current.citizens[0];
  }, [selectedCitizenId, simRef.current.day, simRef.current.minute, simRef.current.totalConversations]);

  return {
    sim: simRef.current,
    summary: snapshot(simRef.current),
    selectedCitizen,
    selectedCitizenId,
    setSelectedCitizenId,
    tick,
    setSpeed,
    togglePaused,
    toggleCitizenAiBrain,
    seedRumor: () => {
      seedRumor(simRef.current);
      forceRender((value) => value + 1);
    },
    collapseFactory: () => {
      collapseFactory(simRef.current);
      forceRender((value) => value + 1);
    },
    resolveWorldRequest: (requestId: string, status: "approved" | "denied") => {
      resolveWorldRequest(simRef.current, requestId, status);
      forceRender((value) => value + 1);
    },
  };
}
