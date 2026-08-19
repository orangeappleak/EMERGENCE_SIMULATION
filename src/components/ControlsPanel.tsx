import { useState, type ReactNode } from "react";
import type { SimulationState } from "../types/simulation";

type ControlsPanelProps = {
  sim: SimulationState;
  onTogglePaused: () => void;
  onSetSpeed: (speed: number) => void;
  onSeedRumor: () => void;
  onCollapseFactory: () => void;
  onClose: () => void;
};

type CollapsibleSectionProps = {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
};

function CollapsibleSection({ title, count, defaultOpen = true, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

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

export function ControlsPanel({ sim, onTogglePaused, onSetSpeed, onSeedRumor, onCollapseFactory, onClose }: ControlsPanelProps) {
  const students = sim.citizens.filter((citizen) => citizen.schoolClass).length;
  const teachers = sim.citizens.filter((citizen) => citizen.institutionRole?.includes("teacher")).length;
  const schoolStaff = sim.citizens.filter((citizen) => citizen.workplaceId === "school").length;
  const households = sim.households.length;
  const children = sim.citizens.filter((citizen) => citizen.lifeStage === "child").length;
  const teens = sim.citizens.filter((citizen) => citizen.lifeStage === "teen").length;
  const townCash = sim.citizens.reduce((sum, citizen) => sum + citizen.cash, 0) + sim.households.reduce((sum, household) => sum + household.sharedCash, 0);
  const marketRevenue = sim.businessAccounts.market ?? 0;
  const clinicRevenue = sim.businessAccounts.clinic ?? 0;
  const strainedHouseholds = sim.households.filter((household) => household.financialStatus !== "stable").length;
  const unpaidBills = sim.households.reduce((sum, household) => sum + household.unpaidBills, 0);

  return (
    <aside className="panel">
      <div className="panel-title-row">
        <h2>Controls</h2>
        <div className="panel-title-actions">
          <span className="status-badge">{sim.paused ? "Paused" : "Live"}</span>
          <button className="panel-close" type="button" onClick={onClose} aria-label="Close controls panel">Close</button>
        </div>
      </div>

      <div className="button-grid">
        <button type="button" onClick={onTogglePaused}>{sim.paused ? "Resume" : "Pause"}</button>
        {[1, 5, 20].map((speed) => (
          <button
            className={sim.speed === speed ? "active" : ""}
            key={speed}
            type="button"
            onClick={() => onSetSpeed(speed)}
          >
            {speed}x
          </button>
        ))}
      </div>

      <button className="primary-action" type="button" onClick={onSeedRumor}>
        Seed Factory Rumor
      </button>
      <button className="danger-action" type="button" onClick={onCollapseFactory}>
        Collapse Factory
      </button>

      <CollapsibleSection title="Town">
        <div className="town-facts">
          <div>
            <span>Homes</span>
            <strong>{households}</strong>
          </div>
          <div>
            <span>Children</span>
            <strong>{children}</strong>
          </div>
          <div>
            <span>Teens</span>
            <strong>{teens}</strong>
          </div>
          <div>
            <span>Students</span>
            <strong>{students}</strong>
          </div>
          <div>
            <span>Teachers</span>
            <strong>{teachers}</strong>
          </div>
          <div>
            <span>School staff</span>
            <strong>{schoolStaff}</strong>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Economy">
        <div className="town-facts">
          <div>
            <span>Town cash</span>
            <strong>${Math.round(townCash).toLocaleString()}</strong>
          </div>
          <div>
            <span>Transactions</span>
            <strong>{sim.transactionLog.length}</strong>
          </div>
          <div>
            <span>Market</span>
            <strong>${Math.round(marketRevenue).toLocaleString()}</strong>
          </div>
          <div>
            <span>Clinic</span>
            <strong>${Math.round(clinicRevenue).toLocaleString()}</strong>
          </div>
          <div>
            <span>Strained homes</span>
            <strong>{strainedHouseholds}</strong>
          </div>
          <div>
            <span>Unpaid bills</span>
            <strong>${Math.round(unpaidBills).toLocaleString()}</strong>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Household Pressure" count={strainedHouseholds} defaultOpen={false}>
        <ol className="feed-list household-money-list">
          {sim.households
            .slice()
            .sort((a, b) => b.stress + b.unpaidBills * 0.05 - (a.stress + a.unpaidBills * 0.05))
            .slice(0, 8)
            .map((household) => (
              <li key={household.id}>
                <strong>{household.name} · {household.financialStatus}</strong>
                <span>${Math.round(household.sharedCash).toLocaleString()} shared · ${Math.round(household.unpaidBills).toLocaleString()} unpaid · {Math.round(household.stress)}% stress</span>
                <small>{household.lastMoneyNote}</small>
              </li>
            ))}
        </ol>
      </CollapsibleSection>

      <CollapsibleSection title="Recent Money" count={sim.transactionLog.length} defaultOpen={false}>
        <ol className="feed-list transaction-list">
          {(sim.transactionLog.length ? sim.transactionLog.slice(0, 8) : []).map((entry) => (
            <li key={entry.id}>
              <strong>{entry.time} · ${Math.round(entry.amount).toLocaleString()}</strong>
              <span>{entry.fromName}{" -> "}{entry.toName}</span>
              <small>{entry.note}</small>
            </li>
          ))}
          {!sim.transactionLog.length ? <li>No money has moved yet.</li> : null}
        </ol>
      </CollapsibleSection>

      <CollapsibleSection title="World Feed" count={sim.feed.length} defaultOpen={false}>
        <ol className="feed-list">
          {sim.feed.map((event) => (
            <li key={event.id}>
              Day {event.day} {event.time}: {event.text}
            </li>
          ))}
        </ol>
      </CollapsibleSection>
    </aside>
  );
}
