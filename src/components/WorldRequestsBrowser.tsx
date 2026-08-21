import { useMemo, useState } from "react";
import type { SimulationState, WorldObservationKind, WorldRequest, WorldRequestStatus } from "../types/simulation";

type WorldRequestsBrowserProps = {
  sim: SimulationState;
  onSelectCitizen: (citizenId: string) => void;
  onResolveRequest: (requestId: string, status: "approved" | "denied") => void;
  onClose: () => void;
};

const STATUSES: Array<"all" | WorldRequestStatus> = ["all", "pending", "approved", "denied"];
const KINDS: Array<"all" | WorldObservationKind> = ["all", "employment", "money", "food", "healthcare", "education", "governance", "housing", "social", "general"];

function label(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function matches(request: WorldRequest, query: string) {
  if (!query) return true;
  return [
    request.title,
    request.proposal,
    request.requestedByName,
    request.requestedTo,
    request.kind,
    request.status,
    request.expectedEffect,
    request.approvalReason,
    ...(request.evidence ?? []),
    ...(request.needs ?? []),
  ].join(" ").toLowerCase().includes(query);
}

export function WorldRequestsBrowser({ sim, onSelectCitizen, onResolveRequest, onClose }: WorldRequestsBrowserProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | WorldRequestStatus>("all");
  const [kind, setKind] = useState<"all" | WorldObservationKind>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const normalizedQuery = query.trim().toLowerCase();

  const requests = useMemo(() => {
    return sim.worldRequests
      .filter((request) => status === "all" || request.status === status)
      .filter((request) => kind === "all" || request.kind === kind)
      .filter((request) => matches(request, normalizedQuery));
  }, [kind, normalizedQuery, sim.worldRequests, status]);

  const selectedRequest = requests.find((request) => request.id === selectedId) ?? requests[0];
  const pendingCount = sim.worldRequests.filter((request) => request.status === "pending").length;
  const relatedDecisions = selectedRequest
    ? sim.worldDecisions.filter((decision) => (
        decision.actorId === selectedRequest.requestedById
        && decision.title.toLowerCase().includes(selectedRequest.title.toLowerCase())
      )).slice(0, 4)
    : [];

  return (
    <aside className="panel world-requests-panel">
      <div className="panel-title-row">
        <div>
          <h2>World Requests</h2>
          <p className="muted">{pendingCount} waiting for your approval</p>
        </div>
        <div className="panel-title-actions">
          <span className="status-badge">{requests.length}</span>
          <button className="panel-close" type="button" onClick={onClose} aria-label="Close world requests panel">Close</button>
        </div>
      </div>

      <input
        className="people-search"
        placeholder="Find requests, people, evidence, needs..."
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="decision-filter-row">
        <select value={status} onChange={(event) => setStatus(event.target.value as "all" | WorldRequestStatus)}>
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
        <ol className="world-request-list workspace-list">
          {requests.length ? requests.map((request) => (
            <li key={request.id} className={`request-status-${request.status}`}>
              <button
                className={selectedRequest?.id === request.id ? "workspace-list-button active" : "workspace-list-button"}
                type="button"
                onClick={() => setSelectedId(request.id)}
              >
                <div className="decision-entry-head">
                  <div>
                    <strong>{request.title}</strong>
                    <span>Day {request.day} {request.time} · {label(request.kind)}</span>
                  </div>
                  <em>{label(request.status)}</em>
                </div>
                <p>{request.proposal}</p>
              </button>
            </li>
          )) : (
            <li className="empty-row">
              <div className="decision-entry-head">
                <div>
                  <strong>No matching requests</strong>
                  <span>Try changing the filters</span>
                </div>
                <em>Empty</em>
              </div>
              <p>No citizen or town request matches this view yet.</p>
            </li>
          )}
        </ol>

        <section className="workspace-detail" aria-label="World request details">
          {selectedRequest ? (
            <>
              <div className="detail-heading">
                <div>
                  <span>Day {selectedRequest.day} {selectedRequest.time} · {label(selectedRequest.kind)} · {label(selectedRequest.impact)} impact</span>
                  <h3>{selectedRequest.title}</h3>
                </div>
                <em>{label(selectedRequest.status)}</em>
              </div>
              <p className="detail-summary">{selectedRequest.proposal}</p>

              <div className="request-action-row">
                <button
                  className="approve-request"
                  disabled={selectedRequest.status !== "pending"}
                  type="button"
                  onClick={() => onResolveRequest(selectedRequest.id, "approved")}
                >
                  Approve
                </button>
                <button
                  className="deny-request"
                  disabled={selectedRequest.status !== "pending"}
                  type="button"
                  onClick={() => onResolveRequest(selectedRequest.id, "denied")}
                >
                  Deny
                </button>
              </div>

              <div className="decision-entry-grid">
                <div>
                  <span>Requested by</span>
                  <strong>
                    <button className="inline-link-button" type="button" onClick={() => onSelectCitizen(selectedRequest.requestedById)}>
                      {selectedRequest.requestedByName}
                    </button>
                  </strong>
                </div>
                <div>
                  <span>Requested to</span>
                  <strong>{selectedRequest.requestedTo}</strong>
                </div>
                <div>
                  <span>Why approval is needed</span>
                  <strong>{selectedRequest.approvalReason}</strong>
                </div>
                <div>
                  <span>Expected effect</span>
                  <strong>{selectedRequest.expectedEffect}</strong>
                </div>
              </div>

              <div className="context-section">
                <h4>Needs</h4>
                <div className="evidence-tags">
                  {selectedRequest.needs.map((need) => <span key={need}>{need}</span>)}
                </div>
              </div>

              <div className="context-section">
                <h4>Evidence</h4>
                {selectedRequest.evidence.length ? selectedRequest.evidence.map((item) => (
                  <div className="context-card" key={item}>
                    <p>{item}</p>
                  </div>
                )) : <p className="empty-note">No evidence has been attached to this request yet.</p>}
              </div>

              {selectedRequest.resolutionNote ? (
                <div className="context-section">
                  <h4>Resolution</h4>
                  <div className="context-card">
                    <span>Day {selectedRequest.resolvedDay} {selectedRequest.resolvedTime}</span>
                    <p>{selectedRequest.resolutionNote}</p>
                  </div>
                </div>
              ) : null}

              <div className="context-section">
                <h4>Related Decisions</h4>
                {relatedDecisions.length ? relatedDecisions.map((decision) => (
                  <div className="context-card" key={decision.id}>
                    <span>{decision.time} · {label(decision.status)}</span>
                    <strong>{decision.title}</strong>
                    <p>{decision.effect}</p>
                  </div>
                )) : <p className="empty-note">No approval decision has been recorded for this request yet.</p>}
              </div>
            </>
          ) : (
            <p className="empty-note">Choose a request to inspect it.</p>
          )}
        </section>
      </div>
    </aside>
  );
}
