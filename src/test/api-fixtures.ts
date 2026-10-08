import type { Peer, ServerConnection } from '@/lib/api-types'

export const server: ServerConnection = {
  id: 'amsterdam',
  name: 'Amsterdam',
  url: 'https://amsterdam.example.com',
  token: 'session-secret',
  session: 'session-one',
}
export const publicKey = 'a'.repeat(43) + '='
export const privateKey = 'b'.repeat(43) + '='
export const serverKey = 'c'.repeat(43) + '='
export const peer: Peer = {
  public_key: publicKey,
  allowed_ips: ['10.13.13.2/32'],
  endpoint: '198.51.100.1:51820',
  latest_handshake: Math.floor(Date.now() / 1000) - 30,
  transfer_rx: 1048576,
  transfer_tx: 2097152,
  persistent_keepalive: 25,
}
export const health = {
  status: 'healthy',
  version: '0.4.2',
  uptime_seconds: 3600,
  wireguard_interface: 'wg0',
  wireguard_available: true,
  peer_count: 1,
}
export const partialConfig = `[Peer]\nPublicKey = ${serverKey}\nEndpoint = vpn.example.com:51820\nAllowedIPs = 0.0.0.0/0, ::/0\nPersistentKeepalive = 25\n`
export const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
