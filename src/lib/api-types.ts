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
export type CreatedPeer = z.infer<typeof createdPeerSchema> & { retryAfterMs: number }
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
