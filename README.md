# DD Tournaments

A standalone community tournament server for Dueling Domain accounts. The pure
TypeScript engine handles registration, pairings, results, standings and judging.
A Next.js 16 application owns its SQLite database, sessions and account bridge.
Pages are deliberately unstyled placeholders while the UI is being designed.

## Development

Use Node 22.23.4 (`nvm use`), including for native SQLite dependencies.

```sh
npm ci
npm run build -w @dd-tournament/engine
cp .env.example apps/web/.env.local
```

Edit `apps/web/.env.local` locally. Set `DD_APP_URL=mock`,
`PUBLIC_URL=http://localhost:3000`, and `DATABASE_PATH=../../data/dev.sqlite`.
Generate separate random values of at least 32 characters for `DD_BRIDGE_SECRET`
and `SESSION_SECRET`; for example, run `openssl rand -hex 32` twice. Leave
`CREATE_CODE` empty to allow signed-in users to create events, or set a private
creation code. Never commit environment files or database files.

```sh
npm run dev
```

Sign in at `/auth/start`. Mock mode shows six invented accounts and uses
in-memory account search/profile updates. For exact email lookups, use
`<mock username>@example.test`. Profile changes in mock mode reset
when the server restarts. Event state and local sessions remain in SQLite.
Mock sign-in is disabled in production even if `DD_APP_URL=mock` is supplied.

For the real bridge, set `DD_APP_URL` to the Dueling Domain application origin
and share `DD_BRIDGE_SECRET` with its tournament bridge configuration. Configure
the DD-side tournament callback origin to this application's `PUBLIC_URL`.
The apps keep separate databases. A verified email address can be used as an
exact lookup input. Account results contain profile details and member IDs.

Event owners can copy or regenerate their personal invite link in the desk's
**All Players** tab. People who open it and sign in join that owner's player list.

## Environment

| Variable | Meaning |
| --- | --- |
| `DATABASE_PATH` | SQLite file path; default `data/tournaments.sqlite` relative to the web process. |
| `PUBLIC_URL` | External tournament origin, HTTPS in production. Controls secure cookies and origin checks. |
| `DD_APP_URL` | Dueling Domain origin, or `mock` in development. |
| `DD_BRIDGE_SECRET` | Shared runtime bridge secret, at least 32 characters. |
| `SESSION_SECRET` | Independent runtime cookie-signing secret, at least 32 characters. |
| `CREATE_CODE` | Required creation code; empty disables this check. |
| `ADMIN_USER_IDS` | Comma-separated Dueling Domain user IDs with directory-wide partial account search. Defaults to empty. |

`SPECIAL_MEMBER_IDS_PATH` optionally points to a private file of little-endian
int64 member IDs, either plain or gzip-compressed (`.gz`). The server accepts
listed IDs even when their check digit fails. Keep the file private and never
commit it to Git. With Compose, place it in the untracked `./data` directory,
make it readable by UID 1000, and set `SPECIAL_MEMBER_IDS_PATH` in the root `.env`
to its container path, such as `/app/data/special-member-ids.bin.gz`. Restart the
server after replacing the file.

Sessions last 30 days. Cookies are HttpOnly and SameSite=Lax, and Secure for
HTTPS/production. SQLite stores session-token hashes and expiring consumed
assertion nonces. State mutations use immediate transactions, a fresh random
engine seed, and monotonically increasing event versions. Clients must send
`expectedVersion`; conflicts return the current staff view. Browser writes from
a foreign origin are rejected. Application responses use `Cache-Control: no-store`.

Roles follow the HTTP contract: organizers manage everything; head judges
cannot manage organizers or Discord configuration; judges handle penalties,
results, extensions and drops; scorekeepers handle rounds, results and players;
staff can add players and check them in. The owner remains an organizer.
Account member-ID edits require player-edit permission. Imports require an
organizer, head judge or scorekeeper; exports require any event staff role.
Imported identities are matched only by exact member ID, never by name.
Unmatched entries remain unlinked until staff link an account or its holder
joins with that member ID. Temporary member IDs never link accounts automatically,
including during import and self-join. Historical imported staff never become account staff.

The bridge verifies the exact assertion HMAC and 60-second lifetime before
consuming a nonce once. Search, lookup and member-ID writes sign exact request
bytes with the DD bridge v1 signing strings. A bridge outage returns an error;
there is no production mock fallback. Discord endpoints store configuration;
this initial server does not dispatch webhook messages.

