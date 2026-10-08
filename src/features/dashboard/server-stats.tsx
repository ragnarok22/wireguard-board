import { ArrowDownLeft, ArrowUpRight, Radio, Users } from 'lucide-react'
import type { VpnStats } from '@/lib/api-types'
import { formatBytes } from '@/lib/formatters'

function rate(value?: number | null) {
  return value == null ? '—' : `${formatBytes(value)}/s`
}

export function ServerStats({ stats }: { stats?: VpnStats }) {
  const cards = [
    {
      label: 'Registered peers',
      value: stats?.peers.registered ?? '—',
      description: 'Desired inventory, including deleting peers',
      icon: Users,
    },
    {
      label: 'Recent handshakes',
      value: stats?.handshakes.recent ?? '—',
      description: stats
        ? `Activity in the last ${stats.handshakes.window_seconds}s`
        : 'Waiting for VPN telemetry',
      icon: Radio,
    },
    {
      label: 'Receive rate',
      value: rate(stats?.traffic.rx_bytes_per_second),
      description: stats
        ? `${formatBytes(stats.traffic.rx_bytes)} received by server`
        : 'Waiting for VPN telemetry',
      icon: ArrowDownLeft,
    },
    {
      label: 'Send rate',
      value: rate(stats?.traffic.tx_bytes_per_second),
      description: stats
        ? `${formatBytes(stats.traffic.tx_bytes)} sent by server`
        : 'Waiting for VPN telemetry',
      icon: ArrowUpRight,
    },
  ]
  return (
    <div className="stat-grid" aria-label="VPN statistics">
      {cards.map(({ label, value, description, icon: Icon }) => (
        <div key={label} className="stat-card">
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
