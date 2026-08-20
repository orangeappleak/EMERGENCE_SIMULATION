import { useMemo, useState } from "react";
import type { SimulationState, WorldObservation, WorldObservationKind, WorldSignal, WorldSignalStatus } from "../types/simulation";

type WorldSignalsBrowserProps = {
  sim: SimulationState;
  onSelectCitizen: (citizenId: string) => void;
  onClose: () => void;
};

const KINDS: Array<"all" | WorldObservationKind> = [
  "all",
  "money",
  "healthcare",
  "employment",
  "education",
  "food",
  "governance",
  "movement",
  "weather",
  "social",
  "housing",
  "general",
];
const STATUSES: Array<"all" | WorldSignalStatus> = ["all", "forming", "watched", "strong", "promoted"];

function label(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function matches(signal: WorldSignal, observations: WorldObservation[], query: string) {
  if (!query) return true;
  return [
    signal.title,
    signal.kind,
    signal.status,
    signal.tags.join(" "),
    signal.evidence.join(" "),
    observations.map((entry) => [
      entry.summary,
      entry.detail,
      entry.citizenName,
      entry.householdName,
      entry.buildingName,
      entry.tags.join(" "),
    ].join(" ")).join(" "),
  ].join(" ").toLowerCase().includes(query);
}

export function WorldSignalsBrowser({ sim, onSelectCitizen, onClose }: WorldSignalsBrowserProps) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | WorldObservationKind>("all");
  const [status, setStatus] = useState<"all" | WorldSignalStatus>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const normalizedQuery = query.trim().toLowerCase();

  const observationsById = useMemo(() => {
    return new Map(sim.worldObservations.map((entry) => [entry.id, entry]));
  }, [sim.worldObservations]);

  const signals = useMemo(() => {
    return sim.worldSignals
      .filter((entry) => kind === "all" || entry.kind === kind)
      .filter((entry) => status === "all" || entry.status === status)
      .filter((entry) => matches(
        entry,
        entry.observationIds.map((id) => observationsById.get(id)).filter(Boolean) as WorldObservation[],
        normalizedQuery,
      ));
  }, [kind, normalizedQuery, observationsById, sim.worldSignals, status]);

  const selectedSignal = signals.find((entry) => entry.id === selectedId) ?? signals[0];
  const selectedObservations = selectedSignal
    ? selectedSignal.observationIds.map((id) => observationsById.get(id)).filter(Boolean) as WorldObservation[]
    : [];
  const strongCount = sim.worldSignals.filter((entry) => entry.status === "strong").length;

  return (
    <aside className="panel world-signals-panel">
      <div className="panel-title-row">
        <div>
          <h2>World Signals</h2>
          <p className="muted">{strongCount} strong patterns forming</p>
        </div>
        <div className="panel-title-actions">
          <span className="status-badge">{signals.length}</span>
          <button className="panel-close" type="button" onClick={onClose} aria-label="Close world signals panel">Close</button>
        </div>
      </div>

      <input
        className="people-search"
        placeholder="Find signals, people, places, evidence..."
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="filter-tabs" role="tablist" aria-label="Signal types">
        {KINDS.map((item) => (
          <button
            aria-selected={kind === item}
            className={kind === item ? "active" : ""}
            key={item}
            role="tab"
            type="button"
            onClick={() => setKind(item)}
          >
            {label(item)}
          </button>
        ))}
      </div>

      <select value={status} onChange={(event) => setStatus(event.target.value as "all" | WorldSignalStatus)}>
        {STATUSES.map((item) => (
          <option key={item} value={item}>{item === "all" ? "All signal strength" : label(item)}</option>
        ))}
      </select>

      <div className="workspace-layout">
        <ol className="world-signal-list workspace-list">
          {signals.length ? signals.map((entry) => (
            <li key={entry.id} className={`signal-status-${entry.status}`}>
              <button
                className={selectedSignal?.id === entry.id ? "workspace-list-button active" : "workspace-list-button"}
                type="button"
                onClick={() => setSelectedId(entry.id)}
              >
                <div className="decision-entry-head">
                  <div>
                    <strong>{entry.title}</strong>
                    <span>{label(entry.kind)} · updated day {entry.lastUpdatedDay} {entry.lastUpdatedTime}</span>
                  </div>
                  <em>{label(entry.status)}</em>
                </div>
                <p>Confidence {entry.confidence}% · severity {entry.severity}% · maturity {entry.maturity}%</p>
              </button>
            </li>
          )) : (
            <li className="empty-row">
              <div className="decision-entry-head">
                <div>
                  <strong>No matching signals</strong>
                  <span>Try changing the filters</span>
                </div>
                <em>Empty</em>
              </div>
              <p>The town has not noticed a matching pattern yet.</p>
            </li>
          )}
        </ol>

        <section className="workspace-detail" aria-label="Signal details">
          {selectedSignal ? (
            <>
              <div className="detail-heading">
                <div>
                  <span>{label(selectedSignal.kind)} · first seen day {selectedSignal.firstSeenDay}</span>
                  <h3>{selectedSignal.title}</h3>
                </div>
                <em>{label(selectedSignal.status)}</em>
              </div>

              <div className="detail-grid">
                <div className="detail-card">
                  <span>Confidence</span>
                  <strong>{selectedSignal.confidence}%</strong>
                </div>
                <div className="detail-card">
                  <span>Severity</span>
                  <strong>{selectedSignal.severity}%</strong>
                </div>
                <div className="detail-card">
                  <span>Maturity</span>
                  <strong>{selectedSignal.maturity}%</strong>
                </div>
                <div className="detail-card">
                  <span>Observations</span>
                  <strong>{selectedSignal.observationIds.length}</strong>
                </div>
              </div>

              <div className="context-section">
                <h4>Evidence</h4>
                {selectedSignal.evidence.length ? selectedSignal.evidence.map((entry) => (
                  <p className="empty-note" key={entry}>{entry}</p>
                )) : <p className="empty-note">No evidence attached yet.</p>}
              </div>

              {selectedSignal.affectedCitizenIds.length ? (
                <div className="context-section">
                  <h4>People Connected</h4>
                  <div className="decision-people-row">
                    {selectedSignal.affectedCitizenIds.map((citizenId) => {
                      const citizen = sim.citizens.find((item) => item.id === citizenId);
                      return citizen ? (
                        <button key={citizenId} type="button" onClick={() => onSelectCitizen(citizenId)}>
                          {citizen.name}
                        </button>
                      ) : null;
                    })}
                  </div>
                </div>
              ) : null}

              <div className="context-section">
                <h4>Recent Observations</h4>
                {selectedObservations.length ? selectedObservations.map((entry) => (
                  <div className="context-card" key={entry.id}>
                    <span>Day {entry.day} {entry.time} · {label(entry.source)} · {label(entry.kind)}</span>
                    <strong>{entry.summary}</strong>
                    <p>{entry.detail}</p>
                    {entry.citizenId ? (
                      <button type="button" onClick={() => onSelectCitizen(entry.citizenId as string)}>
                        {entry.citizenName}
                      </button>
                    ) : null}
                  </div>
                )) : <p className="empty-note">This signal has no visible observation trail yet.</p>}
              </div>
            </>
          ) : (
            <p className="empty-note">Choose a signal to inspect what the town is starting to notice.</p>
          )}
        </section>
      </div>
    </aside>
  );
}
