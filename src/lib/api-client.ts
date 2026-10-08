import type { z } from 'zod'
import {
  createdPeerSchema,
  healthSchema,
  partialConfigSchema,
  peerSchema,
  peersSchema,
  type PeerInput,
  type ServerConnection,
} from './api-types'

export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status = 0) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(
  server: ServerConnection,
  path: string,
  schema: z.ZodType<T> | null,
  options: RequestInit = {},
  publicRequest = false,
  acceptUnhealthy = false,
): Promise<T> {
  const timeout = AbortSignal.timeout(12_000)
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout
  try {
    const response = await fetch(`${server.url}${path}`, {
      ...options,
      signal,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(!publicRequest ? { 'X-API-Token': server.token ?? '' } : {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
    })
    if (!response.ok && !(acceptUnhealthy && response.status === 503)) {
      const body: unknown = await response.json().catch(() => null)
      let message = `The API returned HTTP ${response.status}.`
      if (response.status === 401 || response.status === 403)
        message = 'Authentication failed. Check this server’s API token.'
      else if (body && typeof body === 'object' && 'detail' in body) {
        if (typeof body.detail === 'string') message = body.detail
        else if (Array.isArray(body.detail))
          message =
            'The API rejected these values. Check the key and allowed IP addresses.'
      }
      throw new ApiError(message, response.status)
    }
    if (!schema) return undefined as T
    const body: unknown = await response.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success)
      throw new ApiError(
        'The API returned an unexpected response. Check the backend version.',
        response.status,
      )
    return parsed.data
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (options.signal?.aborted) throw error
    if (timeout.aborted)
      throw new ApiError(
        'The server took too long to respond. Try refreshing its status.',
      )
    throw new ApiError(
      'Could not reach the API. Check its URL, your network and the server’s CORS settings.',
    )
  }
}

const peerPath = (key: string) => `/peers/${encodeURIComponent(key)}`

export const api = {
  health: (server: ServerConnection, signal?: AbortSignal) =>
    request(server, '/health', healthSchema, { signal }, true, true),
  peers: (server: ServerConnection, signal?: AbortSignal) =>
    request(server, '/peers', peersSchema, { signal }),
  peer: (server: ServerConnection, key: string, signal?: AbortSignal) =>
    request(server, peerPath(key), peerSchema, { signal }),
  createPeer: (server: ServerConnection, input: PeerInput) =>
    request(server, '/peers', createdPeerSchema, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  peerConfig: (server: ServerConnection, key: string, signal?: AbortSignal) =>
    request(server, `${peerPath(key)}/config`, partialConfigSchema, { signal }),
  deletePeer: (server: ServerConnection, key: string) =>
    request(server, peerPath(key), null, { method: 'DELETE' }),
  async testConnection(server: ServerConnection, signal?: AbortSignal) {
    const [health] = await Promise.all([
      api.health(server, signal),
      api.peers(server, signal),
    ])
    return health
  },
}

export const serverQueryKey = (server: ServerConnection) =>
  ['server', server.id, server.session] as const
export const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'Something went wrong. Please try again.'
