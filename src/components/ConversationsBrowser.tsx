import { useMemo, useState } from "react";
import type { ConversationClassification, ConversationEntry, ConversationTopic, SimulationState } from "../types/simulation";

type ConversationsBrowserProps = {
  sim: SimulationState;
  onSelectCitizen: (citizenId: string) => void;
};

const CLASSIFICATIONS: Array<"all" | ConversationClassification> = ["all", "casual", "serious", "secretive", "supportive", "planning"];
const TOPICS: Array<"all" | ConversationTopic> = ["all", "daily life", "workplace gossip", "people gossip", "money stress", "family", "school", "future plans", "personal problem", "rumor"];

function matches(entry: ConversationEntry, query: string) {
  if (!query) return true;
  const text = [
    entry.speakerName,
    entry.withName,
    entry.topic,
    entry.classification,
    entry.locationName,
    entry.locationSlotName,
    entry.text,
  ].join(" ").toLowerCase();
  return text.includes(query);
}

function label(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function ConversationsBrowser({ sim, onSelectCitizen }: ConversationsBrowserProps) {
  const [query, setQuery] = useState("");
  const [classification, setClassification] = useState<"all" | ConversationClassification>("all");
  const [topic, setTopic] = useState<"all" | ConversationTopic>("all");
  const normalizedQuery = query.trim().toLowerCase();

  const conversations = useMemo(() => {
    return sim.conversationLog
      .filter((entry) => entry.day === sim.day)
      .filter((entry) => classification === "all" || entry.classification === classification)
      .filter((entry) => topic === "all" || entry.topic === topic)
      .filter((entry) => matches(entry, normalizedQuery));
  }, [classification, normalizedQuery, sim.conversationLog, sim.day, sim.totalConversations, topic]);

  const tree = useMemo(() => {
    const grouped = new Map<ConversationClassification, Map<ConversationTopic, ConversationEntry[]>>();
    for (const entry of conversations) {
      const byTopic = grouped.get(entry.classification) ?? new Map<ConversationTopic, ConversationEntry[]>();
      const items = byTopic.get(entry.topic) ?? [];
      items.push(entry);
      byTopic.set(entry.topic, items);
      grouped.set(entry.classification, byTopic);
    }
    return Array.from(grouped.entries());
  }, [conversations]);

  return (
    <aside className="panel conversations-panel">
      <div className="panel-title-row">
        <h2>Conversations</h2>
        <span className="status-badge">{conversations.length}</span>
      </div>

      <input
        className="people-search"
        placeholder="Find people, places, topics, secrets..."
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="filter-tabs" role="tablist" aria-label="Conversation classifications">
        {CLASSIFICATIONS.map((item) => (
          <button
            aria-selected={classification === item}
            className={classification === item ? "active" : ""}
            key={item}
            role="tab"
            type="button"
            onClick={() => setClassification(item)}
          >
            {label(item)}
          </button>
        ))}
      </div>

      <select className="topic-select" value={topic} onChange={(event) => setTopic(event.target.value as "all" | ConversationTopic)}>
        {TOPICS.map((item) => (
          <option key={item} value={item}>{item === "all" ? "All topics" : label(item)}</option>
        ))}
      </select>

      <div className="conversation-tree">
        {tree.length ? tree.map(([group, topics]) => (
          <section key={group} className="conversation-group">
            <h3>{label(group)}</h3>
            {Array.from(topics.entries()).map(([topicName, entries]) => (
              <details key={topicName} open>
                <summary>{label(topicName)} <span>{entries.length}</span></summary>
                <ol>
                  {entries.map((entry) => (
                    <li key={entry.id}>
                      <div className="conversation-meta">
                        <strong>{entry.time}</strong>
                        <span>{entry.locationName}{entry.locationSlotName ? ` · ${entry.locationSlotName}` : ""}</span>
                      </div>
                      <div className="conversation-people">
                        <button type="button" onClick={() => entry.speakerId && onSelectCitizen(entry.speakerId)}>
                          {entry.speakerName}
                        </button>
                        <span>with</span>
                        <button type="button" onClick={() => onSelectCitizen(entry.withId)}>
                          {entry.withName}
                        </button>
                      </div>
                      <p>{entry.text}</p>
                      {entry.classificationReason ? (
                        <small className="classification-reason">
                          {label(entry.classification)} because {entry.classificationReason.charAt(0).toLowerCase()}{entry.classificationReason.slice(1)}
                        </small>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </details>
            ))}
          </section>
        )) : (
          <p className="empty-note">No conversations match this view yet.</p>
        )}
      </div>
    </aside>
  );
}
