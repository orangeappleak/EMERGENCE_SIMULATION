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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const normalizedQuery = query.trim().toLowerCase();

  const decisions = useMemo(() => {
    return sim.worldDecisions
      .filter((entry) => category === "all" || entry.category === category)
      .filter((entry) => status === "all" || entry.status === status)
      .filter((entry) => impact === "all" || entry.impact === impact)
      .filter((entry) => matches(entry, normalizedQuery));
  }, [category, impact, normalizedQuery, sim.worldDecisions, status]);

  const pendingCount = sim.worldDecisions.filter((entry) => entry.status === "pending").length;
  const selectedDecision = decisions.find((entry) => entry.id === selectedId) ?? decisions[0];
  const decisionMinute = selectedDecision ? timeToMinutes(selectedDecision.time) : 0;
  const relatedConversations = selectedDecision
    ? sim.conversationLog
        .filter((entry) => entry.day === selectedDecision.day)
        .filter((entry) => {
          const entryMinute = timeToMinutes(entry.time);
          const beforeDecision = entryMinute <= decisionMinute;
          const closeInTime = decisionMinute - entryMinute <= 360;
          const sameCitizen = selectedDecision.relatedCitizenIds.some((citizenId) => entry.speakerId === citizenId || entry.withId === citizenId);
          const sameLocation = selectedDecision.relatedBuildingId && entry.locationId === selectedDecision.relatedBuildingId;
          const topicMatch = [entry.topic, entry.text, entry.classification].join(" ").toLowerCase().includes(selectedDecision.category);
          return beforeDecision && closeInTime && (sameCitizen || sameLocation || topicMatch || entry.classification === "planning" || entry.classification === "serious");
        })
        .slice(0, 7)
    : [];
  const relatedTransactions = selectedDecision
    ? sim.transactionLog
        .filter((entry) => entry.day === selectedDecision.day)
        .filter((entry) => {
          const closeInTime = Math.abs(timeToMinutes(entry.time) - decisionMinute) <= 240;
          const sameCitizen = entry.citizenId ? selectedDecision.relatedCitizenIds.includes(entry.citizenId) || selectedDecision.actorId === entry.citizenId : false;
          const sameHousehold = entry.householdId && entry.householdId === selectedDecision.householdId;
          const sameBuilding = entry.buildingId && entry.buildingId === selectedDecision.relatedBuildingId;
          return closeInTime && (sameCitizen || sameHousehold || sameBuilding);
        })
        .slice(0, 5)
    : [];

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

      <div className="workspace-layout">
        <ol className="world-decision-list workspace-list">
          {decisions.length ? decisions.map((entry) => (
            <li key={entry.id} className={`decision-impact-${entry.impact}`}>
              <button
                className={selectedDecision?.id === entry.id ? "workspace-list-button active" : "workspace-list-button"}
                type="button"
                onClick={() => setSelectedId(entry.id)}
              >
                <div className="decision-entry-head">
                  <div>
                    <strong>{entry.title}</strong>
                    <span>Day {entry.day} {entry.time} · {label(entry.category)}</span>
                  </div>
                  <em>{label(entry.status)}</em>
                </div>
                <p>{entry.summary}</p>
              </button>
            </li>
          )) : (
            <li className="empty-row">
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

        <section className="workspace-detail" aria-label="Decision details">
          {selectedDecision ? (
            <>
              <div className="detail-heading">
                <div>
                  <span>Day {selectedDecision.day} {selectedDecision.time} · {label(selectedDecision.category)} · {label(selectedDecision.impact)} impact</span>
                  <h3>{selectedDecision.title}</h3>
                </div>
                <em>{label(selectedDecision.status)}</em>
              </div>
              <p className="detail-summary">{selectedDecision.summary}</p>

              <div className="decision-entry-grid">
                <div>
                  <span>Reason</span>
                  <strong>{selectedDecision.reason}</strong>
                </div>
                <div>
                  <span>Effect</span>
                  <strong>{selectedDecision.effect}</strong>
                </div>
              </div>

              {selectedDecision.relatedCitizenIds.length ? (
                <div className="context-section">
                  <h4>People Involved</h4>
                  <div className="decision-people-row">
                    {selectedDecision.relatedCitizenIds.map((citizenId) => {
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
                <h4>Conversations That Fed Into It</h4>
                {relatedConversations.length ? relatedConversations.map((entry) => (
                  <div className="context-card" key={entry.id}>
                    <span>{entry.time} · {label(entry.classification)} · {entry.topic}</span>
                    <strong>{entry.speakerName ?? "Someone"} with {entry.withName}</strong>
                    <p>{entry.text}</p>
                    <small>{entry.classificationReason}</small>
                  </div>
                )) : <p className="empty-note">No earlier conversations clearly connect to this decision yet.</p>}
              </div>

              <div className="context-section">
                <h4>Money Around This Decision</h4>
                {relatedTransactions.length ? relatedTransactions.map((entry) => (
                  <div className="context-card" key={entry.id}>
                    <span>{entry.time} · {label(entry.category)}</span>
                    <strong>${Math.round(entry.amount).toLocaleString()} · {entry.fromName} {"->"} {entry.toName}</strong>
                    <p>{entry.note}</p>
                  </div>
                )) : <p className="empty-note">No nearby transactions were connected to this decision.</p>}
              </div>
            </>
          ) : (
            <p className="empty-note">Choose a decision to inspect the story around it.</p>
          )}
        </section>
      </div>
    </aside>
  );
}

function timeToMinutes(time: string) {
  const [hours = "0", minutes = "0"] = time.split(":");
  return Number(hours) * 60 + Number(minutes);
}
