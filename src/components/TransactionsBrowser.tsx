import { useMemo, useState } from "react";
import type { EconomyTransaction, SimulationState, TransactionCategory } from "../types/simulation";

type TransactionsBrowserProps = {
  sim: SimulationState;
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

export function TransactionsBrowser({ sim, onClose }: TransactionsBrowserProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | TransactionCategory>("all");
  const normalizedQuery = query.trim().toLowerCase();

  const transactions = useMemo(() => {
    return sim.transactionLog
      .filter((entry) => category === "all" || entry.category === category)
      .filter((entry) => matches(entry, normalizedQuery));
  }, [category, normalizedQuery, sim.transactionLog]);

  const totalInView = transactions.reduce((sum, entry) => sum + entry.amount, 0);

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

      <ol className="ledger-list">
        {transactions.length ? transactions.map((entry) => (
          <li key={entry.id}>
            <div>
              <strong>${Math.round(entry.amount).toLocaleString()}</strong>
              <span>{label(entry.category)} · Day {entry.day} {entry.time}</span>
            </div>
            <p>{entry.fromName} {"->"} {entry.toName}</p>
            <small>{entry.note}</small>
          </li>
        )) : (
          <li>
            <div>
              <strong>$0</strong>
              <span>No matching transactions</span>
            </div>
            <p>Nothing matches this ledger view yet.</p>
          </li>
        )}
      </ol>
    </aside>
  );
}
