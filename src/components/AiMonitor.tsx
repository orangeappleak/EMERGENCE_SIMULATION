import { useMemo, useState } from "react";
import type { Citizen, CitizenBrainDebug, SimulationState } from "../types/simulation";
import { buildingById, placeSlotById } from "../simulation/world";

type AiMonitorProps = {
  sim: SimulationState;
  selectedCitizenId: string;
  onSelectCitizen: (citizenId: string) => void;
  onClose: () => void;
};

type MonitorFilter = "all" | "enabled" | "ai" | "fallback" | "waiting" | "error";

const FILTERS: Array<{ id: MonitorFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "enabled", label: "AI enabled" },
  { id: "ai", label: "AI accepted" },
  { id: "fallback", label: "Fallback" },
  { id: "waiting", label: "Waiting" },
  { id: "error", label: "Errors" },
];

function titleCase(text: string) {
  return text.replace(/(^|\s|-)\S/g, (value) => value.toUpperCase());
}

function sourceLabel(debug: CitizenBrainDebug | null) {
  if (!debug) return "No decision yet";
  if (debug.source === "ai") return "AI accepted";
  if (debug.mode === "ai") return "Scripted fallback";
  return "Scripted";
}

function matchesFilter(citizen: Citizen, filter: MonitorFilter) {
  if (filter === "enabled") return citizen.aiBrainEnabled;
  if (filter === "waiting") return citizen.aiBrainStatus.state === "waiting";
  if (filter === "error") return citizen.aiBrainStatus.state === "error";
  if (filter === "ai") return citizen.brainDebug?.source === "ai";
  if (filter === "fallback") return citizen.brainDebug?.mode === "ai" && citizen.brainDebug.source === "fallback";
  return true;
}

function searchText(citizen: Citizen) {
  return [
    citizen.name,
    citizen.job,
    citizen.aiBrainStatus.state,
    citizen.aiBrainStatus.message,
    citizen.brainDebug?.source ?? "",
    citizen.brainDebug?.summary ?? "",
    citizen.brainDebug?.output.decision.intention ?? "",
    citizen.brainDebug?.output.decision.reason ?? "",
    citizen.brainDebug?.output.decision.tags.join(" ") ?? "",
  ].join(" ").toLowerCase();
}

