import type { Building, Citizen, InteriorRoom, SimulationState } from "../types/simulation";
import { BUILDINGS, INTERIOR_LAYOUTS, PLACE_SLOTS } from "../simulation/constants";

type BuildingInteriorProps = {
  buildingId: string;
  sim: SimulationState;
  onClose: () => void;
  onSelectCitizen: (citizenId: string) => void;
};

const slotById = new Map(PLACE_SLOTS.map((slot) => [slot.id, slot]));

function buildingById(buildingId: string): Building | null {
  return BUILDINGS.find((building) => building.id === buildingId) ?? null;
}

function roomForCitizen(citizen: Citizen, rooms: InteriorRoom[]) {
  const slot = slotById.get(citizen.currentSlotId) ?? slotById.get(citizen.destinationSlotId);
  return rooms.find((room) => slot && room.slotKinds.includes(slot.kind)) ?? rooms[0];
}

function citizenPositionInRoom(citizen: Citizen, room: InteriorRoom, index: number) {
  const seed = Number(citizen.id.split("_")[1] ?? index);
  const columns = Math.max(1, Math.floor(room.width / 12));
  const row = Math.floor(index / columns);
  const col = index % columns;
  const jitterX = ((seed * 7) % 5) - 2;
  const jitterY = ((seed * 11) % 5) - 2;
  const x = room.x + 8 + col * 12 + jitterX;
  const y = room.y + 12 + row * 10 + jitterY;
  return {
    x: Math.min(room.x + room.width - 8, Math.max(room.x + 8, x)),
    y: Math.min(room.y + room.height - 8, Math.max(room.y + 10, y)),
  };
}

export function BuildingInterior({ buildingId, sim, onClose, onSelectCitizen }: BuildingInteriorProps) {
  const building = buildingById(buildingId);
  if (!building) return null;

  const layout = INTERIOR_LAYOUTS[building.kind];
  const citizensInside = sim.citizens.filter((citizen) => {
    const currentSlot = slotById.get(citizen.currentSlotId);
    const destinationSlot = slotById.get(citizen.destinationSlotId);
    return currentSlot?.buildingId === building.id || destinationSlot?.buildingId === building.id;
  });

  const citizensByRoom = new Map<string, Citizen[]>();
  for (const room of layout.rooms) citizensByRoom.set(room.id, []);
  for (const citizen of citizensInside) {
    const room = roomForCitizen(citizen, layout.rooms);
    citizensByRoom.get(room.id)?.push(citizen);
  }

  return (
    <section className="panel interior-panel" aria-label={`${building.name} interior`}>
      <div className="panel-title-row">
        <div>
          <h2>{building.name}</h2>
          <p className="muted">{layout.name} · {citizensInside.length} inside or heading in</p>
        </div>
        <button type="button" onClick={onClose}>Close</button>
      </div>

      <div className="interior-map" aria-label="Interior floorplan">
        {layout.rooms.map((room) => {
          const people = citizensByRoom.get(room.id) ?? [];
          return (
            <div
              className="interior-room"
              key={room.id}
              style={{
                background: room.color,
                height: `${room.height}%`,
                left: `${room.x}%`,
                top: `${room.y}%`,
                width: `${room.width}%`,
              }}
            >
              <span>{room.name}</span>
              <strong>{people.length}</strong>
            </div>
          );
        })}

        {layout.furniture.map((item) => (
          <div
            aria-label={item.kind}
            className={`interior-furniture furniture-${item.kind}`}
            key={item.id}
            style={{
              background: item.color,
              height: `${item.height}%`,
              left: `${item.x}%`,
              top: `${item.y}%`,
              width: `${item.width}%`,
            }}
          />
        ))}

        {layout.rooms.flatMap((room) => {
          const people = citizensByRoom.get(room.id) ?? [];
          return people.map((citizen, index) => {
            const position = citizenPositionInRoom(citizen, room, index);
            return (
              <button
                className="interior-person"
                key={citizen.id}
                style={{ left: `${position.x}%`, top: `${position.y}%` }}
                title={citizen.name}
                type="button"
                onClick={() => onSelectCitizen(citizen.id)}
              >
                <span style={{ background: citizen.style.hair }} />
              </button>
            );
          });
        })}
      </div>

      <div className="interior-room-list">
        {layout.rooms.map((room) => {
          const people = citizensByRoom.get(room.id) ?? [];
          return (
            <div key={room.id}>
              <strong>{room.name}</strong>
              <span>{people.length ? people.map((person) => person.name).join(", ") : "Empty right now"}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
