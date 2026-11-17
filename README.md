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
in-memory account search/profile updates. Profile changes in mock mode reset
when the server restarts. Event state and local sessions remain in SQLite.
Mock sign-in is disabled in production even if `DD_APP_URL=mock` is supplied.

For the real bridge, set `DD_APP_URL` to the Dueling Domain application origin
and share `DD_BRIDGE_SECRET` with its tournament bridge configuration. Configure
the DD-side tournament callback origin to this application's `PUBLIC_URL`.
The bridge never shares databases or requests account email addresses.

## Environment

| Variable | Meaning |
| --- | --- |
| `DATABASE_PATH` | SQLite file path; default `data/tournaments.sqlite` relative to the web process. |
| `PUBLIC_URL` | External tournament origin, HTTPS in production. Controls secure cookies and origin checks. |
| `DD_APP_URL` | Dueling Domain origin, or `mock` in development. |
| `DD_BRIDGE_SECRET` | Shared runtime bridge secret, at least 32 characters. |
| `SESSION_SECRET` | Independent runtime cookie-signing secret, at least 32 characters. |
| `CREATE_CODE` | Required creation code; empty disables this check. |

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
joins with that member ID. Historical imported staff never become account staff.

The bridge verifies the exact assertion HMAC and 60-second lifetime before
consuming a nonce once. Search, lookup and member-ID writes sign exact request
bytes with the DD bridge v1 signing strings. A bridge outage returns an error;
there is no production mock fallback. Discord endpoints store configuration;
this initial server does not dispatch webhook messages.

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
docker compose up -d --build
```

Compose publishes only `127.0.0.1:3400:3000` and mounts `./data`. Configure the
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
