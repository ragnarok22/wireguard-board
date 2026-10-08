# WireGuard Board

A web dashboard for managing multiple WireGuard servers from a single interface.
Each server runs its own instance of
[wireguard-api](https://github.com/ragnarok22/wireguard-api), which provides a REST
API for managing VPN clients and checking service health.

## Project status

A responsive English-language frontend with a same-origin Node proxy. The browser
calls `/api/wireguard` on the board's own origin; the proxy connects to the selected
WireGuard API. The board includes a server registry, monitoring and peer management.
Vercel deploys the frontend and proxy together. Local development and preview use
the same proxy handler through Vite.

## Features

- **Multiple servers:** add, edit and remove server connections, each with its own
  name, API base URL and credentials.
- **Portable registry:** import or export server metadata without tokens or keys.
  Imported connections start locked and are merged without replacing existing URLs.
- **Overview:** check readiness, peer counts, VPN endpoint, address pool and capacity.
- **Peer management:** list, create, inspect and delete VPN clients on the selected
  server. A peer represents a WireGuard device or client.
- **Client configurations:** download a ready-to-import `.conf` file when creating
  a peer with API-generated keys, copy the configuration or scan its QR code.
  QR codes are generated locally without sending keys to external services.
- **Monitoring:** view traffic statistics and the latest handshake reported by
  the API, receive/send rates, CPU, memory and data-filesystem usage; inspect, copy
  or download Prometheus metrics on demand.
- **Durable operations:** follow pending creation and revocation until the backend
  verifies the change in WireGuard.
- **Refresh:** automatic polling every 15 seconds in the active view, plus manual
  refresh. Polling pauses when the browser tab is in the background.
- **Sessions:** lock a connection to discard its token and cached data.
- **Search:** filter peers by IP address, UUID, public key, endpoint, activity or
  lifecycle state (`pending`, `active`, `deleting`).

Adding a server to the dashboard connects an existing `wireguard-api` instance.
Server deployment and network configuration are managed in the backend project.

## Integration with wireguard-api

Backend repository: <https://github.com/ragnarok22/wireguard-api>.

Each WireGuard server has its own API instance. The dashboard sends each operation
to the selected instance:

```text
WireGuard Board
  └── /api/wireguard · Same-origin proxy
        ├── wireguard-api · Server A
        ├── wireguard-api · Server B
        └── wireguard-api · Server C
```

### Connecting a server

Select **Add server**, enter the following details and select **Test & save**.
The board checks `/livez`, `/readyz`, authenticated `/v1/server` and the first
page of `/v1/peers` before saving. A `not_ready` readiness response does not by itself
block saving when authenticated reads succeed:

| Field        | Description                                                        |
| ------------ | ------------------------------------------------------------------ |
| Name         | A readable name for the server in the dashboard.                   |
| API base URL | The public HTTP(S) API address, such as `http://<PUBLIC-IP>:8008`. |
| API token    | The value of `API_TOKEN` configured on that instance.              |

The API listens on TCP `8008` by default. This address is separate from the VPN
endpoint, which uses UDP `51820` by default and is configured through
`SERVER_ENDPOINT` in the backend.

Every `/v1` endpoint requires the `X-API-Token` header. `/livez`, `/readyz` and
`/metrics` are public. Each instance provides interactive API documentation at `/docs`.
The Compose deployment binds management access to loopback by default. Expose an
API endpoint reachable from the proxy. A private LAN/VPN address or server-local
loopback URL is not reachable through the public-destination proxy.

### Relevant endpoints

| Method   | Endpoint                              | Dashboard usage                                                    |
| -------- | ------------------------------------- | ------------------------------------------------------------------ |
| `GET`    | `/v1/server`                          | Server identity, endpoint, pool and address reservations.          |
| `GET`    | `/v1/stats`                           | VPN-wide counts, handshakes, traffic rates and pending operations. |
| `GET`    | `/v1/system`                          | Current-cgroup CPU/memory, data filesystem and runtime details.    |
| `GET`    | `/v1/peers?limit=100&after=<UUID>`    | Load all pages of desired peers and their observations.            |
| `POST`   | `/v1/peers`                           | Create a generated-key or external-key client.                     |
| `GET`    | `/v1/peers/{peer_id}`                 | Inspect a UUID peer, its lifecycle and applied state.              |
| `GET`    | `/v1/peers/{peer_id}/config-template` | Retrieve a complete template with a private-key placeholder.       |
| `DELETE` | `/v1/peers/{peer_id}`                 | Revoke a client immediately or start a pending revocation.         |
| `GET`    | `/v1/operations/{operation_id}`       | Follow pending operations until complete or cancelled.             |
| `GET`    | `/livez`                              | Process liveness and application version.                          |
| `GET`    | `/readyz`                             | Storage health and WireGuard convergence, including reasons.       |
| `GET`    | `/metrics`                            | Read public Prometheus exposition as text on demand.               |

The initial generated-key response includes the private key and complete `client_config`
once, even when accepted as pending. Save them immediately. An existing peer's
configuration template includes both `[Interface]` and `[Peer]`, with
`PrivateKey = <YOUR_PRIVATE_KEY>`. Replace that placeholder locally with your retained
private key before import. The API has no private-key recovery endpoint.

### Persistence and configurations

- `localStorage` saves only each server's name, URL and ID using a versioned schema.
  The registry is local to that browser and origin; it is not shared between users.
- Tokens stay in memory. Reloading the page or opening another tab restores locked
  connections that require entering their tokens again.
- Queries are isolated by server and session. Updating credentials, locking a
  connection or removing it discards its cache.
- Creation uses `POST /v1/peers` with `key_mode: "generated"` or `"external"`, an
  optional bare IPv4 `address`, and a distinct `Idempotency-Key`. External mode
  requires a canonical WireGuard public key. CIDRs and `allowed_ips` are not accepted.
- The board downloads `client_config` exactly as returned by the backend, retaining
  its DNS, endpoint and routes. It does not rebuild the file or make a second request
  to obtain the generated configuration.
- Download the file before closing the dialog. Private keys are not saved in
  browser storage and cannot be recovered later through the API.
- A `202` creation is pending, not a completed setup. **Download .conf**, **Copy config**
  and **Save creation response** let you retain credentials immediately; wait for
  operation completion before importing or activating the tunnel. Its QR is shown
  only after completion. `cancelled` means creation was superseded by deletion.
- Creation and deletion are not retried automatically. **Retry same request** resends
  the identical body and idempotency key after a creation failure. A replay recovers
  peer/operation identity but returns no private key or complete generated config.
  If the initial generated response was lost, revoke the recovered peer, wait for
  completed revocation, then create a replacement with a new request key.
- A `204` deletion is complete. A `202` deletion stays pending and retains the address
  reservation until the operation confirms removal. Operation progress stays visible
  after the dialog closes and refreshes the inventory when terminal.
- Operation polling follows `Retry-After`, defaulting to five seconds. Tracking is
  scoped to the server/session, retained while switching servers, and cleared when
  locking, changing credentials, removing a connection or reloading. The backend
  continues reconciliation independently of the board.
- Existing peers offer **View config template**, **Copy template** and **Download
  template .conf**. When supplying your own public key, configure the private key
  on the device using this template.

Peer-row traffic is shown from the server's perspective as cumulative values from
the WireGuard snapshot. **Recent** means a handshake occurred within the last three
minutes; it does not represent a permanent connection or confirm reachability.
Missing observations display as unavailable rather than invented zero traffic.
The readiness probe returns `503` with `status: "not_ready"` when the node is not
converged; this is distinct from process liveness. Prometheus `NaN` peer counts and
`-1` pending-operation counts also indicate unavailable data.

### VPN and system telemetry

The dashboard queries authenticated `/v1/stats` and `/v1/system` independently every
15 seconds. Manual **Refresh** updates both. Queries are isolated by server/session
and pause background polling. Failures show a panel-specific retry; previously cached
telemetry is hidden after a failed refresh, while peer management and the other panel
remain usable. The connection test does not require these collectors to be healthy.

- **VPN telemetry** uses the backend's aggregates rather than summing the displayed
  peer list: registered/state/applied/observed/unmanaged counts, recent and never
  handshakes, latest handshake, address reservations, and pending operations.
- RX is client upload received by the server; TX is client download sent by the server.
  Cards show measured bytes/second and accumulated bytes for the current interface,
  including unmanaged peers. Counters can reset and are not persisted historical totals.
  Rates are `null` while warming up or after counter/membership changes; the board
  displays `—`, distinguishing unavailable rates from a measured `0 B/s`.
- **System resources** shows effective CPU cores, cumulative CPU time, CPU percentage,
  memory usage/effective capacity/configured limit, filesystem usage/free space,
  and OS/kernel/architecture/Python/API versions and process uptime.
- CPU and memory describe `current_cgroup`, normally the container in Docker, not
  host-wide usage. A CPU quota of 0.5 cores can reach 100%; short bursts may exceed
  100% and are displayed without capping. `warming_up`, partial telemetry and missing
  resources are identified explicitly. A missing configured memory limit is distinct
  from unavailable memory data.
- Disk describes `data_filesystem`: the filesystem containing `WG_DATA_DIR`, not
  the data directory's size or a container quota.
- Both panels show the backend sample timestamp, age at fetch and measured interval.
  Backend sampling is independent of dashboard polling. Stale/failed samples return
  safe errors such as `telemetry_unavailable`; they are not treated as healthy zeros.

### Proxy, CORS and HTTPS

The browser sends requests only to the board's own `/api/wireguard` endpoint.
The selected API URL is passed in `X-WireGuard-Server`, and the API path in the
`path` query parameter. `X-API-Token` and `Idempotency-Key` are forwarded only when
needed. Tokens are never placed in URLs. The proxy preserves response status codes,
JSON/text bodies and `Retry-After`/`Location`; it does not retry mutations.

No API CORS configuration is required for this flow. A board hosted over HTTPS
can reach a public HTTP API through the server-to-server proxy without browser
mixed-content blocking. HTTP on the proxy-to-API connection is still unencrypted;
use HTTPS for that connection when transporting credentials across the internet.
HTTPS certificates must be valid for the API hostname or IP; certificate checks
are not disabled. Clipboard access requires HTTPS or localhost.

Enter the API's final URL. HTTP redirects are rejected. HTTP(S) URLs with a
reverse-proxy path prefix, such as `https://vpn.example.com/api`, are supported.
Public IPv4, native global IPv6 and hostnames resolving exclusively to public IPs
are accepted. Loopback, private, link-local, multicast, reserved and transition
addresses are rejected, including alternate numeric forms and mixed public/private
DNS answers. Hostnames are resolved once per request, and the connection is pinned
to a validated IP while retaining the original Host header and TLS identity.

The endpoint is public, with no board login or server allowlist. Authentication
for `/v1` operations is enforced by each WireGuard API using its token; the API's
public probes and metrics remain public. The proxy restricts methods, routes and
query parameters to the supported API, forwards no cookies or arbitrary headers,
and does not persist destinations or credentials or log request/response bodies.
Server names and URLs are still saved only in the browser's local registry.

Requests are limited to 16 KiB, responses to 2 MiB, and each proxy request to
10 seconds. The browser uses a 12-second deadline. Responses, including errors,
use `Cache-Control: no-store`. Proxy errors have `proxy_*` codes and distinguish
invalid destinations, rejected routes, network failures and timeouts from backend
errors. Cancelling a request does not undo an operation already accepted by the API;
the board's existing idempotency and operation tracking handle that case.

### Backend compatibility

The board targets the documented versioned `/v1` API. Upgrade the backend and board
together: the old `/health`, unversioned `/peers`, public-key URLs and partial-config
contracts are incompatible. Peer detail, template and deletion URLs now use UUIDs.
Existing saved server metadata remains usable; reconnect with the deployment token.

The backend owns the entire IPv4-only interface inventory and returns client routes
for `0.0.0.0/0`. Follow its README for deployment upgrades and legacy inventory
migration; the board does not migrate backend storage or server identity.

## Stack

- **React 19** and **TypeScript** for the interface.
- **Vite 8** for development and production builds.
- **Tailwind CSS 4** for styling.
- **shadcn/ui** and **Radix UI** for components.
- **Lucide React** for icons.
- **TanStack Query** for per-server queries and mutations.
- **Zod** for validating backend responses.
- **qrcode.react** for local QR codes.
- **Oxlint** for static analysis.
- **Prettier** for code formatting.
- **Vitest**, **Testing Library** and **happy-dom** for tests and coverage.
- **pnpm** for dependency management.

## Local development

### Requirements

- Node.js 24 LTS, matching CI and the native TypeScript operator scripts.
- pnpm `11.25.0`, pinned in `package.json`.
- One or more `wireguard-api` instances to connect real servers. See the backend's
  README for deployment instructions.

### Installation and startup

```bash
pnpm install
pnpm dev
```

Open the URL printed by Vite in the terminal.

### Available commands

| Command                   | Description                                                         |
| ------------------------- | ------------------------------------------------------------------- |
| `pnpm dev`                | Start the development server.                                       |
| `pnpm format`             | Apply Prettier formatting.                                          |
| `pnpm format:check`       | Check formatting without modifying files.                           |
| `pnpm lint`               | Run Oxlint and apply available automatic fixes.                     |
| `pnpm lint:check`         | Run Oxlint without modifying files.                                 |
| `pnpm typecheck`          | Check application and configuration types with TypeScript.          |
| `pnpm build`              | Check types and generate the production build in `dist/`.           |
| `pnpm preview`            | Serve the production build locally for review.                      |
| `pnpm test`               | Run unit and integration tests against a simulated API.             |
| `pnpm coverage`           | Run tests and generate coverage reports in `coverage/`.             |
| `pnpm check`              | Run lint, formatting, type checks and tests without changing files. |
| `pnpm smoke:deployment`   | Exercise the deployed board and clean up a disposable test peer.    |
| `pnpm firewall:configure` | Stage the Vercel-backed proxy rate-limit rule.                      |

Lint commands fail on errors or warnings. To verify the project without modifying
source files:

```bash
pnpm format:check
pnpm lint:check
pnpm typecheck
pnpm test
pnpm coverage
pnpm build
```

## Project structure

```text
src/
  app.tsx          # Main component
  app.css          # Application styles
  main.tsx         # Entry point
  index.css        # Global styles and theme tokens
  components/ui/   # shadcn/ui components
  features/
    servers/       # Connection registration and settings
    dashboard/     # Health, statistics and peer list
    peers/         # Creation, configuration, details and deletion
  hooks/           # Server registry and in-memory sessions
  lib/             # API client, validation, storage, configuration and formatting
  test/            # Fixtures and integration tests
  assets/          # Frontend assets
public/            # Static assets
api/
  wireguard.ts     # Vercel Web handler
server/            # Public destination validation, bounded transport and Vite adapter
scripts/           # Firewall setup and deployed smoke-test runner
```

The `@/` alias points to `src/`. Theme tokens are defined in `src/index.css`.
The interface uses a light theme. Project source files and folders use kebab-case;
configuration files retain their tools' naming conventions.

To add shadcn/ui components:

```bash
pnpm dlx shadcn@latest add card input dialog
```

## Deployment on Vercel

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm coverage
pnpm build
```

Import this repository into Vercel and use the Vite framework preset. The included
`vercel.json` selects `pnpm build`, the `dist/` output directory and the Node function
at `api/wireguard.ts`, with a 15-second platform limit and request cancellation.
Use Node.js 24 LTS for builds, functions and operator scripts.

There are no mandatory environment variables, preconfigured server lists or tokens
in the build. Register public API URLs and session tokens from the interface;
adding a new destination does not require redeploying. Production and preview
deployments call their own same-origin proxy, so API CORS origins do not need to
change between deployments.

Publish the native rate-limit rule below for each Vercel project. Protected preview
deployments require a Deployment Protection bypass secret for automated smoke
requests; ordinary public production deployments do not.

Uploading `dist/` alone to a static host does not deploy the proxy. Other hosting
must provide the same `/api/wireguard` Node handler. `pnpm dev` and `pnpm preview`
already include the local adapter. Tests use simulated APIs and isolated local
HTTP servers; they do not require privileged networking or a live VPN API.

### Proxy rate limiting

Vercel's native WAF counts requests whose path starts with `/api/wireguard`, before
invoking the function. It uses neither an in-memory application counter nor a new
database or SDK subrequest. The default rule allows **240 requests per
60 seconds per client IP per region**. Requests share a bucket across the caller's
servers, so switching destinations or tokens does not reset the limit. Tune the
request count for larger workspaces or multiple users behind the same NAT.

Authenticate and link the Vercel project, then stage the rule:

```bash
vercel login
vercel link
pnpm firewall:configure
vercel firewall diff
vercel firewall publish --yes
```

If the named **WireGuard proxy** rule already exists, use
`pnpm firewall:configure --update` to update it instead of creating another one.
The setup command stages the path-based policy in `server/firewall-policy.ts`; inspect the
draft before publishing because Vercel publishes all pending firewall changes.
Hobby supports one rate-limit rule; use this rule rather than creating duplicates.

The WAF uses the actual connection's client IP and counts all methods together;
client-supplied headers and API tokens are not counting keys. Excess requests
receive HTTP `429` at the edge without resolving DNS, invoking the function or
contacting a WireGuard API. The board handles non-JSON edge responses and displays
a one-minute cooldown message when no backend explanation is supplied. Vercel
controls the mitigation response headers; the application does not replace them.
Counters are regional, not a single global quota, and local Vite does not emulate
them. Verify the published rule with `vercel firewall rules inspect "WireGuard proxy"`;
deploying application code alone does not create or activate the firewall policy.

### Security headers

`vercel.json` applies CSP, framing protection, `nosniff`, `Referrer-Policy`,
Permissions Policy and HSTS. CSP restricts scripts and connections to the board's
own origin, with no inline-script allowance. Inline styles remain allowed for
React/Radix component styling. Fonts are local, and QR codes are generated locally.
Vite preview sends the same policies except HSTS so they can be verified over
localhost HTTP; development omits the restrictive CSP for Vite's HMR tooling.

### Server import and export

Use **Import / export** in the workspace header. **Export servers** downloads
`wireguard-servers.json` with a versioned list of `id`, `name` and `url` only.
The file contains no API tokens, private keys, client configurations or session
identifiers. Keep it as a local backup or transfer it to another browser.

Import accepts JSON files up to 1 MiB and 250 entries. URLs are validated and
normalized; duplicates in the file are collapsed and URLs already registered are
skipped. Confirm the preview to merge the new connections. New browser IDs are
generated, new connections start locked, and existing connections and their active
tokens are preserved. Import does not contact any API. Files containing token or
other extra fields are rejected rather than loaded as credentials.

## Automation

`.github/workflows/checks.yml` runs on pushes to `main` and pull requests. It uses
Node.js 24, the pinned pnpm version and a frozen lockfile; checks lint and format;
runs tests with coverage thresholds; and typechecks/builds the frontend and proxy.
Coverage reports are uploaded as a seven-day artifact. Workflow actions are pinned
to commit SHAs and permissions are limited to reading repository contents.

Dependabot checks npm/pnpm dependencies and GitHub Actions weekly. Routine minor
and patch dependency updates are grouped, while major npm upgrades arrive
separately. Updates go through the same PR checks; they are not auto-merged.

### Deployed smoke test

Use a test WireGuard API reachable through the public-destination proxy. Copy
`.env.smoke.example` to `.env.smoke.local` and configure:

| Variable              | Purpose                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------- |
| `SMOKE_BOARD_URL`     | HTTPS origin of the deployed board. Localhost HTTP is accepted for preview checks.          |
| `SMOKE_API_URL`       | Public HTTP(S) address of the test WireGuard API.                                           |
| `SMOKE_API_TOKEN`     | Token for the test API. Keep it in the gitignored local file or GitHub environment secrets. |
| `SMOKE_BYPASS_SECRET` | Optional Vercel Deployment Protection bypass secret for protected deployments.              |

```bash
pnpm smoke:deployment
```

The runner verifies deployment headers, liveness/readiness, authenticated server
information, paginated inventory and text metrics. It creates one generated-key
peer, validates its returned client configuration, replays exactly the same
idempotency key/body, follows pending application and checks the peer is applied.
It then revokes that exact newly created UUID and verifies its removal. Cleanup
runs even when later assertions fail. An identity that existed in the initial
inventory is never deleted. Polling honors `Retry-After`, with bounded deadlines;
the test server must have at most 2,000 peers.

The runner does not log tokens, private keys or configuration contents and does
not write generated credentials to disk. If no identity can be recovered after
a lost creation response, it reports the non-secret request key for investigation.
If cleanup cannot complete, it reports the exact disposable UUID to revoke manually.
The configuration response is verified by this HTTP smoke test; browser download,
copy and QR behavior are covered by the UI integration tests.

To run it in GitHub, configure a `wireguard-smoke` environment with the two URL
variables and the token/bypass secrets above. Manually dispatch **Deployment smoke
test** from `main`. It is not run on pull requests or automatically against live
servers. The workflow serializes runs so smoke tests do not overlap.

## Community

Contributions are welcome. Read the [contribution guidelines](CONTRIBUTING.md)
for development conventions, verification commands and the pull request process.
Participation is governed by our [Code of Conduct](CODE_OF_CONDUCT.md).

Use the [issue templates](https://github.com/ragnarok22/wireguard-board/issues/new/choose)
for bug reports and feature requests. Report vulnerabilities privately following
the [Security Policy](SECURITY.md).

## License

WireGuard Board is licensed under the [GNU General Public License, version 3](LICENSE).