## Practice data

Organizers and head judges can use `POST /api/events/:code/dummy-data` with a
signed-in session and either JSON body:

```json
{ "action": "players", "count": 16, "expectedVersion": 1 }
```

```json
{ "action": "results", "expectedVersion": 3 }
```

`players` accepts an integer count from 1 to 256 during the registration phase
only (otherwise 422 `REGISTRATION_ONLY`). It returns `{ desk, added }` and adds
unlinked entrants (`userId: null`) named `Test Player 01`, `Test Player 02`, etc.,
continuing after the highest existing test-player number. Unique temporary
member IDs start at `9999000000`, skipping occupied IDs. These entries never
claim real accounts automatically; account linking requires an explicit staff command.

`results` returns `{ desk, entered }` after filling every unreported two-player
match in the current round. Swiss results average 85% wins (either player),
10% draws and 5% double losses; playoff results always have a winner. Byes,
existing results and earlier rounds remain untouched. No players are dropped;
normal playoff elimination still applies. A round is required (422 `NO_ROUND`),
and completed events must be reopened (422 `EVENT_COMPLETE`).

Other signed-in roles receive 403 `forbidden_role`; signed-out requests receive
401. Invalid bodies receive 400 `invalid_body`. Both actions use the normal
engine command transaction and advance the event version exactly once, even
when `entered` is zero. Stale `expectedVersion` values return 409
`{ error: "version_conflict", desk }` without a write, so normal version polling
sees successful changes.

## Undrop repair and preview

Undrop repair always runs the descending points chain, without an unseated-opponent
shortcut. Fixed occupants stay at their table; a table with both seats fixed is
skipped. Played matches and pending reports are preserved.

The reference notes leave existing-bye termination unspecified. The chosen rule
pairs the final carried competitor against an active bye recipient in the same
or a lower pre-round points group, clearing the automatic bye win so the new
match can be played. This avoids two byes when an eligible bye is available.
Bye losses, pending reports and fixed-table conflicts remain protected; if no
eligible bye can be used, the carried competitor receives a bye win.

The engine exports `previewCommand(state, command, context)`, which returns
`{ matchId, before, after }[]` for matches whose participants change, including
added and removed matches. Preview uses the same validation and seed as command
execution and leaves its inputs untouched. See the [engine command notes](packages/engine/src/README.md)
for details.

## Verification

```sh
npm run typecheck
npm test
npm run build
```

Tests preserve the supplied engine/legacy suite and exercise the actual route
handlers with real SQLite. All fixture identities and XML files are invented.
`GET /api/health` checks database availability.

## Deployment

Set the production environment in an untracked root `.env` based on
`.env.example`. Use `PUBLIC_URL=https://ddtournaments.duelingdomain.com`, the
real DD origin, two strong secrets, and the desired creation code.
The container runs as UID/GID 1000. Provision its persistent directory before
starting it:

```sh
mkdir -p data
sudo chown 1000:1000 data
chmod 700 data
docker compose pull && docker compose up -d --no-build
```

The Image workflow builds the ARM64 image in Actions and pushes it to GHCR, so
the server only pulls (`TOURNAMENT_IMAGE` picks a tag; default `:main`). Compose
publishes only `${BIND_ADDRESS:-127.0.0.1}:3400:3000` and mounts `./data`. When
Caddy runs in Docker and reaches the host through `host.docker.internal`, set
`BIND_ADDRESS` to the Docker bridge gateway (for example `172.17.0.1`). Configure the
DD Caddy to proxy `ddtournaments.duelingdomain.com` to `127.0.0.1:3400`:

```caddyfile
ddtournaments.duelingdomain.com {
    request_body {
        max_size 1MB
    }
    header {
        X-Robots-Tag "noindex, nofollow"
        Referrer-Policy "no-referrer"
    }
    reverse_proxy 127.0.0.1:3400
}
```

This upstream requires Caddy on the host or using host networking. A Caddy
container's own loopback or a host-gateway address cannot reach a host service
bound only to host loopback. Adapt the existing DD Caddy networking accordingly
while retaining the specified loopback-only application port publication.
No DNS, DD, proxy or production changes are performed by this repository.

Back up the SQLite database with an SQLite-aware backup while running, or stop
the service before copying the database and its WAL files. Keep `./data` private.
