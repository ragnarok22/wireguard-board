import { describe, expect, it, vi } from 'vitest'
import { api, ApiError, serverQueryKey } from './api-client'
import { health, jsonResponse, peer, server } from '@/test/api-fixtures'

describe('API contract', () => {
  it('authenticates peer requests, supports prefixed URLs and omits credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([peer]))
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      api.peers({ ...server, url: `${server.url}/api` }),
    ).resolves.toEqual([peer])
    expect(fetchMock).toHaveBeenCalledWith(
      `${server.url}/api/peers`,
      expect.objectContaining({
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        headers: { Accept: 'application/json', 'X-API-Token': server.token },
      }),
    )
  })

  it('reads healthy and degraded public health without sending the token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { ...health, status: 'unhealthy', wireguard_available: false },
          503,
        ),
      )
    vi.stubGlobal('fetch', fetchMock)
    expect((await api.health(server)).status).toBe('unhealthy')
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('X-API-Token')
  })

  it('normalizes numeric strings and WireGuard sentinel values', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse([
          {
            ...peer,
            endpoint: '(none)',
            latest_handshake: '0',
            transfer_rx: '12',
            transfer_tx: '32',
            persistent_keepalive: 'off',
          },
        ]),
      ),
    )
    expect((await api.peers(server))[0]).toMatchObject({
      endpoint: null,
      latest_handshake: null,
      transfer_rx: 12,
      transfer_tx: 32,
      persistent_keepalive: 0,
    })
  })

  it('rejects malformed peer responses instead of displaying invented values', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse([{ public_key: 'key' }])),
    )
    await expect(api.peers(server)).rejects.toThrow('unexpected response')
  })

  it.each([401, 403])(
    'reports HTTP %s as an authentication failure',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            jsonResponse({ detail: 'Invalid authentication token' }, status),
          ),
      )
      await expect(api.peers(server)).rejects.toMatchObject({
        status,
        message: expect.stringContaining('Authentication failed'),
      })
    },
  )

  it('preserves FastAPI error details and maps validation errors', async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ detail: 'Peer not found' }, 404))
      .mockResolvedValueOnce(
        jsonResponse({ detail: [{ msg: 'Invalid address' }] }, 422),
      )
    vi.stubGlobal('fetch', mock)
    await expect(api.peer(server, 'key')).rejects.toThrow('Peer not found')
    await expect(api.createPeer(server, {})).rejects.toThrow(
      'rejected these values',
    )
  })

  it('handles successful bodyless DELETE and URL-encodes the public key', async () => {
    const mock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', mock)
    await expect(api.deletePeer(server, 'key/+==')).resolves.toBeUndefined()
    expect(mock).toHaveBeenCalledWith(
      `${server.url}/peers/key%2F%2B%3D%3D`,
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('reports network errors with actionable connection guidance', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    )
    await expect(api.peers(server)).rejects.toThrow('CORS settings')
  })

  it('propagates cancellation without turning it into a network failure', async () => {
    const controller = new AbortController()
    controller.abort()
    const error = new DOMException('Cancelled', 'AbortError')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error))
    await expect(api.peers(server, controller.signal)).rejects.toBe(error)
  })

  it('times out a stalled request', async () => {
    const timeout = AbortSignal.abort(
      new DOMException('Timed out', 'TimeoutError'),
    )
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeout.reason))
    await expect(api.peers(server)).rejects.toThrow('took too long')
  })

  it('tests both public health and authenticated peer access', async () => {
    const mock = vi
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(
          url.endsWith('/health')
            ? jsonResponse(health)
            : jsonResponse([], 403),
        ),
      )
    vi.stubGlobal('fetch', mock)
    await expect(api.testConnection(server)).rejects.toBeInstanceOf(ApiError)
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it('isolates caches across servers and credential sessions without exposing tokens', () => {
    expect(serverQueryKey(server)).not.toEqual(
      serverQueryKey({ ...server, id: 'berlin' }),
    )
    expect(serverQueryKey(server)).not.toEqual(
      serverQueryKey({ ...server, session: 'session-two' }),
    )
    expect(serverQueryKey(server)).not.toContain(server.token)
  })
})
