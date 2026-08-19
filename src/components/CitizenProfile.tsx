import { useEffect, useState, type ReactNode } from "react";
import type { Citizen, SimulationState } from "../types/simulation";
import { FACTORY_RUMOR } from "../simulation/constants";
import { formatTime } from "../simulation/time";
import { buildingById, placeSlotById } from "../simulation/world";

type CitizenProfileProps = {
  citizen: Citizen;
  sim: SimulationState;
  onSelectCitizen: (citizenId: string) => void;
};

type CollapsibleSectionProps = {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
};

function CollapsibleSection({ title, count, defaultOpen = false, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen, title]);

  return (
    <div className={`panel-section collapsible-section ${open ? "is-open" : ""}`}>
      <button className="section-toggle" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span>{title}</span>
        <strong>{count !== undefined ? count : open ? "Hide" : "Show"}</strong>
      </button>
      {open ? <div className="section-content">{children}</div> : null}
    </div>
  );
}

function hours(minutes: number) {
  return `${Math.round(minutes / 60)}h`;
}

function titleCase(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function CitizenProfile({ citizen, sim, onSelectCitizen }: CitizenProfileProps) {
  const household = sim.households.find((item) => item.id === citizen.householdId);
  const workplace = citizen.workplaceId ? buildingById(citizen.workplaceId) : null;
  const currentSlot = placeSlotById(citizen.currentSlotId);
  const destinationSlot = placeSlotById(citizen.destinationSlotId);
  const distanceToTarget = Math.hypot(citizen.targetX - citizen.x, citizen.targetY - citizen.y);
  const householdMembers = household?.memberIds
    .map((id) => sim.citizens.find((item) => item.id === id))
    .filter((item) => item !== undefined);
  const relationships = Object.entries(citizen.relationships)
    .map(([id, relationship]) => ({
      citizen: sim.citizens.find((item) => item.id === id),
      relationship,
    }))
    .filter((item): item is { citizen: Citizen; relationship: typeof item.relationship } => item.citizen !== undefined)
    .sort((a, b) => {
      const aScore = a.relationship.friendship + a.relationship.trust + a.relationship.familiarity;
      const bScore = b.relationship.friendship + b.relationship.trust + b.relationship.familiarity;
      return bScore - aScore;
    })
    .slice(0, 5);

  return (
    <aside className="panel profile-panel">
      <h2>{citizen.name}</h2>
      <p className="muted">
        Age {citizen.age}. {citizen.familyRole}. {citizen.job}. Lives at {buildingById(citizen.homeId).name}.
      </p>

      <div className="profile-grid">
        <div>
          <span>Mood</span>
          <strong>{Math.round(citizen.mood)}%</strong>
        </div>
        <div>
          <span>Cash</span>
          <strong>${Math.round(citizen.cash).toLocaleString()}</strong>
        </div>
        <div>
          <span>Job</span>
          <strong>{citizen.job}</strong>
        </div>
        <div>
          <span>Knows</span>
          <strong>{citizen.knownFacts.includes(FACTORY_RUMOR) ? "Factory rumor" : "Nothing major"}</strong>
        </div>
        <div>
          <span>Emotion</span>
          <strong>{citizen.currentEmotion}</strong>
        </div>
      </div>

      <div className="routine-line">
        <span>{distanceToTarget < 18 ? "At" : "Going to"} {buildingById(citizen.destinationId).name}</span>
        <strong>{distanceToTarget < 18 ? currentSlot.name : destinationSlot.name}</strong>
      </div>

      <div className="routine-line">
        <span>{citizen.institutionRole ?? citizen.lifeStage}</span>
        <strong>
          {workplace ? `${workplace.name} · ` : ""}
          {citizen.schoolClass ? `${citizen.schoolClass} student · ` : ""}
          {formatTime(citizen.routine.workStartMinute)} start · {formatTime(citizen.routine.workEndMinute)} end
        </strong>
      </div>

      <div className="thought-card">
        <span>Thinking</span>
        <strong>{citizen.currentThought}</strong>
      </div>

      {citizen.decisionReasoning ? (
        <CollapsibleSection title="Decision Reasoning" defaultOpen>
          <div className="reasoning-card">
            <span>
              Day {citizen.decisionReasoning.decidedAtDay} {citizen.decisionReasoning.decidedAtTime}
            </span>
            <strong>{citizen.decisionReasoning.summary}</strong>
            <div className="decision-score-card">
              <div>
                <span>Chosen</span>
                <strong>
                  {titleCase(citizen.decisionReasoning.chosen.intention)} to {citizen.decisionReasoning.chosen.destinationName}
                </strong>
              </div>
              <em>{citizen.decisionReasoning.chosen.score}</em>
            </div>
            <div className={`authority-card authority-${citizen.decisionReasoning.authority.outcome}`}>
              <div>
                <span>Authority</span>
                <strong>{citizen.decisionReasoning.authority.authority}</strong>
              </div>
              <em>{titleCase(citizen.decisionReasoning.authority.outcome)}</em>
              <p>{citizen.decisionReasoning.authority.reason}</p>
              {citizen.decisionReasoning.authority.expectedIntention ? (
                <small>
                  Expected: {titleCase(citizen.decisionReasoning.authority.expectedIntention)} · Pressure {citizen.decisionReasoning.authority.pressure} · Resistance {citizen.decisionReasoning.authority.resistance}
                </small>
              ) : null}
            </div>
            {citizen.decisionReasoning.alternatives.length ? (
              <ul className="decision-score-list">
                {citizen.decisionReasoning.alternatives.map((option) => (
                  <li key={`${option.intention}-${option.destinationId}`}>
                    <div>
                      <strong>{titleCase(option.intention)} to {option.destinationName}</strong>
                      <span>{option.reason}</span>
                    </div>
                    <em>{option.score}</em>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </CollapsibleSection>
      ) : null}

      <CollapsibleSection title="Authority Events" count={citizen.recentAuthorityEvents.length}>
        <ul className="detail-list authority-event-list">
          {(citizen.recentAuthorityEvents.length ? citizen.recentAuthorityEvents : [{
            id: "empty",
            day: sim.day,
            time: formatTime(sim.minute),
            outcome: "free" as const,
            authority: "No authority events",
            expectedIntention: "home" as const,
            actualIntention: "home" as const,
            pressure: 0,
            resistance: 0,
            consequence: "No one has pushed against school, work, or household expectations yet.",
          }]).map((event) => (
            <li key={event.id}>
              <strong>{titleCase(event.outcome)} · {event.authority}</strong>
              <span>Day {event.day} {event.time} · expected {event.expectedIntention} · wanted {event.actualIntention}</span>
              <em>{event.consequence}</em>
              {event.outcome !== "free" ? <small>Pressure {event.pressure} · Resistance {event.resistance}</small> : null}
            </li>
          ))}
        </ul>
      </CollapsibleSection>

      {citizen.problems.length ? (
        <div className="problem-card">
          <span>Problems</span>
          <ul>
            {citizen.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="panel-section goals-section">
        <h3>Personal Goals</h3>
        <ul className="goal-list">
          {citizen.personalGoals.map((goal) => (
            <li key={goal.id}>
              <div className="goal-title-row">
                <strong>{goal.title}</strong>
                <span>{Math.round(goal.progress)}%</span>
              </div>
              <p>{goal.reason}</p>
              <meter min="0" max="100" value={goal.progress} />
            </li>
          ))}
        </ul>
      </div>

      <div className="personality-grid">
        <div>
          <span>Responsible</span>
          <strong>{citizen.personality.responsibility}</strong>
        </div>
        <div>
          <span>Social</span>
          <strong>{citizen.personality.sociability}</strong>
        </div>
        <div>
          <span>Curious</span>
          <strong>{citizen.personality.curiosity}</strong>
        </div>
        <div>
          <span>Independent</span>
          <strong>{citizen.personality.independence}</strong>
        </div>
      </div>

      <div className="need-list">
        <div>
          <span>Hunger</span>
          <meter min="0" max="100" value={citizen.needs.hunger} />
        </div>
        <div>
          <span>Belonging</span>
          <meter min="0" max="100" value={citizen.needs.belonging} />
        </div>
        <div>
          <span>Fun</span>
          <meter min="0" max="100" value={citizen.needs.fun} />
        </div>
        <div>
          <span>Rest need</span>
          <meter min="0" max="100" value={citizen.needs.rest} />
        </div>
      </div>

      {citizen.schoolProgress ? (
        <div className="progress-card">
          <span>School Progress</span>
          <div className="progress-list">
            <label>
              Attendance
              <meter min="0" max="100" value={citizen.schoolProgress.attendance} />
              <strong>{Math.round(citizen.schoolProgress.attendance)}%</strong>
            </label>
            <label>
              Grades
              <meter min="0" max="100" value={citizen.schoolProgress.grades} />
              <strong>{Math.round(citizen.schoolProgress.grades)}%</strong>
            </label>
            <label>
              Teacher support
              <meter min="0" max="100" value={citizen.schoolProgress.teacherSupport} />
              <strong>{Math.round(citizen.schoolProgress.teacherSupport)}%</strong>
            </label>
            <label>
              Motivation
              <meter min="0" max="100" value={citizen.schoolProgress.motivation} />
              <strong>{Math.round(citizen.schoolProgress.motivation)}%</strong>
            </label>
          </div>
        </div>
      ) : null}

      {citizen.careerProgress ? (
        <div className="progress-card">
          <span>Career Progress</span>
          <div className="progress-list">
            <label>
              Reliability
              <meter min="0" max="100" value={citizen.careerProgress.reliability} />
              <strong>{Math.round(citizen.careerProgress.reliability)}%</strong>
            </label>
            <label>
              Reputation
              <meter min="0" max="100" value={citizen.careerProgress.reputation} />
              <strong>{Math.round(citizen.careerProgress.reputation)}%</strong>
            </label>
            <label>
              Satisfaction
              <meter min="0" max="100" value={citizen.careerProgress.satisfaction} />
              <strong>{Math.round(citizen.careerProgress.satisfaction)}%</strong>
            </label>
            <label>
              Burnout
              <meter min="0" max="100" value={citizen.careerProgress.burnout} />
              <strong>{Math.round(citizen.careerProgress.burnout)}%</strong>
            </label>
          </div>
        </div>
      ) : null}

      {household ? (
        <div className="routine-line">
          <span>{household.name}</span>
          <strong>
            {householdMembers?.length ?? 0} members · ${Math.round(household.sharedCash).toLocaleString()} shared · {household.foodStock}% food · {Math.round(household.stress)}% stress
          </strong>
        </div>
      ) : null}

      <div className="today-card">
        <span>Today</span>
        <div className="today-grid">
          <div>
            <strong>{hours(citizen.today.workedMinutes)}</strong>
            <small>work</small>
          </div>
          <div>
            <strong>{hours(citizen.today.schoolMinutes)}</strong>
            <small>school</small>
          </div>
          <div>
            <strong>{hours(citizen.today.socialMinutes)}</strong>
            <small>social</small>
          </div>
          <div>
            <strong>{hours(citizen.today.restMinutes)}</strong>
            <small>rest</small>
          </div>
          <div>
            <strong>{citizen.today.meals}</strong>
            <small>meals</small>
          </div>
          <div>
            <strong>{citizen.today.conversations}</strong>
            <small>talks</small>
          </div>
        </div>
      </div>

      {householdMembers?.length ? (
        <CollapsibleSection title="Household" count={householdMembers.length} defaultOpen>
          <ul className="detail-list">
            {householdMembers.map((member) => (
              <li key={member.id}>
                <button className="person-link" type="button" onClick={() => onSelectCitizen(member.id)}>
                  <span>{member.name}, {member.age}</span>
                  <strong>{member.familyRole}</strong>
                </button>
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      ) : null}

      <CollapsibleSection title="Closest Relationships" count={relationships.length}>
        <ul className="detail-list">
          {relationships.map((item) => (
            <li key={item.citizen?.id}>
              {item.citizen ? (
                <button className="person-link" type="button" onClick={() => onSelectCitizen(item.citizen.id)}>
                  <span>{item.citizen.name}</span>
                  <strong>friendship {Math.round(item.relationship.friendship)} · trust {Math.round(item.relationship.trust)}</strong>
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </CollapsibleSection>

      <CollapsibleSection title="Recent Memories" count={citizen.memories.length}>
        <ul className="detail-list">
          {(citizen.memories.length ? citizen.memories : ["No notable memories yet."]).map((memory) => (
            <li key={memory}>{memory}</li>
          ))}
        </ul>
      </CollapsibleSection>

      <CollapsibleSection title="Recent Conversations" count={citizen.recentConversations.length} defaultOpen>
        <ul className="detail-list journal-list">
          {(citizen.recentConversations.length ? citizen.recentConversations : [{ id: "empty", day: sim.day, time: formatTime(sim.minute), withId: "", withName: "No one", topic: "daily life" as const, classification: "casual" as const, text: "No conversations yet." }]).map((entry) => (
            <li key={entry.id}>
              <button className="conversation-link" type="button" disabled={!entry.withId} onClick={() => entry.withId && onSelectCitizen(entry.withId)}>
                <strong>{entry.withName} · {entry.topic} · {entry.classification}</strong>
                <span>Day {entry.day} {entry.time}</span>
                <em>{entry.text}</em>
                {entry.classificationReason ? <small>{entry.classificationReason}</small> : null}
              </button>
            </li>
          ))}
        </ul>
      </CollapsibleSection>

      <CollapsibleSection title="Life Journal" count={citizen.lifeJournal.length}>
        <ul className="detail-list journal-list">
          {(citizen.lifeJournal.length ? citizen.lifeJournal : [{ id: "empty", day: sim.day, time: formatTime(sim.minute), text: "No journal entries yet." }]).map((entry) => (
            <li key={entry.id}>
              <strong>Day {entry.day} {entry.time}</strong>
              <span>{entry.text}</span>
            </li>
          ))}
        </ul>
      </CollapsibleSection>
    </aside>
  );
}
