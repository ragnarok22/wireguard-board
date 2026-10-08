import type {
  Operation,
  Peer,
  ServerConnection,
  SystemInfo,
  VpnStats,
} from '@/lib/api-types'

export const server: ServerConnection = {
  id: 'amsterdam',
  name: 'Amsterdam',
  url: 'https://amsterdam.example.com',
  token: 'session-secret',
  session: 'session-one',
}
export const publicKey = 'a'.repeat(42) + 'A='
export const privateKey = 'b'.repeat(42) + 'A='
export const serverKey = 'c'.repeat(42) + 'A='
export const peer: Peer = {
  id: '79a94a53-c94a-46c7-ab91-bc52196c1355',
  public_key: publicKey,
  address: '10.13.13.2',
  state: 'active',
  created_at: 1800000000,
  applied: true,
  observation: {
    public_key: publicKey,
    allowed_ips: ['10.13.13.2/32'],
    endpoint: '198.51.100.1:51820',
    latest_handshake: Math.floor(Date.now() / 1000) - 30,
    transfer_rx: 1048576,
    transfer_tx: 2097152,
    persistent_keepalive: 25,
  },
}
export const health = {
  status: 'ready',
  version: '1.0.0',
  uptime_seconds: 3600,
  interface: 'wg0',
  reason: null,
}
export const live = { status: 'alive', version: '1.0.0' }
export const vpnStats: VpnStats = {
  version: '1.0.0',
  uptime_seconds: 3600,
  sample: { sampled_at: 1800000000, age_seconds: 0.5, interval_seconds: 1 },
  peers: {
    registered: 4,
    active: 2,
    pending: 1,
    deleting: 1,
    applied: 2,
    observed: 3,
    unmanaged: 1,
  },
  handshakes: {
    recent: 2,
    never: 1,
    latest_at: 1800000000,
    window_seconds: 180,
  },
  traffic: {
    scope: 'current_interface',
    rx_bytes: 1048576,
    tx_bytes: 2097152,
    rx_bytes_per_second: 1024,
    tx_bytes_per_second: 2048,
  },
  pool: {
    network: '10.13.13.0/24',
    capacity: 253,
    reserved: 4,
    available: 249,
  },
  pending_operations: 2,
}
export const systemInfo: SystemInfo = {
  status: 'available',
  resource_scope: 'current_cgroup',
  sample: { sampled_at: 1800000000, age_seconds: 0.25, interval_seconds: 1 },
  cpu: {
    source: 'cgroup_v2',
    status: 'available',
    capacity_cores: 0.5,
    total_usage_seconds: 900,
    used_cores: 0.25,
    usage_percent: 50,
  },
  memory: {
    source: 'cgroup_v2',
    used_bytes: 134217728,
    limit_bytes: 268435456,
    capacity_bytes: 268435456,
    usage_percent: 50,
  },
  disk: {
    scope: 'data_filesystem',
    total_bytes: 107374182400,
    used_bytes: 26843545600,
    free_bytes: 80530636800,
    usage_percent: 25,
  },
  runtime: {
    os: 'Linux',
    kernel: '6.12.0',
    architecture: 'aarch64',
    python_version: '3.14.0',
    api_version: '1.0.0',
    uptime_seconds: 3600,
  },
}
export const serverInfo = {
  public_key: serverKey,
  endpoint: 'vpn.your-domain.tld:51820',
  interface: 'wg0',
  address: '10.13.13.1/24',
  pool: '10.13.13.0/24',
  capacity: 253,
  reserved: 1,
  available: 252,
}
export const operation: Operation = {
  id: 'e5df978a-5c11-4d17-b425-4aeb2c349cb8',
  peer_id: peer.id,
  kind: 'create',
  status: 'complete',
  public_key: publicKey,
  address: peer.address,
  error: null,
  created_at: 1800000000,
  request_key: 'client-test',
  fingerprint: 'request-fingerprint',
}
export const clientConfig = `[Interface]\nPrivateKey = ${privateKey}\nAddress = 10.13.13.2/32\nDNS = 9.9.9.9\n\n[Peer]\nPublicKey = ${serverKey}\nEndpoint = vpn.your-domain.tld:51820\nAllowedIPs = 0.0.0.0/0\nPersistentKeepalive = 25\n`
export const configTemplate = clientConfig.replace(
  privateKey,
  '<YOUR_PRIVATE_KEY>',
)
export const createdPeer = {
  peer,
  operation,
  private_key: privateKey,
  client_config: clientConfig,
  replayed: false,
}
export const jsonResponse = (
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
