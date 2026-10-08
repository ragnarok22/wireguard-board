import { useState } from 'react'
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  CircleHelp,
  FileCode2,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/feedback'
import type { Peer } from '@/lib/api-types'
import {
  formatBytes,
  handshakeLabel,
  isRecentlyActive,
  shortKey,
} from '@/lib/formatters'

function PeerRow({
  peer,
  onSelect,
}: {
  peer: Peer
  onSelect: (peer: Peer) => void
}) {
  const recent = isRecentlyActive(peer.latest_handshake)
  return (
    <tr>
      <td>
        <div className="peer-identity">
          <span className="peer-avatar">
            <FileCode2 size={18} />
          </span>
          <div>
            <button className="peer-link" onClick={() => onSelect(peer)}>
              {peer.allowed_ips.join(', ') || 'Unassigned peer'}
            </button>
            <span className="mono">{shortKey(peer.public_key)}</span>
          </div>
        </div>
      </td>
      <td>
        <span className={`activity-tag ${recent ? 'recent' : ''}`}>
          <span className="status-dot" />
          {recent ? 'Recent' : peer.latest_handshake ? 'Idle' : 'Never seen'}
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
          onClick={() => onSelect(peer)}
        >
          <ChevronRight size={18} />
        </button>
      </td>
    </tr>
  )
}

function PeerEmptyState({
  loading,
  unavailable,
  empty,
  canCreate,
  onCreate,
  onClear,
}: {
  loading: boolean
  unavailable: boolean
  empty: boolean
  canCreate: boolean
  onCreate: () => void
  onClear: () => void
}) {
  if (loading)
    return (
      <div className="panel-empty" role="status">
        <Spinner />
        <h3>Loading your peers</h3>
        <p>Fetching the current WireGuard snapshot.</p>
      </div>
    )
  if (unavailable)
    return (
      <div className="panel-empty">
        <CircleHelp size={32} />
        <h3>Peers could not be loaded</h3>
        <p>Check the connection and try again.</p>
      </div>
    )
  if (empty)
    return (
      <div className="panel-empty">
        <span className="empty-icon">
          <FileCode2 />
        </span>
        <h3>Your first connection starts here</h3>
        <p>Add a peer to generate a ready-to-import WireGuard configuration.</p>
        <Button disabled={!canCreate} onClick={onCreate}>
          <Plus />
          Add your first peer
        </Button>
      </div>
    )
  return (
    <div className="panel-empty">
      <Search size={28} />
      <h3>No matching peers</h3>
      <p>Try a different search or activity filter.</p>
      <Button variant="outline" onClick={onClear}>
        Clear filters
      </Button>
    </div>
  )
}

export function PeerList({
  peers,
  loading,
  refreshing,
  canCreate,
  updatedAt,
  onRefresh,
  onCreate,
  onSelect,
}: {
  peers?: Peer[]
  loading: boolean
  refreshing: boolean
  canCreate: boolean
  updatedAt: number
  onRefresh: () => void
  onCreate: () => void
  onSelect: (peer: Peer) => void
}) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const allPeers = peers ?? []
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
  return (
    <section className="peer-panel" aria-labelledby="peers-heading">
      <div className="panel-heading">
        <div>
          <h2 id="peers-heading">
            Peers{' '}
            <span className="count-tag">{peers ? peers.length : '—'}</span>
          </h2>
          <p>A little less configuration. A lot more connection.</p>
        </div>
        <Button variant="outline" onClick={onRefresh} disabled={refreshing}>
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
      {!loading && peers && visiblePeers.length > 0 ? (
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
                <PeerRow
                  key={peer.public_key}
                  peer={peer}
                  onSelect={onSelect}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <PeerEmptyState
          loading={loading}
          unavailable={!peers}
          empty={allPeers.length === 0}
          canCreate={canCreate}
          onCreate={onCreate}
          onClear={() => {
            setSearch('')
            setFilter('all')
          }}
        />
      )}
      <div className="table-footer">
        <span>
          {peers
            ? `Showing ${visiblePeers.length} of ${peers.length} peers`
            : 'Waiting for server data'}
        </span>
        <span>
          <span className="status-dot" />
          Auto-refresh every 15s
          {updatedAt > 0 &&
            ` · Updated ${new Date(updatedAt).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`}
        </span>
      </div>
    </section>
  )
}
