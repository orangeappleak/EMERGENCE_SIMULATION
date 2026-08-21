import { useMemo, useState } from "react";
import type { SimulationState, WorldObservationKind, WorldProject, WorldProjectStatus } from "../types/simulation";

type WorldProjectsBrowserProps = {
  sim: SimulationState;
  onSelectCitizen: (citizenId: string) => void;
  onClose: () => void;
};

const STATUSES: Array<"all" | WorldProjectStatus> = ["all", "active", "blocked", "completed", "canceled"];
const KINDS: Array<"all" | WorldObservationKind> = ["all", "employment", "money", "food", "healthcare", "education", "governance", "housing", "social", "general"];

function label(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function matches(project: WorldProject, query: string) {
  if (!query) return true;
  return [
    project.title,
    project.summary,
    project.sponsorName,
    project.kind,
    project.status,
    project.phase,
    project.nextMilestone,
    project.expectedEffect,
    project.needs.join(" "),
    project.history.join(" "),
  ].join(" ").toLowerCase().includes(query);
}

export function WorldProjectsBrowser({ sim, onSelectCitizen, onClose }: WorldProjectsBrowserProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | WorldProjectStatus>("all");
  const [kind, setKind] = useState<"all" | WorldObservationKind>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const normalizedQuery = query.trim().toLowerCase();

  const projects = useMemo(() => {
    return sim.worldProjects
      .filter((project) => status === "all" || project.status === status)
      .filter((project) => kind === "all" || project.kind === kind)
      .filter((project) => matches(project, normalizedQuery));
  }, [kind, normalizedQuery, sim.worldProjects, status]);

  const selectedProject = projects.find((project) => project.id === selectedId) ?? projects[0];
  const activeCount = sim.worldProjects.filter((project) => project.status === "active" || project.status === "blocked").length;
  const sourceRequest = selectedProject ? sim.worldRequests.find((request) => request.id === selectedProject.sourceRequestId) : undefined;
  const sourceDecision = selectedProject?.sourceDecisionId
    ? sim.worldDecisions.find((decision) => decision.id === selectedProject.sourceDecisionId)
    : undefined;
  const projectOutcome = selectedProject?.outcomeId
    ? sim.worldProjectOutcomes.find((outcome) => outcome.id === selectedProject.outcomeId)
    : undefined;

  return (
    <aside className="panel world-projects-panel">
      <div className="panel-title-row">
        <div>
          <h2>World Projects</h2>
          <p className="muted">{activeCount} active town projects</p>
        </div>
        <div className="panel-title-actions">
          <span className="status-badge">{projects.length}</span>
          <button className="panel-close" type="button" onClick={onClose} aria-label="Close world projects panel">Close</button>
        </div>
      </div>

      <input
        className="people-search"
        placeholder="Find projects, sponsors, needs, milestones..."
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="decision-filter-row">
        <select value={status} onChange={(event) => setStatus(event.target.value as "all" | WorldProjectStatus)}>
          {STATUSES.map((item) => (
            <option key={item} value={item}>{item === "all" ? "All statuses" : label(item)}</option>
          ))}
        </select>
        <select value={kind} onChange={(event) => setKind(event.target.value as "all" | WorldObservationKind)}>
          {KINDS.map((item) => (
            <option key={item} value={item}>{item === "all" ? "All kinds" : label(item)}</option>
          ))}
        </select>
      </div>

      <div className="workspace-layout">
        <ol className="world-project-list workspace-list">
          {projects.length ? projects.map((project) => (
            <li key={project.id} className={`project-status-${project.status}`}>
              <button
                className={selectedProject?.id === project.id ? "workspace-list-button active" : "workspace-list-button"}
                type="button"
                onClick={() => setSelectedId(project.id)}
              >
                <div className="decision-entry-head">
                  <div>
                    <strong>{project.title}</strong>
                    <span>Day {project.day} {project.time} · {label(project.kind)} · {label(project.phase)}</span>
                  </div>
                  <em>{project.progress}%</em>
                </div>
                <p>{project.nextMilestone}</p>
                <meter min="0" max="100" value={project.progress} />
              </button>
            </li>
          )) : (
            <li className="empty-row">
              <div className="decision-entry-head">
                <div>
                  <strong>No matching projects</strong>
                  <span>Try changing the filters</span>
                </div>
                <em>Empty</em>
              </div>
              <p>No approved request has become a matching project yet.</p>
            </li>
          )}
        </ol>

        <section className="workspace-detail" aria-label="World project details">
          {selectedProject ? (
            <>
              <div className="detail-heading">
                <div>
                  <span>Day {selectedProject.day} {selectedProject.time} · {label(selectedProject.kind)} · {label(selectedProject.impact)} impact</span>
                  <h3>{selectedProject.title}</h3>
                </div>
                <em>{label(selectedProject.status)}</em>
              </div>
              <p className="detail-summary">{selectedProject.summary}</p>

              <div className="decision-entry-grid">
                <div>
                  <span>Sponsor</span>
                  <strong>
                    <button className="inline-link-button" type="button" onClick={() => onSelectCitizen(selectedProject.sponsorId)}>
                      {selectedProject.sponsorName}
                    </button>
                  </strong>
                </div>
                <div>
                  <span>Next milestone</span>
                  <strong>{selectedProject.nextMilestone}</strong>
                </div>
                <div>
                  <span>Funding</span>
                  <strong>${Math.round(selectedProject.fundingRaised).toLocaleString()} / ${selectedProject.fundingRequired.toLocaleString()}</strong>
                </div>
                <div>
                  <span>Labor</span>
                  <strong>{selectedProject.laborContributed.toFixed(1)} / {selectedProject.laborRequired} effort</strong>
                </div>
              </div>

              <div className="context-section">
                <h4>Progress</h4>
                <div className="context-card">
                  <span>{label(selectedProject.phase)}</span>
                  <meter min="0" max="100" value={selectedProject.progress} />
                  <p>{selectedProject.progress}% complete</p>
                </div>
              </div>

              {projectOutcome ? (
                <div className="context-section">
                  <h4>Outcome</h4>
                  <div className="context-card">
                    <span>Day {projectOutcome.day} {projectOutcome.time} · {label(projectOutcome.kind)}</span>
                    <strong>{projectOutcome.title}</strong>
                    <p>{projectOutcome.unlockedCapability}</p>
                    <small>{projectOutcome.visibleLabel}</small>
                  </div>
                </div>
              ) : null}

              <div className="context-section">
                <h4>Needs</h4>
                <div className="evidence-tags">
                  {selectedProject.needs.map((need) => <span key={need}>{need}</span>)}
                </div>
              </div>

              <div className="context-section">
                <h4>Origin</h4>
                <div className="context-card">
                  <strong>{sourceRequest?.title ?? "Approved request"}</strong>
                  <p>{sourceRequest?.proposal ?? selectedProject.summary}</p>
                </div>
                {sourceDecision ? (
                  <div className="context-card">
                    <span>{sourceDecision.time} · {label(sourceDecision.status)}</span>
                    <strong>{sourceDecision.title}</strong>
                    <p>{sourceDecision.effect}</p>
                  </div>
                ) : null}
              </div>

              <div className="context-section">
                <h4>People Connected</h4>
                <div className="decision-people-row">
                  {selectedProject.relatedCitizenIds.map((citizenId) => {
                    const citizen = sim.citizens.find((item) => item.id === citizenId);
                    return citizen ? (
                      <button key={citizenId} type="button" onClick={() => onSelectCitizen(citizenId)}>
                        {citizen.name}
                      </button>
                    ) : null;
                  })}
                </div>
              </div>

              <div className="context-section">
                <h4>History</h4>
                {selectedProject.history.map((item) => (
                  <div className="context-card" key={item}>
                    <p>{item}</p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="empty-note">Choose a project to inspect it.</p>
          )}
        </section>
      </div>
    </aside>
  );
}
