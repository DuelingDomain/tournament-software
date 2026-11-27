# Backend additions

All existing authentication, no-store headers, command conflicts, result enums, and account IDs remain in place. Mutating event commands still use `POST /api/events/:code/commands` with `{ expectedVersion, command }` and return a `DeskView`. A successful batch increments the event version once. Engine validation failures and stale versions do not write state or activity.

## Tournament configuration

`POST /api/events` accepts:

```ts
{
  name: string;
  createCode: string;
  settings?: Partial<EventSettings>;
  staff?: StaffAssignment[];
}
```

Returns `201 { code }`. Creation, location selection, owner assignment and staff assignment are atomic. Staff accounts are resolved through the account bridge. `staff` must hold at least one entry, or the call returns `400 staff_required`. The creator is not added on its own: the creator may be left out, and if listed must be the organizer. No one else may be organizer (`403 forbidden_role`).

`EventSettings` adds these fields alongside the existing name, startsAt, location and round settings:

```ts
style: "advanced" | "traditional" | "sealed" | "open_dueling";
format: "swiss" | "single_elim" | "open_dueling"; // pairing structure
playerStructure: 1 | 2 | 3 | 4 | 5;
locationId: string | null;
locationDetails: Location | null;
timeZone?: string;
```

Defaults are advanced, Swiss, individual and no saved location. `startsAt` is the combined date/time in ISO format with an offset. Player structure locks as soon as anyone enrolls, including after roster removal. Existing stored documents receive missing defaults when loaded. Pairing structure remains editable after rounds begin; existing round stages and any ongoing playoff bracket are preserved.

Update with `{ type: "UpdateSettings", settings: Partial<EventSettings>, staff?: StaffAssignment[] }`. Providing staff replaces assignments and preserves IDs for retained accounts. The list must not be empty (`400 staff_required`). The owner may be absent; if listed, the owner must be organizer, and no other account may become organizer. Only the owner removes the owner from the list (also with `RemoveStaff`). `RemoveStaff` of the last staff member returns `400 staff_required`. `AddStaff`, `SetStaffPosition` and `SetStaffRole` follow the same organizer rule. The owner keeps full access without a staff row. `PairNextRound` fails with `NO_STAFF` while the list is empty. `DeskView` has `ownerUserId` and `viewerUserId`. Scorekeepers may update settings but cannot replace staff. Head judges cannot add, remove or change organizers through either staff commands or bulk settings.

`StaffAssignment` is `{ userId: number, name: string, role?: StaffRole, position?: StaffPosition }`. Supply a role or position; if both are supplied, they must agree. Account names are resolved by the service.

| Position | Existing permission role |
| --- | --- |
| organizer | organizer |
| head_judge | head_judge |
| assistant_head_judge | head_judge |
| floor_judge_team_lead | judge |
| floor_judge | judge |
| scorekeeper | scorekeeper |
| event_manager | staff |
| event_staff | staff |

`AddStaff` accepts the same assignment shape. `{ type: "SetStaffPosition", staffId, position }` changes position and its mapped role. Existing `SetStaffRole` remains supported and assigns the corresponding default position. Staff-management permissions and owner protection apply.

## Saved locations

A `Location` has `{ id, name, address1, address2, city, state, postal, country, phone, website }`, all strings. In location writes, name is required and omitted address/contact fields default to empty strings.

| Endpoint | Body / response |
| --- | --- |
| `GET /api/locations` | `{ locations: Location[] }` for the signed-in organizer |
| `GET /api/locations?event=:code` | Same shape for that event's owner; event staff required |
| `POST /api/locations` | Body: location fields without id; `201 Location` |
| `PUT /api/locations/:id` | Body: complete location fields without id; `200 Location` |
| `DELETE /api/locations/:id` | `200 { ok: true }`; `409 location_in_use` if any event references it |

Only the location owner can edit/delete; another user's ID returns 404. Setting `settings.locationId` selects a saved location owned by the event organizer and copies its name/details into the event. Null clears the selection and snapshot. Editing the saved list preserves existing event snapshots; select the same ID again to refresh a snapshot. Legacy imports retain embedded snapshots without granting ownership of a saved location.

## Account lookup

`GET /api/accounts/search` uses the signed-in account's list. With `event=:code`, staff use the event owner's list. A blank `q` lists up to 100 known accounts by display name. A typed `q` filters those accounts by display name, username, Discord username or member ID. The list includes the owner, linked players and staff from the owner's events, accounts added through an invite, and accounts previously enrolled, assigned to staff, or linked by the organizer or their staff.

Submit a full username, Discord username, member ID or verified email with `exact=1` to add at most one case-insensitive bridge match to the search results. Email is an input-only identifier. Enrollment, staff assignment and account linking remember accounts when the change succeeds. On upgrade, the server clears rows from the old search history. Existing event links remain visible.

