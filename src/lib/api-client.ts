import type { z } from 'zod'
import {
  configTemplateSchema,
  createdPeerSchema,
  livenessSchema,
  operationSchema,
  peerSchema,
  peersSchema,
  readinessSchema,
  serverInfoSchema,
  systemInfoSchema,
  vpnStatsSchema,
  type Peer,
  type PeerInput,
  type ServerConnection,
} from './api-types'

export class ApiError extends Error {
  readonly status: number
  readonly code?: string
  constructor(message: string, status = 0, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

async function request<T>(
  server: ServerConnection,
  path: string,
  schema: z.ZodType<T> | 'text',
  options: RequestInit = {},
  publicRequest = false,
  acceptNotReady = false,
): Promise<{ data: T | null; retryAfterMs: number }> {
  const timeout = AbortSignal.timeout(12_000)
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout
  try {
    const headers = new Headers(options.headers)
    headers.set('X-WireGuard-Server', server.url)
    headers.set('Accept', schema === 'text' ? 'text/plain' : 'application/json')
    if (!publicRequest) headers.set('X-API-Token', server.token ?? '')
    if (options.body) headers.set('Content-Type', 'application/json')
    const response = await fetch(
      `/api/wireguard?path=${encodeURIComponent(path)}`,
      {
        ...options,
        signal,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        headers,
      },
    )
    if (!response.ok && !(acceptNotReady && response.status === 503)) {
      const body: unknown = await response.json().catch(() => null)
      let message = `The API returned HTTP ${response.status}.`
      let code: string | undefined
      if (body && typeof body === 'object') {
        if ('code' in body && typeof body.code === 'string') code = body.code
        if ('detail' in body && typeof body.detail === 'string')
          message = body.detail
      }
      if (response.status === 401 || response.status === 403)
        message = 'Authentication failed. Check this server’s API token.'
      throw new ApiError(message, response.status, code)
    }
    const retry = response.headers.get('Retry-After')
    const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : 5
    const retryAfterMs = Math.max(1000, seconds * 1000)
    if (response.status === 204) return { data: null, retryAfterMs }
    if (schema === 'text')
      return { data: (await response.text()) as T, retryAfterMs }
    const body: unknown = await response.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success)
      throw new ApiError(
        'The API returned an unexpected response. Check the backend version.',
        response.status,
      )
    return { data: parsed.data, retryAfterMs }
  } catch (error) {
    if (error instanceof ApiError || options.signal?.aborted) throw error
    if (timeout.aborted)
      throw new ApiError(
        'The server took too long to respond. Try refreshing its status.',
      )
    throw new ApiError(
      'Could not reach the board’s proxy. Check your network and the board deployment.',
    )
  }
}

async function read<T>(
  server: ServerConnection,
  path: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
  publicRequest = false,
  acceptNotReady = false,
): Promise<T> {
  const result = await request(
    server,
    path,
    schema,
    { signal },
    publicRequest,
    acceptNotReady,
  )
  if (result.data === null)
    throw new ApiError('The API returned an unexpected empty response.')
  return result.data
}
const peerPath = (id: string) => `/v1/peers/${encodeURIComponent(id)}`

export const api = {
  live: (server: ServerConnection, signal?: AbortSignal) =>
    read(server, '/livez', livenessSchema, signal, true),
  ready: (server: ServerConnection, signal?: AbortSignal) =>
    read(server, '/readyz', readinessSchema, signal, true, true),
  server: (server: ServerConnection, signal?: AbortSignal) =>
    read(server, '/v1/server', serverInfoSchema, signal),
  system: (server: ServerConnection, signal?: AbortSignal) =>
    read(server, '/v1/system', systemInfoSchema, signal),
  stats: (
    server: ServerConnection,
    signal?: AbortSignal,
    handshakeWindowSeconds?: number,
  ) =>
    read(
      server,
      `/v1/stats${handshakeWindowSeconds === undefined ? '' : `?handshake_window_seconds=${encodeURIComponent(handshakeWindowSeconds)}`}`,
      vpnStatsSchema,
      signal,
    ),
  peerPage: (server: ServerConnection, after?: string, signal?: AbortSignal) =>
    read(
      server,
      `/v1/peers?limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`,
      peersSchema,
      signal,
    ),
  async peers(server: ServerConnection, signal?: AbortSignal): Promise<Peer[]> {
    const peers = new Map<string, Peer>()
    const cursors = new Set<string>()
    let after: string | undefined
    do {
      const page = await api.peerPage(server, after, signal)
      page.items.forEach((peer) => peers.set(peer.id, peer))
      after = page.next_cursor ?? undefined
      if (after && cursors.has(after))
        throw new ApiError('The API returned a repeated pagination cursor.')
      if (after) cursors.add(after)
    } while (after)
    return [...peers.values()]
  },
  peer: (server: ServerConnection, id: string, signal?: AbortSignal) =>
    read(server, peerPath(id), peerSchema, signal),
  async createPeer(
    server: ServerConnection,
    input: PeerInput,
    requestKey: string,
  ) {
    const result = await request(server, '/v1/peers', createdPeerSchema, {
      method: 'POST',
      body: JSON.stringify(input),
      headers: { 'Idempotency-Key': requestKey },
    })
    if (!result.data)
      throw new ApiError('The API returned an unexpected empty response.')
    return { ...result.data, retryAfterMs: result.retryAfterMs }
  },
  peerConfig: (server: ServerConnection, id: string, signal?: AbortSignal) =>
    read(
      server,
      `${peerPath(id)}/config-template`,
      configTemplateSchema,
      signal,
    ),
  async deletePeer(server: ServerConnection, id: string) {
    const result = await request(server, peerPath(id), operationSchema, {
      method: 'DELETE',
    })
    return result.data
      ? { operation: result.data, retryAfterMs: result.retryAfterMs }
      : null
  },
  async operation(server: ServerConnection, id: string, signal?: AbortSignal) {
    const result = await request(
      server,
      `/v1/operations/${encodeURIComponent(id)}`,
      operationSchema,
      { signal },
    )
    if (!result.data)
      throw new ApiError('The API returned an unexpected empty response.')
    return { operation: result.data, retryAfterMs: result.retryAfterMs }
  },
  async metrics(server: ServerConnection, signal?: AbortSignal) {
    const result = await request<string>(
      server,
      '/metrics',
      'text',
      { signal },
      true,
    )
    if (result.data === null)
      throw new ApiError('The API returned an unexpected empty response.')
    return result.data
  },
  async testConnection(server: ServerConnection, signal?: AbortSignal) {
    const [live] = await Promise.all([
      api.live(server, signal),
      api.ready(server, signal),
      api.peerPage(server, undefined, signal),
      api.server(server, signal),
    ])
    return live
  },
}

export const serverQueryKey = (server: ServerConnection) =>
  ['server', server.id, server.session] as const
export const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'Something went wrong. Please try again.'
