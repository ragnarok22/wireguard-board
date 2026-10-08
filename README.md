# WireGuard Board

A web dashboard for managing multiple WireGuard servers from a single interface.
Each server runs its own instance of
[wireguard-api](https://github.com/ragnarok22/wireguard-api), which provides a REST
API for managing VPN clients and checking service health.

## Project status

An implemented static frontend with an English-language, responsive interface.
The browser connects directly to each API instance without an intermediate Node
service. The board includes a server registry, a dashboard and peer management.
Integration is verified against simulated REST API responses; connecting real
servers requires CORS configuration and a compatible backend version.

## Features

- **Multiple servers:** add, edit and remove server connections, each with its own
  name, API base URL and credentials.
- **Overview:** check server availability and peer counts.
- **Peer management:** list, create, inspect and delete VPN clients on the selected
  server. A peer represents a WireGuard device or client.
- **Client configurations:** download a ready-to-import `.conf` file when creating
  a peer with API-generated keys, copy the configuration or scan its QR code.
  QR codes are generated locally without sending keys to external services.
- **Monitoring:** view traffic statistics and the latest handshake reported by
  the API.
- **Refresh:** automatic polling every 15 seconds in the active view, plus manual
  refresh. Polling pauses when the browser tab is in the background.
- **Sessions:** lock a connection to discard its token and cached data.
- **Search:** filter peers by IP address, public key, endpoint or recent activity.

Adding a server to the dashboard connects an existing `wireguard-api` instance.
Server deployment and network configuration are managed in the backend project.

## Integration with wireguard-api

Backend repository: <https://github.com/ragnarok22/wireguard-api>.

Each WireGuard server has its own API instance. The dashboard sends each operation
to the selected instance:

```text
WireGuard Board
  ├── wireguard-api · Server A
  ├── wireguard-api · Server B
  └── wireguard-api · Server C
```

### Connecting a server

Select **Add server**, enter the following details and select **Test & save**.
Both `/health` and authenticated access to `/peers` are checked before saving:

| Field        | Description                                                          |
| ------------ | -------------------------------------------------------------------- |
| Name         | A readable name for the server in the dashboard.                     |
| API base URL | The instance's HTTP(S) address, such as `https://vpn-a.example.com`. |
| API token    | The value of `API_TOKEN` configured on that instance.                |

The API listens on TCP `8008` by default. This address is separate from the VPN
endpoint, which uses UDP `51820` by default and is configured through
`SERVER_ENDPOINT` in the backend.

Operations on `/peers` require the `X-API-Token` header. The `/health` and `/metrics`
endpoints are public. Each instance provides interactive API documentation at
`/docs`.

### Relevant endpoints

| Method   | Endpoint                     | Dashboard usage                                                |
| -------- | ---------------------------- | -------------------------------------------------------------- |
| `GET`    | `/health`                    | Check availability, version, uptime, interface and peer count. |
| `GET`    | `/peers`                     | List clients and their current statistics.                     |
| `POST`   | `/peers`                     | Create a client and receive its details as JSON.               |
| `GET`    | `/peers/{public_key}`        | Inspect a specific client.                                     |
| `GET`    | `/peers/{public_key}/config` | Retrieve a partial configuration as JSON.                      |
| `DELETE` | `/peers/{public_key}`        | Remove a client from the server.                               |

The API returns a generated private key only when creating the client and does
not retain it. Save the complete configuration at that point. The configuration
endpoint for an existing peer returns the server's `[Peer]` block; it cannot
recover the private key or provide a complete, ready-to-import file on its own.

### Persistence and configurations

- `localStorage` saves only each server's name, URL and ID using a versioned schema.
  The registry is local to that browser and origin; it is not shared between users.
- Tokens stay in memory. Reloading the page or opening another tab restores locked
  connections that require entering their tokens again.
- Queries are isolated by server and session. Updating credentials, locking a
  connection or removing it discards its cache.
- Creation uses `POST /peers`, followed by `GET /peers/{public_key}/config`, to
  combine the generated private key with the actual `[Peer]` block. This follows
  the backend's default configuration: the first assigned address, DNS `1.1.1.1`
  and the routes in the block returned by the API.
- Download the file before closing the dialog. Private keys are not saved in
  browser storage and cannot be recovered later through the API.
- If the second step fails, **Retry configuration** repeats only the GET request.
  **Save creation response** preserves the private key and address so you can
  configure the client.
- Creation and deletion requests are not retried automatically. If a creation
  response is lost, refresh the peer list before creating another peer.
- Existing peers offer only a partial configuration, clearly identified as such.
  When supplying your own public key, configure the private key on the device.

Traffic is shown from the server's perspective as cumulative values from the
WireGuard snapshot, not per-second rates. **Recent** means a handshake occurred
within the last three minutes; it does not represent a permanent connection or
confirm reachability.

### CORS and HTTPS

Each API must allow the origin serving the board. Configure CORS in the backend
or its reverse proxy. For FastAPI, add the following after creating `app`:

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://board.example.com", "http://localhost:5173"],
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["X-API-Token", "Content-Type"],
    allow_credentials=False,
)
```

The middleware must also respond to `OPTIONS` preflight requests. When configuring
CORS through a proxy, apply the headers to error responses as well. Use Vite's
exact origin if its port changes. The board does not send cookies or follow
redirects, so enter the API's final URL. URLs with a path prefix, such as
`https://vpn.example.com/api`, are supported.

