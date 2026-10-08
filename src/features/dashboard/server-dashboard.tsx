import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  CircleHelp,
  FileCode2,
  LockKeyhole,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Settings2,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorNotice, Spinner } from '@/components/ui/feedback'
import { api, errorMessage, serverQueryKey } from '@/lib/api-client'
import type { Peer, ServerConnection } from '@/lib/api-types'
import {
  formatBytes,
  handshakeLabel,
  isRecentlyActive,
  shortKey,
  uptimeLabel,
} from '@/lib/formatters'
import { CreatePeerDialog } from '@/features/peers/create-peer-dialog'
import { PeerDetailsDialog } from '@/features/peers/peer-details-dialog'

export function ServerDashboard({
  server,
  onSettings,
  onLock,
  onNotice,
}: {
  server: ServerConnection
  onSettings: () => void
  onLock: () => void
  onNotice: (message: string) => void
}) {
  const health = useQuery({
    queryKey: [...serverQueryKey(server), 'health'],
    queryFn: ({ signal }) => api.health(server, signal),
    refetchInterval: 15_000,
  })
  const peers = useQuery({
    queryKey: [...serverQueryKey(server), 'peers'],
    queryFn: ({ signal }) => api.peers(server, signal),
    refetchInterval: 15_000,
  })
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [dialog, setDialog] = useState<'create' | Peer | null>(null)
  const allPeers = peers.data ?? []
  const activePeers = allPeers.filter((peer) =>
    isRecentlyActive(peer.latest_handshake),
  )
  const normalizedSearch = search.toLowerCase().trim()
  const visiblePeers = allPeers.filter((peer) => {
    const matchesSearch = [
      peer.public_key,
      ...peer.allowed_ips,
      peer.endpoint ?? '',
    ].some((value) => value.toLowerCase().includes(normalizedSearch))
    return (
      matchesSearch &&
      (filter === 'all' ||
        (filter === 'recent'
          ? isRecentlyActive(peer.latest_handshake)
          : !isRecentlyActive(peer.latest_handshake)))
    )
  })
  const healthy =
    !health.error &&
    health.data?.status === 'healthy' &&
    health.data.wireguard_available
  const status = health.isPending
    ? 'Checking'
    : health.error
      ? 'Unreachable'
      : healthy
        ? 'Healthy'
        : 'Unavailable'
  const traffic = allPeers.reduce(
    (total, peer) => ({
      rx: total.rx + peer.transfer_rx,
      tx: total.tx + peer.transfer_tx,
    }),
    { rx: 0, tx: 0 },
  )
  const refreshing = health.isFetching || peers.isFetching
  async function refresh() {
    await Promise.all([health.refetch(), peers.refetch()])
  }

  return (
    <>
      <header className="page-heading">
        <div>
          <div className="eyebrow">SERVER OVERVIEW</div>
          <h1>{server.name}</h1>
          <p>Keep your network close. Your configuration, under control.</p>
        </div>
        <div className="heading-actions">
          <Button variant="outline" onClick={onSettings}>
            <Settings2 />
            Connection
          </Button>
          <Button
            disabled={!peers.isSuccess || !!peers.error}
            onClick={() => setDialog('create')}
          >
            <Plus />
            Add peer
          </Button>
        </div>
      </header>
      <section className="server-strip" aria-label="Server connection">
        <div className="server-strip-address">
          <span className="server-icon">
            <Radio size={20} />
          </span>
          <div>
            <strong>{new URL(server.url).host}</strong>
            <span>
              {health.data?.wireguard_interface ?? 'WireGuard API'}{' '}
              <span className="separator">/</span> {server.url}
            </span>
          </div>
        </div>
        <div className="server-strip-actions">
          <span
            className={`status-badge ${healthy ? 'healthy' : health.isPending ? '' : 'unhealthy'}`}
          >
            <span className="status-dot" />
            {status}
          </span>
          <button
            className="icon-button"
            aria-label="Lock server"
            title="Forget this session’s API token"
            onClick={onLock}
          >
            <LockKeyhole size={17} />
          </button>
        </div>
      </section>
      {(health.error || peers.error) && (
        <div className="dashboard-error">
          <ErrorNotice
            message={`${errorMessage(peers.error ?? health.error)}${peers.data ? ' Previously fetched data is shown below.' : ''}`}
          />
          <div className="button-row">
            <Button
              variant="outline"
              onClick={() => {
                void refresh()
              }}
              disabled={refreshing}
            >
              <RefreshCw />
              Retry
            </Button>
            <Button variant="outline" onClick={onSettings}>
              Check connection
            </Button>
          </div>
        </div>
      )}
      {health.data?.status === 'unhealthy' && !health.error && (
        <ErrorNotice message="The API is reachable, but its WireGuard interface is unavailable. Check the WireGuard service on this server." />
      )}
      <section className="stat-grid" aria-label="Server statistics">
        <div className="stat-card">
          <div className="stat-label">
            Total peers
            <Users size={18} />
          </div>
          <strong>{peers.data ? allPeers.length : '—'}</strong>
          <span>Devices on this server</span>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            Recently active
            <Radio size={18} />
          </div>
          <strong>
            {peers.data ? activePeers.length : '—'}
            <span className="live-marker" />
          </strong>
          <span>Handshake in the last 3 minutes</span>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            Received
            <ArrowDownLeft size={18} />
          </div>
          <strong>{peers.data ? formatBytes(traffic.rx) : '—'}</strong>
          <span>From peers to this server</span>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            Sent
            <ArrowUpRight size={18} />
          </div>
          <strong>{peers.data ? formatBytes(traffic.tx) : '—'}</strong>
          <span>From this server to peers</span>
        </div>
      </section>
      <section className="peer-panel" aria-labelledby="peers-heading">
        <div className="panel-heading">
          <div>
            <h2 id="peers-heading">
              Peers{' '}
              <span className="count-tag">
                {peers.data ? allPeers.length : '—'}
              </span>
            </h2>
            <p>A little less configuration. A lot more connection.</p>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              void refresh()
            }}
            disabled={refreshing}
          >
            {refreshing ? <Spinner /> : <RefreshCw />}Refresh
          </Button>
        </div>
        <div className="table-toolbar">
          <label className="search-field">
            <Search size={17} />
            <input
              aria-label="Search peers"
              placeholder="Search by IP, key or endpoint…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label className="filter-field">
            <span className="sr-only">Filter peers by activity</span>
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option value="all">All activity</option>
              <option value="recent">Recently active</option>
              <option value="idle">Idle / never seen</option>
            </select>
          </label>
        </div>
        {peers.isPending ? (
          <div className="panel-empty" role="status">
            <Spinner />
            <h3>Loading your peers</h3>
            <p>Fetching the current WireGuard snapshot.</p>
          </div>
        ) : !peers.data ? (
          <div className="panel-empty">
            <CircleHelp size={32} />
            <h3>Peers could not be loaded</h3>
            <p>Check the connection and try again.</p>
          </div>
        ) : allPeers.length === 0 ? (
          <div className="panel-empty">
            <span className="empty-icon">
              <FileCode2 />
            </span>
            <h3>Your first connection starts here</h3>
            <p>
              Add a peer to generate a ready-to-import WireGuard configuration.
            </p>
            <Button
              disabled={!!peers.error}
              onClick={() => setDialog('create')}
            >
              <Plus />
              Add your first peer
            </Button>
          </div>
        ) : visiblePeers.length === 0 ? (
          <div className="panel-empty">
            <Search size={28} />
            <h3>No matching peers</h3>
            <p>Try a different search or activity filter.</p>
            <Button
              variant="outline"
              onClick={() => {
                setSearch('')
                setFilter('all')
              }}
            >
              Clear filters
            </Button>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="peer-table">
              <thead>
                <tr>
                  <th scope="col">Peer / VPN address</th>
                  <th scope="col">Activity</th>
                  <th scope="col">Last handshake</th>
                  <th scope="col">Received / Sent</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visiblePeers.map((peer) => (
                  <tr key={peer.public_key}>
                    <td>
                      <div className="peer-identity">
                        <span className="peer-avatar">
                          <FileCode2 size={18} />
                        </span>
                        <div>
                          <button
                            className="peer-link"
                            onClick={() => setDialog(peer)}
                          >
                            {peer.allowed_ips.join(', ') || 'Unassigned peer'}
                          </button>
                          <span className="mono">
                            {shortKey(peer.public_key)}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span
                        className={`activity-tag ${isRecentlyActive(peer.latest_handshake) ? 'recent' : ''}`}
                      >
                        <span className="status-dot" />
                        {isRecentlyActive(peer.latest_handshake)
                          ? 'Recent'
                          : peer.latest_handshake
                            ? 'Idle'
                            : 'Never seen'}
                      </span>
                    </td>
                    <td>{handshakeLabel(peer.latest_handshake)}</td>
                    <td>
                      <div className="traffic-values">
                        <span>
                          <ArrowDownLeft size={13} />
                          {formatBytes(peer.transfer_rx)}
                        </span>
                        <span>
                          <ArrowUpRight size={13} />
                          {formatBytes(peer.transfer_tx)}
                        </span>
                      </div>
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`View peer ${peer.allowed_ips[0] ?? shortKey(peer.public_key)}`}
                        onClick={() => setDialog(peer)}
                      >
                        <ChevronRight size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="table-footer">
          <span>
            {peers.data
              ? `Showing ${visiblePeers.length} of ${allPeers.length} peers`
              : 'Waiting for server data'}
          </span>
          <span>
            <span className="status-dot" />
            Auto-refresh every 15s
            {peers.dataUpdatedAt > 0 &&
              ` · Updated ${new Date(peers.dataUpdatedAt).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`}
          </span>
        </div>
      </section>
      <div className="overview-footnote">
        <span>
          <LockKeyhole size={14} />
          Tokens stay in this session. You’re in control.
        </span>
        <span>
          {health.data &&
            `API ${health.data.version} · Uptime ${uptimeLabel(health.data.uptime_seconds)}`}
        </span>
      </div>
      {dialog === 'create' && (
        <CreatePeerDialog server={server} onClose={() => setDialog(null)} />
      )}
      {dialog && typeof dialog === 'object' && (
        <PeerDetailsDialog
          server={server}
          peer={dialog}
          onClose={() => setDialog(null)}
          onDeleted={() =>
            onNotice('Peer deleted. Its VPN access has been removed.')
          }
        />
      )}
    </>
  )
}
