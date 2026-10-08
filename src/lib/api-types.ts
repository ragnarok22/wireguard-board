import { z } from 'zod'

export const serverMetadataSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  url: z.string().url(),
})

export type ServerMetadata = z.infer<typeof serverMetadataSchema>
export type ServerConnection = ServerMetadata & {
  token?: string
  session: string
}

const counter = z.number().int().nonnegative()
export const observationSchema = z.object({
  public_key: z.string().min(1),
  allowed_ips: z.array(z.string()),
  endpoint: z.string().nullable(),
  latest_handshake: counter.nullable(),
  transfer_rx: counter,
  transfer_tx: counter,
  persistent_keepalive: counter,
})
export const peerSchema = z.object({
  id: z.uuid(),
  public_key: z.string().min(1),
  address: z.ipv4(),
  state: z.enum(['pending', 'active', 'deleting']),
  created_at: z.number().finite().nonnegative(),
  applied: z.boolean(),
  observation: observationSchema.nullable(),
})
export const peersSchema = z.object({
  items: z.array(peerSchema),
  next_cursor: z.uuid().nullable(),
})
export type Peer = z.infer<typeof peerSchema>

export const livenessSchema = z.object({
  status: z.literal('alive'),
  version: z.string(),
})
export const readinessSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  version: z.string(),
  uptime_seconds: z.number().nonnegative(),
  interface: z.string(),
  reason: z.string().nullable(),
})
export const serverInfoSchema = z.object({
  public_key: z.string().min(1),
  endpoint: z.string().min(1),
  interface: z.string(),
  address: z.string(),
  pool: z.string(),
  capacity: counter,
  reserved: counter,
  available: counter,
})
export type ServerInfo = z.infer<typeof serverInfoSchema>
const measurement = z.number().finite().nonnegative()
const sampleSchema = z.object({
  sampled_at: measurement,
  age_seconds: measurement,
  interval_seconds: measurement.nullable(),
})
export const vpnStatsSchema = z.object({
  version: z.string(),
  uptime_seconds: measurement,
  sample: sampleSchema,
  peers: z.object({
    registered: counter,
    active: counter,
    pending: counter,
    deleting: counter,
    applied: counter,
    observed: counter,
    unmanaged: counter,
  }),
  handshakes: z.object({
    recent: counter,
    never: counter,
    latest_at: counter.nullable(),
    window_seconds: z.number().int().min(1).max(3600),
  }),
  traffic: z.object({
    scope: z.literal('current_interface'),
    rx_bytes: counter,
    tx_bytes: counter,
    rx_bytes_per_second: measurement.nullable(),
    tx_bytes_per_second: measurement.nullable(),
  }),
  pool: z.object({
    network: z.string(),
    capacity: counter,
    reserved: counter,
    available: counter,
  }),
  pending_operations: counter,
})
export type VpnStats = z.infer<typeof vpnStatsSchema>
const resourceSource = z.enum(['cgroup_v1', 'cgroup_v2', 'unavailable'])
export const systemInfoSchema = z.object({
  status: z.enum(['available', 'partial']),
  resource_scope: z.literal('current_cgroup'),
  sample: sampleSchema,
  cpu: z.object({
    source: resourceSource,
    status: z.enum(['available', 'warming_up', 'unavailable']),
    capacity_cores: measurement.nullable(),
    total_usage_seconds: measurement.nullable(),
    used_cores: measurement.nullable(),
    usage_percent: measurement.nullable(),
  }),
  memory: z.object({
    source: resourceSource,
    used_bytes: counter.nullable(),
    limit_bytes: counter.nullable(),
    capacity_bytes: counter.nullable(),
    usage_percent: measurement.nullable(),
  }),
  disk: z
    .object({
      scope: z.literal('data_filesystem'),
      total_bytes: counter,
      used_bytes: counter,
      free_bytes: counter,
      usage_percent: measurement,
    })
    .nullable(),
  runtime: z.object({
    os: z.string(),
    kernel: z.string(),
    architecture: z.string(),
    python_version: z.string(),
    api_version: z.string(),
    uptime_seconds: measurement,
  }),
})
export type SystemInfo = z.infer<typeof systemInfoSchema>
export const operationSchema = z.object({
  id: z.uuid(),
  peer_id: z.uuid(),
  kind: z.enum(['create', 'delete']),
  status: z.enum(['pending', 'complete', 'cancelled']),
  public_key: z.string().min(1),
  address: z.ipv4(),
  error: z.string().nullable(),
  created_at: z.number().finite().nonnegative(),
  request_key: z.string().nullable(),
  fingerprint: z.string().nullable(),
})
export type Operation = z.infer<typeof operationSchema>
export type OperationResponse = { operation: Operation; retryAfterMs: number }

export const createdPeerSchema = z.object({
  peer: peerSchema,
  operation: operationSchema,
  private_key: z.string().nullable(),
  client_config: z.string().min(1).nullable(),
  replayed: z.boolean(),
})

export const configTemplateSchema = z.object({
  config: z.string().min(1),
})
export type CreatedPeer = z.infer<typeof createdPeerSchema> & {
  retryAfterMs: number
}
export type PeerInput =
  | { key_mode: 'generated'; address?: string }
  | { key_mode: 'external'; public_key: string; address?: string }

export function normalizeApiUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error(
      'Enter a complete API URL, such as https://vpn.example.com.',
    )
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'Use an HTTP or HTTPS URL without credentials, a query or a fragment.',
    )
  }
  return url.toString().replace(/\/+$/, '')
}
