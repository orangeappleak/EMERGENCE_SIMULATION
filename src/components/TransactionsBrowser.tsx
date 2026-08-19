import { useMemo, useState } from "react";
import { BUILDINGS } from "../simulation/constants";
import type { EconomyTransaction, SimulationState, TransactionCategory, WorldDecision } from "../types/simulation";

type TransactionsBrowserProps = {
  sim: SimulationState;
  onSelectCitizen: (citizenId: string) => void;
  onClose: () => void;
};

const CATEGORIES: Array<"all" | TransactionCategory> = ["all", "wage", "market", "clinic", "rent", "living"];

function label(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function matches(entry: EconomyTransaction, query: string) {
  if (!query) return true;
  return [
    entry.category,
    entry.fromName,
    entry.toName,
    entry.note,
    entry.time,
    String(entry.amount),
  ].join(" ").toLowerCase().includes(query);
}

function timeToMinutes(time: string) {
  const [hours = "0", minutes = "0"] = time.split(":");
  return Number(hours) * 60 + Number(minutes);
}

function relatedDecisions(transaction: EconomyTransaction, decisions: WorldDecision[]) {
  const transactionTime = timeToMinutes(transaction.time);
  return decisions
    .filter((decision) => decision.day === transaction.day)
    .filter((decision) => {
      const sameCitizen = transaction.citizenId ? decision.relatedCitizenIds.includes(transaction.citizenId) || decision.actorId === transaction.citizenId : false;
      const sameHousehold = transaction.householdId && decision.householdId === transaction.householdId;
      const sameBuilding = transaction.buildingId && decision.relatedBuildingId === transaction.buildingId;
      const closeInTime = Math.abs(timeToMinutes(decision.time) - transactionTime) <= 180;
      return closeInTime && (sameCitizen || sameHousehold || sameBuilding || decision.category === "economy");
    })
    .slice(0, 4);
}

export function TransactionsBrowser({ sim, onSelectCitizen, onClose }: TransactionsBrowserProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | TransactionCategory>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const normalizedQuery = query.trim().toLowerCase();

  const transactions = useMemo(() => {
    return sim.transactionLog
      .filter((entry) => category === "all" || entry.category === category)
      .filter((entry) => matches(entry, normalizedQuery));
  }, [category, normalizedQuery, sim.transactionLog]);

  const totalInView = transactions.reduce((sum, entry) => sum + entry.amount, 0);
  const selectedTransaction = transactions.find((entry) => entry.id === selectedId) ?? transactions[0];
  const selectedCitizen = selectedTransaction?.citizenId ? sim.citizens.find((citizen) => citizen.id === selectedTransaction.citizenId) : null;
  const selectedBuilding = selectedTransaction?.buildingId ? BUILDINGS.find((building) => building.id === selectedTransaction.buildingId) : null;
  const transactionDecisions = selectedTransaction ? relatedDecisions(selectedTransaction, sim.worldDecisions) : [];
  const transactionConversations = selectedTransaction
    ? sim.conversationLog
        .filter((entry) => entry.day === selectedTransaction.day)
        .filter((entry) => {
          const sameCitizen = selectedTransaction.citizenId && (entry.speakerId === selectedTransaction.citizenId || entry.withId === selectedTransaction.citizenId);
          const sameLocation = selectedTransaction.buildingId && entry.locationId === selectedTransaction.buildingId;
          const beforeOrNear = timeToMinutes(entry.time) <= timeToMinutes(selectedTransaction.time) + 30;
          const closeInTime = Math.abs(timeToMinutes(selectedTransaction.time) - timeToMinutes(entry.time)) <= 240;
          return beforeOrNear && closeInTime && (sameCitizen || sameLocation);
        })
        .slice(0, 5)
    : [];

  return (
    <aside className="panel transactions-panel">
      <div className="panel-title-row">
        <div>
          <h2>Transactions</h2>
          <p className="muted">${Math.round(totalInView).toLocaleString()} in visible movement</p>
        </div>
        <div className="panel-title-actions">
          <span className="status-badge">{transactions.length}</span>
          <button className="panel-close" type="button" onClick={onClose} aria-label="Close transactions panel">Close</button>
        </div>
      </div>

      <input
        className="people-search"
        placeholder="Find people, places, wages, rent, clinic..."
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="filter-tabs" role="tablist" aria-label="Transaction categories">
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

      <div className="workspace-layout">
        <ol className="ledger-list workspace-list">
          {transactions.length ? transactions.map((entry) => (
            <li key={entry.id}>
              <button
                className={selectedTransaction?.id === entry.id ? "workspace-list-button active" : "workspace-list-button"}
                type="button"
                onClick={() => setSelectedId(entry.id)}
              >
                <div>
                  <strong>${Math.round(entry.amount).toLocaleString()}</strong>
                  <span>{label(entry.category)} · Day {entry.day} {entry.time}</span>
                </div>
                <p>{entry.fromName} {"->"} {entry.toName}</p>
                <small>{entry.note}</small>
              </button>
            </li>
          )) : (
            <li className="empty-row">
              <div>
                <strong>$0</strong>
                <span>No matching transactions</span>
              </div>
              <p>Nothing matches this ledger view yet.</p>
            </li>
          )}
        </ol>

        <section className="workspace-detail" aria-label="Transaction details">
          {selectedTransaction ? (
            <>
              <div className="detail-heading">
                <div>
                  <span>{label(selectedTransaction.category)} · Day {selectedTransaction.day} {selectedTransaction.time}</span>
                  <h3>${Math.round(selectedTransaction.amount).toLocaleString()}</h3>
                </div>
                {selectedCitizen ? (
                  <button type="button" onClick={() => onSelectCitizen(selectedCitizen.id)}>
                    {selectedCitizen.name}
                  </button>
                ) : null}
              </div>

              <div className="detail-card">
                <span>Movement</span>
                <strong>{selectedTransaction.fromName} {"->"} {selectedTransaction.toName}</strong>
                <p>{selectedTransaction.note}</p>
              </div>

              <div className="detail-grid">
                <div className="detail-card">
                  <span>Place</span>
                  <strong>{selectedBuilding?.name ?? "Town ledger"}</strong>
                </div>
                <div className="detail-card">
                  <span>Cash after now</span>
                  <strong>{selectedCitizen ? `$${Math.round(selectedCitizen.cash).toLocaleString()}` : "Shared account"}</strong>
                </div>
              </div>

              <div className="detail-card">
                <span>Thought context</span>
                <strong>{selectedCitizen?.currentThought ?? "No citizen thought attached to this transaction."}</strong>
                <p>This is the citizen's current thought. The nearby logs below show what likely shaped this money move.</p>
              </div>

              <div className="context-section">
                <h4>Nearby Decisions</h4>
                {transactionDecisions.length ? transactionDecisions.map((decision) => (
                  <div className="context-card" key={decision.id}>
                    <span>{decision.time} · {label(decision.category)}</span>
                    <strong>{decision.title}</strong>
                    <p>{decision.reason}</p>
                  </div>
                )) : <p className="empty-note">No related decisions were close enough to this transaction.</p>}
              </div>

              <div className="context-section">
                <h4>Nearby Conversations</h4>
                {transactionConversations.length ? transactionConversations.map((entry) => (
                  <div className="context-card" key={entry.id}>
                    <span>{entry.time} · {label(entry.classification)} · {entry.locationName ?? "somewhere in town"}</span>
                    <strong>{entry.speakerName ?? "Someone"} with {entry.withName}</strong>
                    <p>{entry.text}</p>
                  </div>
                )) : <p className="empty-note">No nearby conversations were found for this money move.</p>}
              </div>
            </>
          ) : (
            <p className="empty-note">Choose a transaction to inspect the money trail.</p>
          )}
        </section>
      </div>
    </aside>
  );
}
