import type { SimulationSnapshot } from "../types/simulation";

type MetricsBarProps = {
  summary: SimulationSnapshot;
};

export function MetricsBar({ summary }: MetricsBarProps) {
  return (
    <section className="metrics-strip" aria-label="Town metrics">
      <div>
        <span>Population</span>
        <strong>{summary.population}</strong>
      </div>
      <div>
        <span>Avg Mood</span>
        <strong>{summary.averageMood}%</strong>
      </div>
      <div>
        <span>Rumor Reach</span>
        <strong>{summary.rumorReach}%</strong>
      </div>
      <div>
        <span>Conversations</span>
        <strong>{summary.totalConversations}</strong>
      </div>
      <div>
        <span>Weather</span>
        <strong>{summary.weather.kind} · {summary.weather.temperature}F</strong>
      </div>
      <div>
        <span>Town Cash</span>
        <strong>${summary.townCash.toLocaleString()}</strong>
      </div>
    </section>
  );
}