A board served over HTTPS needs APIs reachable over HTTPS to avoid mixed-content
blocking. Clipboard access requires a secure context: HTTPS or localhost.

### Backend compatibility

The integration follows the endpoints documented in `wireguard-api`. The `main`
revision reviewed during implementation (`b703a9c6`) had an internal incompatibility:
`api.py` expected `restore_peers`, `create_peer` and `delete_peer` methods, and peer
dictionaries; `wireguard.py` exposed `add_peer`, `remove_peer` and `PeerStats`
objects. Use a backend version with consistent operations and serialization.

Public keys are encoded when included in URLs. The backend and its proxy must
accept keys containing `/`, `+` and `=` in the detail, configuration and deletion
endpoints. If the router decodes `%2F` as a path separator before matching the
route, it must support that case. Tests verify the URL encoding emitted by the
frontend.

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

- A Node.js version supported by Vite 8: `20.19+` or `22.12+`.
- pnpm.
- One or more `wireguard-api` instances to connect real servers. See the backend's
  README for deployment instructions.

### Installation and startup

```bash
pnpm install
pnpm dev
```

Open the URL printed by Vite in the terminal.

### Available commands

| Command             | Description                                                         |
| ------------------- | ------------------------------------------------------------------- |
| `pnpm dev`          | Start the development server.                                       |
| `pnpm format`       | Apply Prettier formatting.                                          |
| `pnpm format:check` | Check formatting without modifying files.                           |
| `pnpm lint`         | Run Oxlint and apply available automatic fixes.                     |
| `pnpm lint:check`   | Run Oxlint without modifying files.                                 |
| `pnpm typecheck`    | Check application and configuration types with TypeScript.          |
| `pnpm build`        | Check types and generate the production build in `dist/`.           |
| `pnpm preview`      | Serve the production build locally for review.                      |
| `pnpm test`         | Run unit and integration tests against a simulated API.             |
| `pnpm coverage`     | Run tests and generate coverage reports in `coverage/`.             |
| `pnpm check`        | Run lint, formatting, type checks and tests without changing files. |

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
```

The `@/` alias points to `src/`. Theme tokens are defined in `src/index.css`.
The interface uses a light theme. Project source files and folders use kebab-case;
configuration files retain their tools' naming conventions.

To add shadcn/ui components:

```bash
pnpm dlx shadcn@latest add card input dialog
```

## Static deployment

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm coverage
pnpm build
```

Publish the contents of `dist/` to any static hosting service. No environment
variables are required and no tokens are included in the build; connections are
registered through the interface. Tests do not require privileged networking or
a live API.
