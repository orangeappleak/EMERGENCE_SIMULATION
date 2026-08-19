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
  const normalizedQuery = query.trim().toLowerCase();

  const issues = useMemo(() => {
    return sim.civicIssues
      .filter((issue) => kind === "all" || issue.kind === kind)
      .filter((issue) => status === "all" || issue.status === status)
      .filter((issue) => matches(issue, normalizedQuery))
      .sort((a, b) => b.severity + b.awareness * 0.35 - (a.severity + a.awareness * 0.35));
  }, [kind, normalizedQuery, sim.civicIssues, status]);

  const urgentCount = sim.civicIssues.filter((issue) => issue.status === "urgent").length;

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

      <ol className="civic-issue-list">
        {issues.length ? issues.map((issue) => (
          <li key={issue.id} className={`issue-status-${issue.status}`}>
            <div className="issue-entry-head">
              <div>
                <strong>{issue.title}</strong>
                <span>{label(issue.kind)} · first seen day {issue.firstSeenDay} · updated day {issue.lastUpdatedDay} {issue.lastUpdatedTime}</span>
              </div>
              <em>{label(issue.status)}</em>
            </div>

            <div className="issue-meter-grid">
              <label>
                Severity
                <meter min="0" max="100" value={issue.severity} />
                <strong>{Math.round(issue.severity)}%</strong>
              </label>
              <label>
                Awareness
                <meter min="0" max="100" value={issue.awareness} />
                <strong>{Math.round(issue.awareness)}%</strong>
              </label>
            </div>

            <ul className="issue-evidence-list">
              {issue.evidence.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>

            {issue.affectedCitizenIds.length ? (
              <div className="decision-people-row">
                {issue.affectedCitizenIds.slice(0, 7).map((citizenId) => {
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
    </aside>
  );
}
