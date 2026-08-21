import { useEffect, useState, type ReactNode } from "react";
import type { Citizen, SimulationState } from "../types/simulation";
import { relationshipStage } from "../simulation/conversationSystem";
import { FACTORY_RUMOR } from "../simulation/constants";
import { formatTime } from "../simulation/time";
import { buildingById, placeSlotById } from "../simulation/world";

type CitizenProfileProps = {
  citizen: Citizen;
  sim: SimulationState;
  showRoute: boolean;
  onToggleRoute: () => void;
  onSelectCitizen: (citizenId: string) => void;
  onClose: () => void;
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

function careNeedFor(citizen: Citizen) {
  if (citizen.lifeStage !== "child") return null;
  if (citizen.mood < 30 && (citizen.needs.rest > 76 || citizen.energy < 34)) return "sick";
  if (citizen.needs.hunger > 78) return "hungry";
  if (citizen.needs.rest > 88 || citizen.energy < 24) return "exhausted";
  if (citizen.needs.belonging > 86 || citizen.social < 22 || citizen.mood < 34) return "lonely";
  return null;
}

function guardianFor(child: Citizen, householdMembers: Citizen[] | undefined) {
  if (!householdMembers) return null;
  return householdMembers.find((member) => member.familyRole === "parent" || member.familyRole === "partner")
    ?? householdMembers.find((member) => member.lifeStage === "adult" || member.lifeStage === "elder")
    ?? null;
}

function distanceBetween(a: Citizen, b: Citizen) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function CitizenProfile({ citizen, sim, showRoute, onToggleRoute, onSelectCitizen, onClose }: CitizenProfileProps) {
  const [showAllTransactions, setShowAllTransactions] = useState(false);
  const household = sim.households.find((item) => item.id === citizen.householdId);
  const workplace = citizen.workplaceId ? buildingById(citizen.workplaceId) : null;
  const currentSlot = placeSlotById(citizen.currentSlotId);
  const destinationSlot = placeSlotById(citizen.destinationSlotId);
  const distanceToTarget = Math.hypot(citizen.targetX - citizen.x, citizen.targetY - citizen.y);
  const householdMembers = household?.memberIds
    .map((id) => sim.citizens.find((item) => item.id === id))
    .filter((item) => item !== undefined);
  const relationships = Object.entries(citizen.relationships)
    .map(([id, relationship]) => {
      const otherCitizen = sim.citizens.find((item) => item.id === id);
      return {
        citizen: otherCitizen,
        relationship,
        stage: otherCitizen ? relationshipStage(citizen, otherCitizen) : "stranger",
      };
    })
    .filter((item): item is { citizen: Citizen; relationship: typeof item.relationship; stage: ReturnType<typeof relationshipStage> } => item.citizen !== undefined)
    .filter((item) => item.stage !== "stranger")
    .sort((a, b) => {
      const aScore = a.relationship.friendship + a.relationship.trust + a.relationship.familiarity;
      const bScore = b.relationship.friendship + b.relationship.trust + b.relationship.familiarity;
      return bScore - aScore;
    })
    .slice(0, 5);
  const recentTransactions = sim.transactionLog
    .filter((entry) => entry.citizenId === citizen.id || entry.householdId === citizen.householdId)
  const visibleTransactions = showAllTransactions ? recentTransactions : recentTransactions.slice(0, 8);
  const childCareNeed = careNeedFor(citizen);
  const childGuardian = guardianFor(citizen, householdMembers);
  const careDistance = childGuardian ? distanceBetween(citizen, childGuardian) : Infinity;
  const childCareStatus = citizen.lifeStage === "child"
    ? childCareNeed
      ? careDistance < 54
        ? "being helped"
        : childGuardian && childGuardian.destinationId === citizen.destinationId
          ? "guardian coming"
          : "waiting for help"
      : "settled"
    : null;
  const careDependents = householdMembers
    ?.filter((member) => member.lifeStage === "child" && member.id !== citizen.id)
    .map((child) => ({ child, need: careNeedFor(child), guardian: guardianFor(child, householdMembers) }))
    .filter((item) => item.need && item.guardian?.id === citizen.id) ?? [];
  const recentCareEvents = sim.worldDecisions
    .filter((decision) => decision.relatedCitizenIds.includes(citizen.id))
    .filter((decision) => decision.reason.includes("child") || decision.title.includes("responded to"))
    .slice(0, 5);

  return (
    <aside className="panel profile-panel">
      <div className="panel-title-row">
        <h2>{citizen.name}</h2>
        <button className="panel-close" type="button" onClick={onClose} aria-label="Close person panel">Close</button>
      </div>
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

      <button className={`route-toggle${showRoute ? " active" : ""}`} type="button" onClick={onToggleRoute}>
        {showRoute ? "Hide this path" : "Show this path"}
        <span>{citizen.route.length} stops</span>
      </button>

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

      {(citizen.lifeStage === "child" || careDependents.length || recentCareEvents.length) ? (
        <div className="care-card">
          <div className="care-card-head">
            <div>
              <span>Care</span>
              <strong>{citizen.lifeStage === "child" ? childCareStatus : careDependents.length ? `Helping ${careDependents.length}` : "No active care"}</strong>
            </div>
            {citizen.lifeStage === "child" && childGuardian ? (
              <button type="button" onClick={() => onSelectCitizen(childGuardian.id)}>
                {childGuardian.name}
              </button>
            ) : null}
          </div>

          {citizen.lifeStage === "child" ? (
            <p>
              {childCareNeed
                ? `${titleCase(childCareNeed)} need · guardian ${childGuardian?.name ?? "not found"}`
                : `Guardian ${childGuardian?.name ?? "not found"} · no urgent care need`}
            </p>
          ) : null}

          {careDependents.length ? (
            <ul className="care-list">
              {careDependents.map(({ child, need }) => (
                <li key={child.id}>
                  <button type="button" onClick={() => onSelectCitizen(child.id)}>
                    <span>{child.name}</span>
                    <strong>{need ? titleCase(need) : "Care"}</strong>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

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

      {citizen.brainDebug ? (
        <CollapsibleSection title="Brain Adapter" defaultOpen={false}>
          <div className="reasoning-card">
            <span>
              {titleCase(citizen.brainDebug.mode)} mode · Day {citizen.brainDebug.decidedAtDay} {citizen.brainDebug.decidedAtTime}
            </span>
            <strong>{citizen.brainDebug.output.decision.thought}</strong>
            <div className="decision-score-card">
              <div>
                <span>Output</span>
                <strong>
                  {titleCase(citizen.brainDebug.output.decision.intention)} · {citizen.brainDebug.output.decision.reason}
                </strong>
              </div>
              <em>{citizen.brainDebug.output.decision.confidence}%</em>
            </div>
            <div className="detail-grid">
              <div className="detail-card">
                <span>Allowed actions</span>
                <strong>{citizen.brainDebug.input.constraints.allowedIntentions.map(titleCase).join(", ")}</strong>
              </div>
              <div className="detail-card">
                <span>Signals seen</span>
                <strong>{citizen.brainDebug.input.localSignals.length}</strong>
              </div>
              <div className="detail-card">
                <span>Observations seen</span>
                <strong>{citizen.brainDebug.input.recentObservations.length}</strong>
              </div>
              <div className="detail-card">
                <span>Authority</span>
                <strong>{titleCase(citizen.brainDebug.input.constraints.authority.outcome)}</strong>
              </div>
            </div>
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

      {recentCareEvents.length ? (
        <CollapsibleSection title="Care Events" count={recentCareEvents.length} defaultOpen={citizen.lifeStage === "child"}>
          <ul className="detail-list authority-event-list">
            {recentCareEvents.map((event) => (
              <li key={event.id}>
                <strong>{event.title}</strong>
                <span>Day {event.day} {event.time} · {titleCase(event.impact)} impact</span>
                <em>{event.summary}</em>
                <small>{event.effect}</small>
                {event.relatedCitizenIds.length ? (
                  <div className="decision-people-row">
                    {event.relatedCitizenIds.map((citizenId) => {
                      const related = sim.citizens.find((item) => item.id === citizenId);
                      return related ? (
                        <button key={citizenId} type="button" onClick={() => onSelectCitizen(citizenId)}>
                          {related.name}
                        </button>
                      ) : null;
                    })}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      ) : null}

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
          <span>{household.name} · {household.financialStatus}</span>
          <strong>
            {householdMembers?.length ?? 0} members · ${Math.round(household.sharedCash).toLocaleString()} shared · ${Math.round(household.unpaidBills).toLocaleString()} unpaid · {household.foodStock}% food · {Math.round(household.stress)}% stress
          </strong>
          <em>{household.lastMoneyNote}</em>
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
          <div>
            <strong>${Math.round(citizen.today.spent)}</strong>
            <small>spent</small>
          </div>
        </div>
      </div>

      <CollapsibleSection title="Recent Money" count={recentTransactions.length} defaultOpen>
        {recentTransactions.length ? (
          <button className="ledger-toggle" type="button" onClick={() => setShowAllTransactions((value) => !value)}>
            {showAllTransactions ? "Show recent" : "Show all ledger"}
          </button>
        ) : null}
        <ul className="detail-list transaction-list">
          {(visibleTransactions.length ? visibleTransactions : [{
            id: "empty",
            time: formatTime(sim.minute),
            amount: 0,
            fromName: "No transactions",
            toName: "",
            note: "No money has moved for this person or household yet.",
          }]).map((entry) => (
            <li key={entry.id}>
              <strong>{entry.time} · ${Math.round(entry.amount).toLocaleString()}</strong>
              <span>{entry.toName ? `${entry.fromName} -> ${entry.toName}` : entry.fromName}</span>
              <small>{entry.note}</small>
            </li>
          ))}
        </ul>
      </CollapsibleSection>

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
                  <strong>{titleCase(item.stage)} · {item.relationship.interactions} talks</strong>
                  <small>friendship {Math.round(item.relationship.friendship)} · trust {Math.round(item.relationship.trust)}</small>
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
                <span>Day {entry.day} {entry.time}{entry.relationshipStage ? ` · ${titleCase(entry.relationshipStage)}` : ""}{entry.importance ? ` · ${entry.importance} importance` : ""}</span>
                <em>{entry.text}</em>
                {entry.evidenceSummary ? <small>{entry.evidenceSummary}</small> : null}
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