A signed-in viewer listed in `ADMIN_USER_IDS` uses directory-wide partial search for any nonempty query. Event-scoped requests still require event staff access.

`GET /api/players/invite?event=:code` returns `{ path }` for the event owner's personal invite. `PUT` returns a new path and revokes the previous link for future joins. Opening `/join/:token` uses the existing sign-in flow when needed and then submits `POST /api/players/join` with `{ token }`. The request adds the signed-in account to the owner's list and returns `{ organizerName }`. A repeated join succeeds without creating a duplicate.

## Team commands

Enroll people through the existing account-based `AddPlayers` command, self-join, practice data or player-file import, then enroll teams using the resulting player IDs. In team events these people do not receive individual match backfills. `teams` holds competitors; `players` continues to hold people with their account links.

```ts
{ type: "AddTeams", teams: { teamId?: string, name: string, memberIds: string[] }[] }
{ type: "UpdateTeam", teamId: string, name?: string, memberIds?: string[], fixedTable?: number | null }
{ type: "RemoveTeam", teamId: string }
{ type: "DropTeam", teamId: string }
{ type: "ReEnrollTeam", teamId: string }
{ type: "UndropTeam", teamId: string, option: UndropOption, swapWith?: string }
```

Member order determines playing position; roster length must match playerStructure. People cannot appear on multiple teams, including through duplicate account/member identities. Identity edits revalidate team membership; person-only commands cannot link accounts to team objects. Missing team IDs allocate from 9988000000 through 9998999999. AddTeams with an existing team ID updates its name/ordered roster and reactivates it, adding bye losses for missing rounds. Team removal is registration-only. Adding members, editing them or linking accounts uses the existing person commands.

Team management uses organizer/head_judge/scorekeeper permissions. Judges may also DropTeam. The existing pairing, manual match, cut, results and points commands use team IDs as competitor IDs. Match result values and result corrections are unchanged. Each live match reserves playerStructure consecutive tables; byes have no table. ReEnrollTeam fills missed rounds with bye losses. Member self-report and drop routes resolve their team; one report per side is counted, regardless of which teammate submits it.

`UndropOption` accepts `bye_loss`, `bye_win`, `repair`, `swap_previous_opponent`, `take_bye`, plus the existing `next_round` and `swap_with_dropped` options. `repair` uses an active unpaired opponent if available, otherwise a bye win. `swap_previous_opponent` drops the returning competitor's last previous opponent and replaces that opponent in an unscored current match. The explicit older swap option still uses swapWith. These options also apply to UndropPlayer.

Public views add playerStructure, style, teamCount and a teams array with public-formatted ordered member names. Matches add `tables: number[]`, `p1Members` and `p2Members` (ordered `{ id, name }` arrays); public-name privacy applies to member names. Standings use team IDs/names for team events. PlayerView retains the person's id/name and adds me.teamId; standing, match, reports and history resolve the team. currentMatch.myTable identifies the member’s own table within the block, including the two-member cross-pair offset. DeskView keeps full people/teams and uses competitor count for suggested rounds.

## Open Dueling

`{ type: "AdjustPoints", playerId: string, delta: number }` adds/subtracts a safe integer. Available when style or pairing structure is open_dueling; authorized for organizer/head_judge/scorekeeper. Team events accept a team or member ID. `openDuelingPoints` is separate from matchPoints and sorts first; match results are unchanged. PairNextRound uses Swiss pairing for this structure.

## Staff operations

- `GET /api/events/:code/activity` returns `{ activity: ActivityEntry[], version }`, newest first. Staff only. Each entry has `{ actor, at, action, command? }`. Actors are account IDs for API actions. The latest 100 successful actions are kept; failures/conflicts are omitted, undo preserves the audit trail. Import actions are recorded too. Public/player views omit the log.
- `GET /api/events/:code/print-data` returns `PrintData`, staff only. The same data is at `DeskView.printData`.
- `PrintData` contains `matches`, `pairingsByTeam`, `unreportedMatches` (all rounds), `pairedDownPlayers` (pre-round point gaps and byes), and `penalties` with player/infraction/judge labels. Match rows carry round, table block, ordered team members, result and extension. Staff print names are full names. The engine exports `printData(state)` for other renderers.

Finalization requires every match result and active pairing. When `requireMemberId` is enabled, temporary person IDs must be replaced across the entire roster, including dropped and cut players. With the setting off, the desk warns about temporary IDs and permits finalization.

Organizers, head judges and scorekeepers can correct a player's ID in every phase, including for players who missed the cut. In a finalized event, send only `{ type: "UpdatePlayer", playerId, memberId }` to correct the ID while keeping the event finalized.