export function AiMonitor({ sim, selectedCitizenId, onSelectCitizen, onClose }: AiMonitorProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<MonitorFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const normalizedQuery = query.trim().toLowerCase();

  const citizens = useMemo(() => {
    return sim.citizens
      .filter((citizen) => matchesFilter(citizen, filter))
      .filter((citizen) => !normalizedQuery || searchText(citizen).includes(normalizedQuery))
      .sort((a, b) => {
        if (a.aiBrainEnabled !== b.aiBrainEnabled) return a.aiBrainEnabled ? -1 : 1;
        const aAi = a.brainDebug?.source === "ai" ? 1 : 0;
        const bAi = b.brainDebug?.source === "ai" ? 1 : 0;
        if (aAi !== bAi) return bAi - aAi;
        return a.name.localeCompare(b.name);
      });
  }, [filter, normalizedQuery, sim.citizens, sim.day, sim.minute]);

  const enabledCount = sim.citizens.filter((citizen) => citizen.aiBrainEnabled).length;
  const waitingCount = sim.citizens.filter((citizen) => citizen.aiBrainStatus.state === "waiting").length;
  const errorCount = sim.citizens.filter((citizen) => citizen.aiBrainStatus.state === "error").length;
  const acceptedCount = sim.citizens.filter((citizen) => citizen.brainDebug?.source === "ai").length;
  const fallbackCount = sim.citizens.filter((citizen) => (
    citizen.brainDebug?.mode === "ai" && citizen.brainDebug.source === "fallback"
  )).length;
  const selectedCitizen = citizens.find((citizen) => citizen.id === selectedId)
    ?? citizens.find((citizen) => citizen.id === selectedCitizenId)
    ?? citizens[0];
  const debug = selectedCitizen?.brainDebug ?? null;
  const decision = debug?.output.decision;
  const destinationName = decision ? buildingById(decision.destinationId).name : null;

  return (
    <aside className="panel ai-monitor-panel">
      <div className="panel-title-row">
        <div>
          <h2>AI Monitor</h2>
          <p className="muted">{enabledCount} citizens using AI bridge mode</p>
        </div>
        <div className="panel-title-actions">
          <span className="status-badge">{citizens.length}</span>
          <button className="panel-close" type="button" onClick={onClose} aria-label="Close AI monitor">Close</button>
        </div>
      </div>

      <div className="ai-monitor-summary" aria-label="AI bridge summary">
        <div className="ai-stat-card">
          <span>AI enabled</span>
          <strong>{enabledCount}</strong>
        </div>
        <div className="ai-stat-card">
          <span>Accepted AI</span>
          <strong>{acceptedCount}</strong>
        </div>
        <div className="ai-stat-card">
          <span>Fallbacks</span>
          <strong>{fallbackCount}</strong>
        </div>
        <div className="ai-stat-card">
          <span>Waiting</span>
          <strong>{waitingCount}</strong>
        </div>
        <div className="ai-stat-card">
          <span>Errors</span>
          <strong>{errorCount}</strong>
        </div>
      </div>

      <div className="ai-monitor-controls">
        <input
          className="people-search"
          placeholder="Find citizens, AI status, reasons, tags..."
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />

        <div className="filter-tabs" role="tablist" aria-label="AI monitor filters">
          {FILTERS.map((item) => (
            <button
              aria-selected={filter === item.id}
              className={filter === item.id ? "active" : ""}
              key={item.id}
              role="tab"
              type="button"
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="workspace-layout ai-monitor-layout">
        <ol className="workspace-list ai-monitor-list">
          {citizens.length ? citizens.map((citizen) => (
            <li key={citizen.id}>
              <button
                className={selectedCitizen?.id === citizen.id ? "workspace-list-button active" : "workspace-list-button"}
                type="button"
                onClick={() => setSelectedId(citizen.id)}
              >
                <div className="decision-entry-head">
                  <div>
                    <strong>{citizen.name}</strong>
                    <span>{citizen.aiBrainEnabled ? "AI bridge on" : "Scripted"} · {titleCase(citizen.aiBrainStatus.state)}</span>
                  </div>
                  <em>{sourceLabel(citizen.brainDebug)}</em>
                </div>
                <p>{citizen.aiBrainStatus.message}</p>
                <small>{citizen.currentThought}</small>
              </button>
            </li>
          )) : (
            <li className="empty-row">
              <div className="decision-entry-head">
                <div>
                  <strong>No matching AI activity</strong>
                  <span>Try another filter</span>
                </div>
                <em>Empty</em>
              </div>
              <p>No citizen matches this AI monitor view right now.</p>
            </li>
          )}
        </ol>

        <section className="workspace-detail" aria-label="AI brain details">
          {selectedCitizen ? (
            <>
              <div className="detail-heading">
                <div>
                  <span>{selectedCitizen.job} · {buildingById(selectedCitizen.destinationId).name} · {placeSlotById(selectedCitizen.destinationSlotId).name}</span>
                  <h3>{selectedCitizen.name}</h3>
                </div>
                <button type="button" onClick={() => onSelectCitizen(selectedCitizen.id)}>Open Person</button>
              </div>

              <div className="detail-grid ai-compact-grid">
                <div className="detail-card">
                  <span>Adapter</span>
                  <strong>{selectedCitizen.aiBrainEnabled ? "AI bridge" : "Scripted"}</strong>
                </div>
                <div className="detail-card">
                  <span>Status</span>
                  <strong>{titleCase(selectedCitizen.aiBrainStatus.state)}</strong>
                </div>
                <div className="detail-card">
                  <span>Last source</span>
                  <strong>{sourceLabel(debug)}</strong>
                </div>
                <div className="detail-card">
                  <span>Validation</span>
                  <strong>{debug?.validation.valid ? "Clean" : debug ? "Repaired" : "None"}</strong>
                </div>
              </div>

              <div className="context-section">
                <h4>Current Bridge Status</h4>
                <p className="empty-note">{selectedCitizen.aiBrainStatus.message}</p>
              </div>

              {debug && decision ? (
                <>
                  <div className="context-section">
                    <h4>Last Decision</h4>
                    <div className="context-card">
                      <span>Day {debug.decidedAtDay} {debug.decidedAtTime} · {debug.contractVersion}</span>
                      <strong>{titleCase(decision.intention)} at {destinationName}</strong>
                      <p>{decision.thought}</p>
                      <p>{decision.reason}</p>
                      <div className="decision-people-row">
                        {decision.tags.map((tag) => (
                          <span className="tag-pill" key={tag}>{tag}</span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="context-section">
                    <h4>Input Snapshot</h4>
                    <div className="detail-grid ai-compact-grid">
                      <div className="detail-card">
                        <span>Actions offered</span>
                        <strong>{debug.input.availableActions.length}</strong>
                      </div>
                      <div className="detail-card">
                        <span>Relationships</span>
                        <strong>{debug.input.relationships.length}</strong>
                      </div>
                      <div className="detail-card">
                        <span>Signals</span>
                        <strong>{debug.input.localSignals.length}</strong>
                      </div>
                      <div className="detail-card">
                        <span>Observations</span>
                        <strong>{debug.input.recentObservations.length}</strong>
                      </div>
                    </div>
                  </div>

                  <div className="context-section">
                    <h4>Validation</h4>
                    {debug.validation.warnings.length || debug.validation.repairedFields.length || debug.validation.blockedFields.length ? (
                      <ul className="detail-list">
                        {debug.validation.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                        {debug.validation.repairedFields.length ? <li>Repaired: {debug.validation.repairedFields.join(", ")}</li> : null}
                        {debug.validation.blockedFields.length ? <li>Blocked: {debug.validation.blockedFields.join(", ")}</li> : null}
                      </ul>
                    ) : (
                      <p className="empty-note">No validation repairs were needed.</p>
                    )}
                  </div>
                </>
              ) : (
                <p className="empty-note">This citizen has not produced a visible brain decision yet.</p>
              )}
            </>
          ) : (
            <p className="empty-note">Turn on AI Bridge for a citizen to monitor live AI activity here.</p>
          )}
        </section>
      </div>
    </aside>
  );
}
