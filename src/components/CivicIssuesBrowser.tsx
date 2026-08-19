import { useMemo, useState } from "react";
import type { CivicIssue, CivicIssueKind, CivicIssueStatus, SimulationState } from "../types/simulation";

type CivicIssuesBrowserProps = {
  sim: SimulationState;
  onSelectCitizen: (citizenId: string) => void;
  onClose: () => void;
};

const KINDS: Array<"all" | CivicIssueKind> = ["all", "healthcare", "money", "employment", "education", "governance", "food"];
const STATUSES: Array<"all" | CivicIssueStatus> = ["all", "watching", "active", "urgent", "resolved"];

function label(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function matches(issue: CivicIssue, query: string) {
  if (!query) return true;
  return [
    issue.title,
    issue.kind,
    issue.status,
    ...issue.evidence,
  ].join(" ").toLowerCase().includes(query);
}

export function CivicIssuesBrowser({ sim, onSelectCitizen, onClose }: CivicIssuesBrowserProps) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | CivicIssueKind>("all");
  const [status, setStatus] = useState<"all" | CivicIssueStatus>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const normalizedQuery = query.trim().toLowerCase();

  const issues = useMemo(() => {
    return sim.civicIssues
      .filter((issue) => kind === "all" || issue.kind === kind)
      .filter((issue) => status === "all" || issue.status === status)
      .filter((issue) => matches(issue, normalizedQuery))
      .sort((a, b) => b.severity + b.awareness * 0.35 - (a.severity + a.awareness * 0.35));
  }, [kind, normalizedQuery, sim.civicIssues, status]);

  const urgentCount = sim.civicIssues.filter((issue) => issue.status === "urgent").length;
  const selectedIssue = issues.find((issue) => issue.id === selectedId) ?? issues[0];
  const issueDecisions = selectedIssue
    ? sim.worldDecisions
        .filter((decision) => decision.category === "civic" || decision.category === "economy" || decision.summary.toLowerCase().includes(selectedIssue.kind))
        .filter((decision) => {
          const sameCitizen = selectedIssue.affectedCitizenIds.some((citizenId) => decision.relatedCitizenIds.includes(citizenId) || decision.actorId === citizenId);
          return sameCitizen || decision.reason.toLowerCase().includes(selectedIssue.kind) || decision.effect.toLowerCase().includes(selectedIssue.kind);
        })
        .slice(0, 5)
    : [];
  const issueConversations = selectedIssue
    ? sim.conversationLog
        .filter((entry) => {
          const sameCitizen = selectedIssue.affectedCitizenIds.some((citizenId) => entry.speakerId === citizenId || entry.withId === citizenId);
          const text = [entry.topic, entry.text, entry.classificationReason].join(" ").toLowerCase();
          return sameCitizen && (text.includes(selectedIssue.kind) || text.includes("money") || text.includes("clinic") || entry.classification === "serious" || entry.classification === "planning");
        })
        .slice(0, 6)
    : [];

  return (
    <aside className="panel civic-issues-panel">
      <div className="panel-title-row">
        <div>
          <h2>Civic Issues</h2>
          <p className="muted">{urgentCount} urgent town problems</p>
        </div>
        <div className="panel-title-actions">
          <span className="status-badge">{issues.length}</span>
          <button className="panel-close" type="button" onClick={onClose} aria-label="Close civic issues panel">Close</button>
        </div>
      </div>

      <input
        className="people-search"
        placeholder="Find issues, evidence, pressure..."
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="filter-tabs" role="tablist" aria-label="Civic issue kinds">
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

      <select className="topic-select" value={status} onChange={(event) => setStatus(event.target.value as "all" | CivicIssueStatus)}>
        {STATUSES.map((item) => (
          <option key={item} value={item}>{item === "all" ? "All statuses" : label(item)}</option>
        ))}
      </select>

      <div className="workspace-layout">
        <ol className="civic-issue-list workspace-list">
          {issues.length ? issues.map((issue) => (
            <li key={issue.id} className={`issue-status-${issue.status}`}>
              <button
                className={selectedIssue?.id === issue.id ? "workspace-list-button active" : "workspace-list-button"}
                type="button"
                onClick={() => setSelectedId(issue.id)}
              >
                <div className="issue-entry-head">
                  <div>
                    <strong>{issue.title}</strong>
                    <span>{label(issue.kind)} · updated day {issue.lastUpdatedDay} {issue.lastUpdatedTime}</span>
                  </div>
                  <em>{label(issue.status)}</em>
                </div>
                <div className="mini-meter-row">
                  <span>Severity {Math.round(issue.severity)}%</span>
                  <meter min="0" max="100" value={issue.severity} />
                </div>
              </button>
            </li>
          )) : (
            <li className="empty-row">
              <div className="issue-entry-head">
                <div>
                  <strong>No civic issues yet</strong>
                  <span>The town has not recognized a repeated problem matching this view.</span>
                </div>
                <em>Watching</em>
              </div>
            </li>
          )}
        </ol>

        <section className="workspace-detail" aria-label="Civic issue details">
          {selectedIssue ? (
            <>
              <div className="detail-heading">
                <div>
                  <span>{label(selectedIssue.kind)} · first seen day {selectedIssue.firstSeenDay}</span>
                  <h3>{selectedIssue.title}</h3>
                </div>
                <em>{label(selectedIssue.status)}</em>
              </div>

              <div className="issue-meter-grid">
                <label>
                  Severity
                  <meter min="0" max="100" value={selectedIssue.severity} />
                  <strong>{Math.round(selectedIssue.severity)}%</strong>
                </label>
                <label>
                  Awareness
                  <meter min="0" max="100" value={selectedIssue.awareness} />
                  <strong>{Math.round(selectedIssue.awareness)}%</strong>
                </label>
              </div>

              <div className="context-section">
                <h4>Evidence</h4>
                <ul className="issue-evidence-list">
                  {selectedIssue.evidence.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>

              {selectedIssue.affectedCitizenIds.length ? (
                <div className="context-section">
                  <h4>Affected People</h4>
                  <div className="decision-people-row">
                    {selectedIssue.affectedCitizenIds.slice(0, 12).map((citizenId) => {
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
                <h4>Related Decisions</h4>
                {issueDecisions.length ? issueDecisions.map((decision) => (
                  <div className="context-card" key={decision.id}>
                    <span>{decision.time} · {label(decision.category)} · {label(decision.status)}</span>
                    <strong>{decision.title}</strong>
                    <p>{decision.summary}</p>
                  </div>
                )) : <p className="empty-note">No decisions have clearly attached themselves to this issue yet.</p>}
              </div>

              <div className="context-section">
                <h4>Related Conversations</h4>
                {issueConversations.length ? issueConversations.map((entry) => (
                  <div className="context-card" key={entry.id}>
                    <span>{entry.time} · {label(entry.classification)} · {entry.topic}</span>
                    <strong>{entry.speakerName ?? "Someone"} with {entry.withName}</strong>
                    <p>{entry.text}</p>
                  </div>
                )) : <p className="empty-note">No citizen conversations are tied strongly to this issue yet.</p>}
              </div>
            </>
          ) : (
            <p className="empty-note">Choose an issue to inspect what the town has noticed.</p>
          )}
        </section>
      </div>
    </aside>
  );
}
