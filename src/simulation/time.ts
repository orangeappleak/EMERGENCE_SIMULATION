export function formatTime(minute: number) {
  const hour = Math.floor(minute / 60) % 24;
  const mins = Math.floor(minute % 60);
  return `${String(hour).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}
