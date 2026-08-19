import type { SimulationState } from "../types/simulation";

type ControlsPanelProps = {
  sim: SimulationState;
  onTogglePaused: () => void;
  onSetSpeed: (speed: number) => void;
  onSeedRumor: () => void;
  onCollapseFactory: () => void;
  onClose: () => void;
};

export function ControlsPanel({ sim, onTogglePaused, onSetSpeed, onSeedRumor, onCollapseFactory, onClose }: ControlsPanelProps) {
  const students = sim.citizens.filter((citizen) => citizen.schoolClass).length;
  const teachers = sim.citizens.filter((citizen) => citizen.institutionRole?.includes("teacher")).length;
  const schoolStaff = sim.citizens.filter((citizen) => citizen.workplaceId === "school").length;
  const households = sim.households.length;
  const children = sim.citizens.filter((citizen) => citizen.lifeStage === "child").length;
  const teens = sim.citizens.filter((citizen) => citizen.lifeStage === "teen").length;

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

      <div className="panel-section town-section">
        <h3>Town</h3>
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
      </div>

      <div className="panel-section">
        <h3>World Feed</h3>
        <ol className="feed-list">
          {sim.feed.map((event) => (
            <li key={event.id}>
              Day {event.day} {event.time}: {event.text}
            </li>
          ))}
        </ol>
      </div>
    </aside>
  );
}
