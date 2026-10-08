import { ArrowDownLeft, ArrowUpRight, Radio, Users } from 'lucide-react'
import type { Peer } from '@/lib/api-types'
import { formatBytes, isRecentlyActive } from '@/lib/formatters'

export function ServerStats({ peers }: { peers?: Peer[] }) {
  const activity = peers?.filter((peer) =>
    isRecentlyActive(peer.latest_handshake),
  ).length
  const traffic = peers?.reduce(
    (total, peer) => ({
      rx: total.rx + peer.transfer_rx,
      tx: total.tx + peer.transfer_tx,
    }),
    { rx: 0, tx: 0 },
  )
  const stats = [
    {
      label: 'Total peers',
      value: peers?.length ?? '—',
      description: 'Devices on this server',
      icon: Users,
    },
    {
      label: 'Recently active',
      value: activity ?? '—',
      description: 'Handshake in the last 3 minutes',
      icon: Radio,
    },
    {
      label: 'Received',
      value: traffic ? formatBytes(traffic.rx) : '—',
      description: 'From peers to this server',
      icon: ArrowDownLeft,
    },
    {
      label: 'Sent',
      value: traffic ? formatBytes(traffic.tx) : '—',
      description: 'From this server to peers',
      icon: ArrowUpRight,
    },
  ]
  return (
    <section className="stat-grid" aria-label="Server statistics">
      {stats.map(({ label, value, description, icon: Icon }) => (
        <div key={label} className="stat-card">
          <div className="stat-label">
            {label}
            <Icon size={18} />
          </div>
          <strong>{value}</strong>
          <span>{description}</span>
        </div>
      ))}
    </section>
  )
}
