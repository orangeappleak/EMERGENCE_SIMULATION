import { useMemo, useState } from "react";
import type { Citizen, SimulationState } from "../types/simulation";
import { buildingById, placeSlotById } from "../simulation/world";

type PeopleBrowserProps = {
  sim: SimulationState;
  selectedCitizenId: string;
  onSelectCitizen: (citizenId: string) => void;
  onClose: () => void;
};

const FILTERS = [
  { id: "all", label: "All" },
  { id: "students", label: "Students" },
  { id: "teachers", label: "Teachers" },
  { id: "workers", label: "Workers" },
  { id: "unemployed", label: "Unemployed" },
  { id: "low-mood", label: "Low mood" },
  { id: "burnout", label: "Burnout" },
] as const;

type FilterId = (typeof FILTERS)[number]["id"];

function workplaceName(citizen: Citizen) {
  return citizen.workplaceId ? buildingById(citizen.workplaceId).name : "No workplace";
}

function matchesFilter(citizen: Citizen, filter: FilterId) {
  if (filter === "students") return citizen.schoolClass !== null;
  if (filter === "teachers") return citizen.institutionRole?.includes("teacher") ?? false;
  if (filter === "workers") return citizen.workplaceId !== null && citizen.schoolClass === null;
  if (filter === "unemployed") return citizen.job === "Unemployed";
  if (filter === "low-mood") return citizen.mood < 45;
  if (filter === "burnout") return (citizen.careerProgress?.burnout ?? 0) > 70;
  return true;
}

function searchText(citizen: Citizen) {
  return [
    citizen.name,
    citizen.job,
    citizen.familyRole,
    citizen.institutionRole ?? "",
    citizen.schoolClass ?? "",
    buildingById(citizen.homeId).name,
    workplaceName(citizen),
    citizen.currentThought,
    citizen.goalFocus,
    placeSlotById(citizen.destinationSlotId).name,
    ...citizen.personalGoals.map((goal) => `${goal.title} ${goal.reason}`),
  ].join(" ").toLowerCase();
}

export function PeopleBrowser({ sim, selectedCitizenId, onSelectCitizen, onClose }: PeopleBrowserProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterId>("all");
  const normalizedQuery = query.trim().toLowerCase();

  const people = useMemo(() => {
    return sim.citizens
      .filter((citizen) => matchesFilter(citizen, filter))
      .filter((citizen) => !normalizedQuery || searchText(citizen).includes(normalizedQuery))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [filter, normalizedQuery, sim.citizens, sim.day, sim.minute, sim.totalConversations]);

  return (
    <aside className="panel people-panel">
      <div className="panel-title-row">
        <h2>People</h2>
        <div className="panel-title-actions">
          <span className="status-badge">{people.length}</span>
          <button className="panel-close" type="button" onClick={onClose} aria-label="Close people panel">Close</button>
        </div>
      </div>

      <input
        className="people-search"
        placeholder="Search people, jobs, homes, goals..."
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="filter-tabs" role="tablist" aria-label="People filters">
        {FILTERS.map((item) => (
          <button
            aria-selected={filter === item.id}
            className={filter === item.id ? "active" : ""}
            key={item.id}
            role="tab"
            type="button"
            onClick={() => setFilter(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <ol className="people-list">
        {people.map((citizen) => (
          <li key={citizen.id}>
            <button
              className={citizen.id === selectedCitizenId ? "active" : ""}
              type="button"
              onClick={() => onSelectCitizen(citizen.id)}
            >
              <span>
                <strong>{citizen.name}</strong>
                <small>{citizen.job} · {buildingById(citizen.destinationId).name} · {placeSlotById(citizen.destinationSlotId).name}</small>
              </span>
              <em>{Math.round(citizen.mood)}%</em>
            </button>
          </li>
        ))}
      </ol>
    </aside>
  );
}