## File interchange

- Tournament XML import/export supports all player structures, ordered members, stable team IDs, collision-free serialized person IDs, team results/byes/drops, manual points, styles, location fields and staff positions. Name-only imported staff remain in legacyStaff metadata and have no app permissions; assign accounts explicitly.
- `POST /api/events/:code/import` additionally accepts multipart `kind=team-players` and a tournament XML file. It enrolls the file's members into an individual registration-phase event, using the existing account matching, duplicate checks and import response shape. It never copies team matches into the individual event.
- Existing CSV endpoints remain. Team players/standings expand per person; matches expand per playing position. Two-member matches cross-pair the ordered rosters. Team CSV columns include team IDs and account user IDs; standings additionally includes openDuelingPoints. Individual match columns remain unchanged.

- `POST /api/events/import` (multipart `file`, plus `createCode` when the server requires one) opens a saved tournament file as a NEW event. The caller becomes its organizer, the phase from the file is kept (a finalized file opens finalized) and the response is 201 `{ code, imported, unmatched, warnings }`. Players are matched to accounts by member ID. A file from a newer format version returns 422 `legacy_version_too_new`; an unreadable, too deeply nested or otherwise unsupported file returns 422 `invalid_legacy_xml`. A file with more than 2000 players returns 422 `too_many_players`. If the caller already owns an event with the same event number, the response is 409 `already_open` with `{ code }` of that event (checked per owner only; another account may open the same file). The route allows 10 opens per minute per account (429 `rate_limited`). Event names from files are clipped to 200 characters and download file names to 150. The file's players are also added to the caller's global player list.
- Export kind `tournament` downloads `<Name> (ID X99-nnnnnn).Tournament`. Kind `finalized` downloads the same file and returns 422 `NOT_FINALIZED` until the event is complete. The ID is derived from the event code. Content-Disposition carries an ASCII `filename` and a `filename*` UTF-8 form.
- Global player list (per account): `GET /api/players` returns `{ players: [{ memberId, firstName, lastName }] }`; `GET /api/players/export` downloads `AllPlayers.csv` with the header `"ID","First Name","Last Name"` (ten-digit IDs, CRLF, formula-leading cells guarded with an apostrophe); `POST /api/players/import` (multipart `file`) reads that CSV, a player list XML or a tournament file and returns `{ added, skipped, invalid, overLimit, total, badCheckDigit: { count, csv } }`. Temporary, zero and malformed IDs count as invalid. The import accepts IDs with a matching check digit or an entry in the configured special member IDs file. Other IDs with a check-digit mismatch are counted in `badCheckDigit` and returned as a CSV (same columns) for download. A list holds at most 20000 players; the rest are counted in `overLimit`. Names lose quotes (changed to `'`), backslashes and line breaks when stored, and a cell that would start with `=`, `+`, `-`, `@`, tab or CR gets a leading apostrophe on export. A listed ID is never changed by an import. Unreadable files return 422 `invalid_player_file`.

Round-trip limits of Save Tournament then Open Tournament: the activity log and account links of staff are not stored; the opened event gets a new code. The event number (`<ID>`, letter, two digits, dash, six digits) is kept inside the event, upper-cased, and written back on save; it is not shown or edited in the app. New events get a random `X99-nnnnnn`. A built-in infraction that shares its legacy name with others is written with that name and its own label in the notes as `[Infraction: label]`, and reads back as itself; a custom infraction is written as `None` with the same tag.

Tournament files store local date and time to the minute and carry no time zone or account IDs. Export formats `startsAt`, or the creation time for unscheduled events, in `settings.timeZone`. The create dialog captures the organizer's IANA time zone, and export uses UTC when the zone is missing. Import interprets dates as UTC.

Tournament XML stores match tables relative to `TableOffset`. Add the offset to a stored match table to get its displayed number. An offset of 6 makes table 1 display as table 7. Fixed seats are stored as displayed numbers. If a match has a table below the configured offset, export lowers the file's offset so the displayed tables survive reopening and all stored match tables are nonnegative.

## Event list

`GET /api/events` returns `{ events: EventListItem[] }` for events the signed-in account staffs or has entered, newest created first. Each item has `{ code, name, phase, role, joined, startsAt, createdAt, format, playerStructure, playerCount, teamCount, round, plannedRounds }`. `createdAt` is the creation time; `firstRoundAt` is when play began (round 1 timer start, else its pairing time, else the first pairing in the activity log; null before pairing); `round` is the latest round number or null before pairing; `plannedRounds` is the planned Swiss round count, or the suggested count when none is set; `playerCount` counts enrolled people and `teamCount` counts teams (0 for individual events). The last eight fields are additions; earlier clients that ignore them keep working.
