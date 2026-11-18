import { randomUUID } from "node:crypto";
import type { EventSettings, Location } from "@dd-tournament/engine";
import { cacheUser, database, eventRecords } from "./db";
import { HttpError } from "./http";
import type { TournamentUser } from "./validation";

export function locations(ownerId: number): Location[] {
  return database().prepare<[number], { data: string }>("SELECT data FROM locations WHERE owner_user_id=? ORDER BY json_extract(data,'$.name')").all(ownerId).map(row => JSON.parse(row.data) as Location);
}
export function locationSettings(ownerId: number, settings: Partial<EventSettings>): Partial<EventSettings> {
  if (settings.locationId === undefined) return settings;
  if (settings.locationId === null) return { ...settings, location: null, locationDetails: null };
  const location = locations(ownerId).find(l => l.id === settings.locationId);
  if (!location) throw new HttpError(422, "location_not_found");
  return { ...settings, location: location.name, locationDetails: location };
}
export function createLocation(user: TournamentUser, fields: Omit<Location, "id">): Location {
  return database().transaction(() => {
    cacheUser(user);
    const location = { ...fields, id: randomUUID() };
    database().prepare("INSERT INTO locations(id,owner_user_id,data) VALUES (?,?,?)").run(location.id, user.id, JSON.stringify(location));
    return location;
  }).immediate();
}
export function changeLocation(ownerId: number, id: string, fields?: Omit<Location, "id">) {
  return database().transaction(() => {
    if (!locations(ownerId).some(l => l.id === id)) throw new HttpError(404, "not_found");
    if (fields) {
      const location = { ...fields, id };
      database().prepare("UPDATE locations SET data=? WHERE id=? AND owner_user_id=?").run(JSON.stringify(location), id, ownerId);
      return location;
    }
    if (eventRecords().some(e => e.state.settings.locationId === id || e.state.settings.locationDetails?.id === id)) throw new HttpError(409, "location_in_use");
    database().prepare("DELETE FROM locations WHERE id=? AND owner_user_id=?").run(id, ownerId);
    return { ok: true };
  }).immediate();
}
