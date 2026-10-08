import type { UseQueryResult } from '@tanstack/react-query'
import { Cpu, HardDrive, MemoryStick, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/feedback'
import { errorMessage } from '@/lib/api-client'
import type { SystemInfo, VpnStats } from '@/lib/api-types'
import { formatBytes, handshakeLabel, uptimeLabel } from '@/lib/formatters'
import { ServerStats } from './server-stats'

function QueryFeedback({
  loading,
  error,
  onRetry,
  label,
}: {
  loading: boolean
  error: Error | null
  onRetry: () => void
  label: string
}) {
  if (error)
    return (
      <div className="notice notice-error" role="status">
        <span>
          {label} unavailable. {errorMessage(error)} Previous telemetry is
          hidden.
        </span>
        <Button variant="outline" onClick={onRetry}>
          Retry {label.toLowerCase()}
        </Button>
      </div>
    )
  return loading ? (
    <div className="loading-inline" role="status">
      <Spinner />
      Loading {label.toLowerCase()}…
    </div>
  ) : null
}

function SampleDetails({ sample }: { sample: VpnStats['sample'] }) {
  return (
    <p className="telemetry-footnote">
      Sampled {new Date(sample.sampled_at * 1000).toLocaleString()} · Age at
      fetch: {sample.age_seconds}s · Measurement interval:{' '}
      {sample.interval_seconds === null
        ? 'unavailable'
        : `${sample.interval_seconds}s`}
    </p>
  )
}

export function VpnTelemetry({ query }: { query: UseQueryResult<VpnStats> }) {
  const stats = query.isSuccess ? query.data : undefined
  return (
    <section
      className="telemetry-section"
      aria-labelledby="vpn-telemetry-heading"
    >
      <div className="telemetry-heading">
        <h2 id="vpn-telemetry-heading">VPN telemetry</h2>
        <span>Current interface snapshot</span>
      </div>
      <QueryFeedback
        label="VPN statistics"
        loading={query.isPending}
        error={query.error}
        onRetry={() => {
          void query.refetch()
        }}
      />
      <ServerStats stats={stats} />
      {stats && (
        <>
          <dl className="telemetry-details">
            <div>
              <dt>Active / pending / deleting</dt>
              <dd>
                {stats.peers.active} / {stats.peers.pending} /{' '}
                {stats.peers.deleting}
              </dd>
            </div>
            <div>
              <dt>Applied / observed / unmanaged</dt>
              <dd>
                {stats.peers.applied} / {stats.peers.observed} /{' '}
                {stats.peers.unmanaged}
              </dd>
            </div>
            <div>
              <dt>Never handshaken</dt>
              <dd>{stats.handshakes.never}</dd>
            </div>
            <div>
              <dt>Latest handshake</dt>
              <dd>{handshakeLabel(stats.handshakes.latest_at)}</dd>
            </div>
            <div>
              <dt>Pool reservations</dt>
              <dd>
                {stats.pool.reserved} / {stats.pool.capacity} ·{' '}
                {stats.pool.available} available
              </dd>
            </div>
            <div>
              <dt>Pending operations</dt>
              <dd>{stats.pending_operations}</dd>
            </div>
          </dl>
          <p className="telemetry-footnote">
            Traffic includes unmanaged peers on the current interface. Counters
            can reset and are not historical totals. Missing rates need
            comparable samples; recent handshakes do not guarantee connectivity.
          </p>
          <SampleDetails sample={stats.sample} />
        </>
      )}
    </section>
  )
}

const percentFormatter = new Intl.NumberFormat('en', {
  maximumFractionDigits: 1,
})

function percent(value: number | null) {
  return value === null ? '—' : `${percentFormatter.format(value)}%`
}
function bytes(value: number | null) {
  return value === null ? 'Unavailable' : formatBytes(value)
}

function ResourceCards({ system }: { system: SystemInfo }) {
  const cards = [
    {
      label: 'CPU usage',
      value: percent(system.cpu.usage_percent),
      description:
        system.cpu.status === 'warming_up'
          ? 'Warming up · awaiting comparable samples'
          : `${system.cpu.used_cores ?? '—'} / ${system.cpu.capacity_cores ?? '—'} effective cores`,
      icon: Cpu,
    },
    {
      label: 'Memory usage',
      value: percent(system.memory.usage_percent),
      description: `${bytes(system.memory.used_bytes)} / ${bytes(system.memory.capacity_bytes)} effective capacity`,
      icon: MemoryStick,
    },
    {
      label: 'Data filesystem',
      value: system.disk ? percent(system.disk.usage_percent) : '—',
      description: system.disk
        ? `${formatBytes(system.disk.used_bytes)} / ${formatBytes(system.disk.total_bytes)}`
        : 'Unavailable',
      icon: HardDrive,
    },
    {
      label: 'Process uptime',
      value: uptimeLabel(system.runtime.uptime_seconds),
      description: `${system.runtime.os} · ${system.runtime.architecture}`,
      icon: Server,
    },
  ]
  return (
    <div className="stat-grid">
      {cards.map(({ label, value, description, icon: Icon }) => (
        <div className="stat-card" key={label}>
          <div className="stat-label">
            {label}
            <Icon size={18} />
          </div>
          <strong>{value}</strong>
          <span>{description}</span>
        </div>
      ))}
    </div>
  )
}

export function SystemTelemetry({
  query,
}: {
  query: UseQueryResult<SystemInfo>
}) {
  const system = query.isSuccess ? query.data : undefined
  return (
    <section
      className="telemetry-section"
      aria-labelledby="system-telemetry-heading"
    >
      <div className="telemetry-heading">
        <h2 id="system-telemetry-heading">System resources</h2>
        <span>
          {system?.status === 'partial'
            ? 'Partial telemetry'
            : 'Current cgroup'}
        </span>
      </div>
      <QueryFeedback
        label="System telemetry"
        loading={query.isPending}
        error={query.error}
        onRetry={() => {
          void query.refetch()
        }}
      />
      {system && (
        <>
          <ResourceCards system={system} />
          <dl className="telemetry-details">
            <div>
              <dt>CPU / memory source</dt>
              <dd>
                {system.cpu.source} / {system.memory.source}
              </dd>
            </div>
            <div>
              <dt>Cumulative CPU time</dt>
              <dd>
                {system.cpu.total_usage_seconds === null
                  ? 'Unavailable'
                  : `${system.cpu.total_usage_seconds}s`}
              </dd>
            </div>
            <div>
              <dt>Configured memory limit</dt>
              <dd>
                {system.memory.source === 'unavailable'
                  ? 'Unavailable'
                  : system.memory.limit_bytes === null
                    ? 'No configured limit'
                    : formatBytes(system.memory.limit_bytes)}
              </dd>
            </div>
            <div>
              <dt>Filesystem free space</dt>
              <dd>
                {system.disk
                  ? formatBytes(system.disk.free_bytes)
                  : 'Unavailable'}
              </dd>
            </div>
            <div>
              <dt>Kernel / Python</dt>
              <dd>
                {system.runtime.kernel} / {system.runtime.python_version}
              </dd>
            </div>
            <div>
              <dt>API version</dt>
              <dd>{system.runtime.api_version}</dd>
            </div>
          </dl>
          <p className="telemetry-footnote">
            CPU and memory describe the current cgroup, not host-wide usage. CPU
            bursts can exceed 100%. Disk describes the filesystem containing VPN
            data, not directory size or a container quota.
          </p>
          <SampleDetails sample={system.sample} />
        </>
      )}
    </section>
  )
}
