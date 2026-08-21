import { useMemo, useState } from "react";
import type { ConversationClassification, ConversationEntry, ConversationTopic, SimulationState } from "../types/simulation";

type ConversationsBrowserProps = {
  sim: SimulationState;
  onSelectCitizen: (citizenId: string) => void;
  onClose: () => void;
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
    entry.contextZone,
    entry.importance,
    entry.intent,
    entry.scope,
    entry.tone,
    entry.aiUsefulness,
    entry.evidenceSummary,
    ...(entry.evidenceTags ?? []),
    ...(entry.dialogue?.map((line) => `${line.speakerName} ${line.text}`) ?? []),
    entry.text,
  ].join(" ").toLowerCase();
  return text.includes(query);
}

function label(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function DialogueBlock({ entry }: { entry: ConversationEntry }) {
  if (!entry.dialogue?.length) return <p>{entry.text}</p>;

  return (
    <div className="conversation-dialogue" aria-label="Conversation dialogue">
      {entry.dialogue.map((line, index) => (
        <p key={`${entry.id}-${line.speakerId}-${index}`}>
          <strong>{line.speakerName}</strong>
          <span>"{line.text}"</span>
        </p>
      ))}
    </div>
  );
}

export function ConversationsBrowser({ sim, onSelectCitizen, onClose }: ConversationsBrowserProps) {
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
        <div className="panel-title-actions">
          <span className="status-badge">{conversations.length}</span>
          <button className="panel-close" type="button" onClick={onClose} aria-label="Close conversations panel">Close</button>
        </div>
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
                        <span>{entry.locationName}{entry.locationSlotName ? ` · ${entry.locationSlotName}` : ""}{entry.relationshipStage ? ` · ${label(entry.relationshipStage)}` : ""}{entry.importance ? ` · ${label(entry.importance)}` : ""}</span>
                      </div>
                      {(entry.intent || entry.scope || entry.tone || entry.aiUsefulness) ? (
                        <div className="conversation-signals">
                          {entry.intent ? <span>{label(entry.intent)}</span> : null}
                          {entry.scope ? <span>{label(entry.scope)}</span> : null}
                          {entry.tone ? <span>{label(entry.tone)}</span> : null}
                          {entry.aiUsefulness ? <span>AI {label(entry.aiUsefulness)}</span> : null}
                        </div>
                      ) : null}
                      <div className="conversation-people">
                        <button type="button" onClick={() => entry.speakerId && onSelectCitizen(entry.speakerId)}>
                          {entry.speakerName}
                        </button>
                        <span>with</span>
                        <button type="button" onClick={() => onSelectCitizen(entry.withId)}>
                          {entry.withName}
                        </button>
                      </div>
                      <DialogueBlock entry={entry} />
                      {entry.dialogue?.length ? <p className="conversation-summary">{entry.text}</p> : null}
                      {entry.evidenceSummary ? <small>{entry.evidenceSummary}</small> : null}
                      {entry.evidenceTags?.length ? (
                        <div className="evidence-tags">
                          {entry.evidenceTags.slice(0, 5).map((tag) => <span key={tag}>{tag}</span>)}
                        </div>
                      ) : null}
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
