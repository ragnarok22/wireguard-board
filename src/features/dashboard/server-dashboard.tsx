import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LockKeyhole, Plus, Radio, RefreshCw, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorNotice } from '@/components/ui/feedback'
import { api, errorMessage, serverQueryKey } from '@/lib/api-client'
import type { Peer, ServerConnection } from '@/lib/api-types'
import { uptimeLabel } from '@/lib/formatters'
import { CreatePeerDialog } from '@/features/peers/create-peer-dialog'
import { PeerDetailsDialog } from '@/features/peers/peer-details-dialog'
import { PeerList } from './peer-list'
import { ServerStats } from './server-stats'
import { TrackedOperations } from '@/features/peers/operation-status'
import { MetricsDialog } from './metrics-dialog'

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
    queryKey: [...serverQueryKey(server), 'readiness'],
    queryFn: ({ signal }) => api.ready(server, signal),
    refetchInterval: 15_000,
  })
  const peers = useQuery({
    queryKey: [...serverQueryKey(server), 'peers'],
    queryFn: ({ signal }) => api.peers(server, signal),
    refetchInterval: 15_000,
  })
  const live = useQuery({
    queryKey: [...serverQueryKey(server), 'liveness'],
    queryFn: ({ signal }) => api.live(server, signal),
    refetchInterval: 15_000,
  })
  const info = useQuery({
    queryKey: [...serverQueryKey(server), 'server-info'],
    queryFn: ({ signal }) => api.server(server, signal),
    refetchInterval: 15_000,
  })
  const [dialog, setDialog] = useState<'create' | 'metrics' | Peer | null>(null)
  const healthy = !health.error && health.data?.status === 'ready'
  const status = health.isPending
    ? 'Checking'
    : health.error
      ? live.data && !live.error
        ? 'Alive · readiness unavailable'
        : 'Unreachable'
      : healthy
        ? 'Ready'
        : 'Not ready'
  const refreshing =
    health.isFetching || peers.isFetching || info.isFetching || live.isFetching
  const canCreate = peers.isSuccess && !peers.error
  async function refresh() {
    await Promise.all([
      health.refetch(),
      peers.refetch(),
      info.refetch(),
      live.refetch(),
    ])
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
          <Button disabled={!canCreate} onClick={() => setDialog('create')}>
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
              {health.data?.interface ?? 'WireGuard API'}{' '}
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
      {(health.error || peers.error || info.error || live.error) && (
        <div className="dashboard-error">
          <ErrorNotice
            message={`${errorMessage(peers.error ?? info.error ?? health.error ?? live.error)}${peers.data ? ' Previously fetched data is shown below.' : ''}`}
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
      {health.data?.status === 'not_ready' && !health.error && (
        <ErrorNotice
          message={`The API is reachable but not ready. Reason: ${health.data.reason ?? 'unavailable'}. Pending operations may still be reconciling.`}
        />
      )}
      {info.data && (
        <section className="notice" aria-label="VPN server information">
          <dl className="detail-grid">
            <div>
              <dt>VPN endpoint</dt>
              <dd>{info.data.endpoint}</dd>
            </div>
            <div>
              <dt>Server address / pool</dt>
              <dd>
                {info.data.address} · {info.data.pool}
              </dd>
            </div>
            <div>
              <dt>Address capacity</dt>
              <dd>
                {info.data.reserved} reserved / {info.data.capacity} total ·{' '}
                {info.data.available} available
              </dd>
            </div>
            <div>
              <dt>Server public key</dt>
              <dd className="full-key">{info.data.public_key}</dd>
            </div>
          </dl>
          <Button variant="outline" onClick={() => setDialog('metrics')}>
            View metrics
          </Button>
        </section>
      )}
      <TrackedOperations server={server} />
      <ServerStats peers={peers.data} />
      <PeerList
        peers={peers.data}
        loading={peers.isPending}
        refreshing={refreshing}
        canCreate={canCreate}
        updatedAt={peers.dataUpdatedAt}
        onRefresh={() => {
          void refresh()
        }}
        onCreate={() => setDialog('create')}
        onSelect={setDialog}
      />
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
          onDeleted={onNotice}
        />
      )}
      {dialog === 'metrics' && (
        <MetricsDialog server={server} onClose={() => setDialog(null)} />
      )}
    </>
  )
}
