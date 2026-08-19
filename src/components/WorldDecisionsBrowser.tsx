import { useMemo, useState } from "react";
import type { SimulationState, WorldDecision, WorldDecisionCategory, WorldDecisionImpact, WorldDecisionStatus } from "../types/simulation";

type WorldDecisionsBrowserProps = {
  sim: SimulationState;
  onSelectCitizen: (citizenId: string) => void;
  onClose: () => void;
};

const CATEGORIES: Array<"all" | WorldDecisionCategory> = ["all", "personal", "social", "economy", "authority", "civic"];
const STATUSES: Array<"all" | WorldDecisionStatus> = ["all", "automatic", "pending", "approved", "rejected", "modified"];
const IMPACTS: Array<"all" | WorldDecisionImpact> = ["all", "high", "medium", "low"];

function label(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function matches(entry: WorldDecision, query: string) {
  if (!query) return true;
  return [
    entry.title,
    entry.summary,
    entry.actorName,
    entry.householdName,
    entry.category,
    entry.status,
    entry.impact,
    entry.reason,
    entry.effect,
  ].join(" ").toLowerCase().includes(query);
}

export function WorldDecisionsBrowser({ sim, onSelectCitizen, onClose }: WorldDecisionsBrowserProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | WorldDecisionCategory>("all");
  const [status, setStatus] = useState<"all" | WorldDecisionStatus>("all");
  const [impact, setImpact] = useState<"all" | WorldDecisionImpact>("all");
  const normalizedQuery = query.trim().toLowerCase();

  const decisions = useMemo(() => {
    return sim.worldDecisions
      .filter((entry) => category === "all" || entry.category === category)
      .filter((entry) => status === "all" || entry.status === status)
      .filter((entry) => impact === "all" || entry.impact === impact)
      .filter((entry) => matches(entry, normalizedQuery));
  }, [category, impact, normalizedQuery, sim.worldDecisions, status]);

  const pendingCount = sim.worldDecisions.filter((entry) => entry.status === "pending").length;

  return (
    <aside className="panel world-decisions-panel">
      <div className="panel-title-row">
        <div>
          <h2>World Decisions</h2>
          <p className="muted">{pendingCount} waiting for approval</p>
        </div>
        <div className="panel-title-actions">
          <span className="status-badge">{decisions.length}</span>
          <button className="panel-close" type="button" onClick={onClose} aria-label="Close world decisions panel">Close</button>
        </div>
      </div>

      <input
        className="people-search"
        placeholder="Find decisions, people, households, reasons..."
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="filter-tabs" role="tablist" aria-label="Decision categories">
        {CATEGORIES.map((item) => (
          <button
            aria-selected={category === item}
            className={category === item ? "active" : ""}
            key={item}
            role="tab"
            type="button"
            onClick={() => setCategory(item)}
          >
            {label(item)}
          </button>
        ))}
      </div>

      <div className="decision-filter-row">
        <select value={status} onChange={(event) => setStatus(event.target.value as "all" | WorldDecisionStatus)}>
          {STATUSES.map((item) => (
            <option key={item} value={item}>{item === "all" ? "All statuses" : label(item)}</option>
          ))}
        </select>
        <select value={impact} onChange={(event) => setImpact(event.target.value as "all" | WorldDecisionImpact)}>
          {IMPACTS.map((item) => (
            <option key={item} value={item}>{item === "all" ? "All impacts" : label(item)}</option>
          ))}
        </select>
      </div>

      <ol className="world-decision-list">
        {decisions.length ? decisions.map((entry) => (
          <li key={entry.id} className={`decision-impact-${entry.impact}`}>
            <div className="decision-entry-head">
              <div>
                <strong>{entry.title}</strong>
                <span>Day {entry.day} {entry.time} · {label(entry.category)}</span>
              </div>
              <em>{label(entry.status)}</em>
            </div>
            <p>{entry.summary}</p>
            <div className="decision-entry-grid">
              <div>
                <span>Reason</span>
                <strong>{entry.reason}</strong>
              </div>
              <div>
                <span>Effect</span>
                <strong>{entry.effect}</strong>
              </div>
            </div>
            {entry.relatedCitizenIds.length ? (
              <div className="decision-people-row">
                {entry.relatedCitizenIds.slice(0, 5).map((citizenId) => {
                  const citizen = sim.citizens.find((item) => item.id === citizenId);
                  return citizen ? (
                    <button key={citizenId} type="button" onClick={() => onSelectCitizen(citizenId)}>
                      {citizen.name}
                    </button>
                  ) : null;
                })}
              </div>
            ) : null}
          </li>
        )) : (
          <li>
            <div className="decision-entry-head">
              <div>
                <strong>No matching decisions</strong>
                <span>Try changing the filters</span>
              </div>
              <em>Empty</em>
            </div>
            <p>The town has not recorded an event matching this view yet.</p>
          </li>
        )}
      </ol>
    </aside>
  );
}
