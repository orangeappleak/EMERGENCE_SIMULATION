import { useEffect, useRef, useState } from "react";
import { ConversationsBrowser } from "./components/ConversationsBrowser";
import { BuildingInterior } from "./components/BuildingInterior";
import { CitizenProfile } from "./components/CitizenProfile";
import { CivicIssuesBrowser } from "./components/CivicIssuesBrowser";
import { ControlsPanel } from "./components/ControlsPanel";
import { MetricsBar } from "./components/MetricsBar";
import { PeopleBrowser } from "./components/PeopleBrowser";
import { PixiWorld } from "./components/PixiWorld";
import { TransactionsBrowser } from "./components/TransactionsBrowser";
import { WorldDecisionsBrowser } from "./components/WorldDecisionsBrowser";
import { WorldRequestsBrowser } from "./components/WorldRequestsBrowser";
import { WorldSignalsBrowser } from "./components/WorldSignalsBrowser";
import { useSimulation } from "./state/useSimulation";

export default function App() {
  const simulation = useSimulation();
  const lastFrame = useRef(performance.now());
  const [controlsOpen, setControlsOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [conversationsOpen, setConversationsOpen] = useState(false);
  const [transactionsOpen, setTransactionsOpen] = useState(false);
  const [worldDecisionsOpen, setWorldDecisionsOpen] = useState(false);
  const [worldRequestsOpen, setWorldRequestsOpen] = useState(false);
  const [worldSignalsOpen, setWorldSignalsOpen] = useState(false);
  const [civicIssuesOpen, setCivicIssuesOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [showRoutes, setShowRoutes] = useState(false);
  const [showSelectedRoute, setShowSelectedRoute] = useState(false);
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);
  const routeOverlay = showRoutes ? "all" : showSelectedRoute ? "selected" : "none";

  useEffect(() => {
    let frameId = 0;

    function frame(now: number) {
      const dt = Math.min(now - lastFrame.current, 100);
      lastFrame.current = now;
      simulation.tick(dt);
      frameId = requestAnimationFrame(frame);
    }

    frameId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(frameId);
  }, [simulation.tick]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">EMERGENCE / NORTHBRIDGE</p>
          <h1>Social Life Prototype</h1>
        </div>
        <div className="clock-panel">
          <span>Day {simulation.summary.day}</span>
          <strong>{simulation.summary.time}</strong>
        </div>
      </header>

      <MetricsBar summary={simulation.summary} />

      <section className={`workbench${profileOpen ? " has-profile" : ""}`}>
        <div className="map-toolbar" aria-label="Town view tools">
          <button
            type="button"
            onClick={() => {
              setControlsOpen((open) => !open);
              setPeopleOpen(false);
              setConversationsOpen(false);
              setTransactionsOpen(false);
              setWorldDecisionsOpen(false);
              setWorldRequestsOpen(false);
              setWorldSignalsOpen(false);
              setCivicIssuesOpen(false);
              setSelectedBuildingId(null);
            }}
          >
            {controlsOpen ? "Hide Controls" : "Controls"}
          </button>
          <button
            type="button"
            onClick={() => {
              setPeopleOpen((open) => !open);
              setControlsOpen(false);
              setConversationsOpen(false);
              setTransactionsOpen(false);
              setWorldDecisionsOpen(false);
              setWorldRequestsOpen(false);
              setWorldSignalsOpen(false);
              setCivicIssuesOpen(false);
              setSelectedBuildingId(null);
            }}
          >
            {peopleOpen ? "Hide People" : "People"}
          </button>
          <button
            type="button"
            onClick={() => {
              setConversationsOpen((open) => !open);
              setControlsOpen(false);
              setPeopleOpen(false);
              setTransactionsOpen(false);
              setWorldDecisionsOpen(false);
              setWorldRequestsOpen(false);
              setWorldSignalsOpen(false);
              setCivicIssuesOpen(false);
              setSelectedBuildingId(null);
            }}
          >
            {conversationsOpen ? "Hide Conversations" : "Conversations"}
          </button>
          <button
            type="button"
            onClick={() => {
              setTransactionsOpen((open) => !open);
              setControlsOpen(false);
              setPeopleOpen(false);
              setConversationsOpen(false);
              setWorldDecisionsOpen(false);
              setWorldRequestsOpen(false);
              setWorldSignalsOpen(false);
              setCivicIssuesOpen(false);
              setSelectedBuildingId(null);
            }}
          >
            {transactionsOpen ? "Hide Transactions" : "Transactions"}
          </button>
          <button
            type="button"
            onClick={() => {
              setWorldDecisionsOpen((open) => !open);
              setControlsOpen(false);
              setPeopleOpen(false);
              setConversationsOpen(false);
              setTransactionsOpen(false);
              setWorldRequestsOpen(false);
              setWorldSignalsOpen(false);
              setCivicIssuesOpen(false);
              setSelectedBuildingId(null);
            }}
          >
            {worldDecisionsOpen ? "Hide Decisions" : "Decisions"}
          </button>
          <button
            type="button"
            onClick={() => {
              setWorldRequestsOpen((open) => !open);
              setControlsOpen(false);
              setPeopleOpen(false);
              setConversationsOpen(false);
              setTransactionsOpen(false);
              setWorldDecisionsOpen(false);
              setWorldSignalsOpen(false);
              setCivicIssuesOpen(false);
              setSelectedBuildingId(null);
            }}
          >
            {worldRequestsOpen ? "Hide Requests" : "Requests"}
          </button>
          <button
            type="button"
            onClick={() => {
              setWorldSignalsOpen((open) => !open);
              setControlsOpen(false);
              setPeopleOpen(false);
              setConversationsOpen(false);
              setTransactionsOpen(false);
              setWorldDecisionsOpen(false);
              setWorldRequestsOpen(false);
              setCivicIssuesOpen(false);
              setSelectedBuildingId(null);
            }}
          >
            {worldSignalsOpen ? "Hide Concerns" : "Concerns"}
          </button>
          <button
            type="button"
            onClick={() => {
              setCivicIssuesOpen((open) => !open);
              setControlsOpen(false);
              setPeopleOpen(false);
              setConversationsOpen(false);
              setTransactionsOpen(false);
              setWorldDecisionsOpen(false);
              setWorldRequestsOpen(false);
              setWorldSignalsOpen(false);
              setSelectedBuildingId(null);
            }}
          >
            {civicIssuesOpen ? "Hide Issues" : "Issues"}
          </button>
          <button type="button" onClick={() => setProfileOpen((open) => !open)}>
            {profileOpen ? "Hide Person" : simulation.selectedCitizen.name}
          </button>
          <button
            className={showRoutes ? "active" : ""}
            type="button"
            onClick={() => {
              setShowRoutes((open) => !open);
              setShowSelectedRoute(false);
            }}
          >
            Paths
          </button>
          {selectedBuildingId ? (
            <button type="button" onClick={() => setSelectedBuildingId(null)}>
              Hide Building
            </button>
          ) : null}
        </div>

        {controlsOpen ? (
          <div className="drawer drawer-left">
            <ControlsPanel
              sim={simulation.sim}
              onTogglePaused={simulation.togglePaused}
              onSetSpeed={simulation.setSpeed}
              onSeedRumor={simulation.seedRumor}
              onCollapseFactory={simulation.collapseFactory}
              onClose={() => setControlsOpen(false)}
            />
          </div>
        ) : null}

        {peopleOpen ? (
          <div className="drawer drawer-left">
            <PeopleBrowser
              sim={simulation.sim}
              selectedCitizenId={simulation.selectedCitizenId}
              onSelectCitizen={(citizenId) => {
                simulation.setSelectedCitizenId(citizenId);
                setProfileOpen(true);
              }}
              onClose={() => setPeopleOpen(false)}
            />
          </div>
        ) : null}

        {conversationsOpen ? (
          <div className="drawer drawer-center">
            <ConversationsBrowser
              sim={simulation.sim}
              onSelectCitizen={(citizenId) => {
                simulation.setSelectedCitizenId(citizenId);
                setProfileOpen(true);
              }}
              onClose={() => setConversationsOpen(false)}
            />
          </div>
        ) : null}

        {transactionsOpen ? (
          <div className="drawer drawer-center">
            <TransactionsBrowser
              sim={simulation.sim}
              onSelectCitizen={(citizenId) => {
                simulation.setSelectedCitizenId(citizenId);
                setProfileOpen(true);
              }}
              onClose={() => setTransactionsOpen(false)}
            />
          </div>
        ) : null}

        {worldDecisionsOpen ? (
          <div className="drawer drawer-center">
            <WorldDecisionsBrowser
              sim={simulation.sim}
              onSelectCitizen={(citizenId) => {
                simulation.setSelectedCitizenId(citizenId);
                setProfileOpen(true);
              }}
              onClose={() => setWorldDecisionsOpen(false)}
            />
          </div>
        ) : null}

        {worldRequestsOpen ? (
          <div className="drawer drawer-center">
            <WorldRequestsBrowser
              sim={simulation.sim}
              onSelectCitizen={(citizenId) => {
                simulation.setSelectedCitizenId(citizenId);
                setProfileOpen(true);
              }}
              onResolveRequest={simulation.resolveWorldRequest}
              onClose={() => setWorldRequestsOpen(false)}
            />
          </div>
        ) : null}

        {worldSignalsOpen ? (
          <div className="drawer drawer-center">
            <WorldSignalsBrowser
              sim={simulation.sim}
              onSelectCitizen={(citizenId) => {
                simulation.setSelectedCitizenId(citizenId);
                setProfileOpen(true);
              }}
              onClose={() => setWorldSignalsOpen(false)}
            />
          </div>
        ) : null}

        {civicIssuesOpen ? (
          <div className="drawer drawer-center">
            <CivicIssuesBrowser
              sim={simulation.sim}
              onSelectCitizen={(citizenId) => {
                simulation.setSelectedCitizenId(citizenId);
                setProfileOpen(true);
              }}
              onClose={() => setCivicIssuesOpen(false)}
            />
          </div>
        ) : null}

        <PixiWorld
          sim={simulation.sim}
          selectedCitizenId={simulation.selectedCitizenId}
          followSelected={profileOpen}
          routeOverlay={routeOverlay}
          onSelectCitizen={(citizenId) => {
            simulation.setSelectedCitizenId(citizenId);
            setProfileOpen(true);
          }}
          onSelectBuilding={(buildingId) => {
            setSelectedBuildingId(buildingId);
            setControlsOpen(false);
            setPeopleOpen(false);
            setConversationsOpen(false);
            setTransactionsOpen(false);
            setWorldDecisionsOpen(false);
            setWorldRequestsOpen(false);
            setWorldSignalsOpen(false);
            setCivicIssuesOpen(false);
          }}
        />

        {selectedBuildingId ? (
          <div className="drawer drawer-center interior-drawer">
            <BuildingInterior
              buildingId={selectedBuildingId}
              sim={simulation.sim}
              onClose={() => setSelectedBuildingId(null)}
              onSelectCitizen={(citizenId) => {
                simulation.setSelectedCitizenId(citizenId);
                setProfileOpen(true);
              }}
            />
          </div>
        ) : null}

        {profileOpen ? (
          <div className="drawer drawer-right">
            <CitizenProfile
              citizen={simulation.selectedCitizen}
              sim={simulation.sim}
              showRoute={showSelectedRoute}
              onToggleRoute={() => {
                setShowRoutes(false);
                setShowSelectedRoute((open) => !open);
              }}
              onSelectCitizen={(citizenId) => {
                simulation.setSelectedCitizenId(citizenId);
                setProfileOpen(true);
              }}
              onClose={() => setProfileOpen(false)}
            />
          </div>
        ) : null}
      </section>
    </main>
  );
}
