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

const counter = z
  .union([z.number(), z.string().regex(/^\d+$/)])
  .pipe(z.coerce.number<number | string>().finite().nonnegative())
const handshake = z
  .union([counter, z.null(), z.literal('(none)')])
  .transform((value) => (typeof value === 'number' && value > 0 ? value : null))

export const peerSchema = z.object({
  public_key: z.string().min(1),
  allowed_ips: z.array(z.string()),
  endpoint: z
    .string()
    .nullable()
    .transform((value) => (value === '(none)' ? null : value)),
  latest_handshake: handshake,
  transfer_rx: counter,
  transfer_tx: counter,
  persistent_keepalive: z
    .union([counter, z.literal('off')])
    .transform((value) => (value === 'off' ? 0 : value)),
})

export const peersSchema = z.array(peerSchema)
export type Peer = z.infer<typeof peerSchema>

export const healthSchema = z.object({
  status: z.enum(['healthy', 'unhealthy']),
  version: z.string(),
  uptime_seconds: z.number().nonnegative(),
  wireguard_interface: z.string(),
  wireguard_available: z.boolean(),
  peer_count: z.number().int().nonnegative(),
})

export const createdPeerSchema = z.object({
  public_key: z.string().min(1),
  allowed_ips: z.array(z.string()).min(1),
  private_key: z.string().nullable().optional(),
})

export const partialConfigSchema = z.object({
  config: z.string().min(1),
  note: z.string().optional(),
})
export type CreatedPeer = z.infer<typeof createdPeerSchema>
export type PeerInput = { public_key?: string; allowed_ips?: string[] }

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
