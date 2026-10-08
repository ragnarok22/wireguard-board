import { ArrowDownLeft, ArrowUpRight, Radio, Users } from 'lucide-react'
import type { Peer } from '@/lib/api-types'
import { formatBytes, isRecentlyActive } from '@/lib/formatters'

export function ServerStats({ peers }: { peers?: Peer[] }) {
  const activity = peers?.filter(
    (peer) =>
      peer.applied &&
      isRecentlyActive(peer.observation?.latest_handshake ?? null),
  ).length
  const traffic = peers?.every((peer) => peer.observation)
    ? peers.reduce(
        (total, peer) => ({
          rx: total.rx + peer.observation!.transfer_rx,
          tx: total.tx + peer.observation!.transfer_tx,
        }),
        { rx: 0, tx: 0 },
      )
    : undefined
  const stats = [
    {
      label: 'Total peers',
      value: peers?.length ?? '—',
      description: 'Devices on this server',
      icon: Users,
    },
    {
      label: 'Recently active',
      value: peers?.every((peer) => peer.observation) ? activity : '—',
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
