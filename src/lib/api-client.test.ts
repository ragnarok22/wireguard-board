import { describe, expect, it, vi } from 'vitest'
import { api, ApiError, serverQueryKey } from './api-client'
import {
  createdPeer,
  health,
  jsonResponse,
  live,
  operation,
  peer,
  server,
  serverInfo,
  configTemplate,
} from '@/test/api-fixtures'

describe('versioned API contract', () => {
  it('authenticates requests, retains URL prefixes and follows every page', async () => {
    const second = {
      ...peer,
      id: '89a94a53-c94a-46c7-ab91-bc52196c1355',
      address: '10.13.13.3',
    }
    const mock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ items: [peer], next_cursor: peer.id }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ items: [second], next_cursor: null }),
      )
    vi.stubGlobal('fetch', mock)
    await expect(
      api.peers({ ...server, url: `${server.url}/api` }),
    ).resolves.toEqual([peer, second])
    expect(mock.mock.calls.map(([url]) => url)).toEqual([
      `${server.url}/api/v1/peers?limit=100`,
      `${server.url}/api/v1/peers?limit=100&after=${peer.id}`,
    ])
    expect(mock.mock.calls[0][1]).toMatchObject({
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
    })
    expect(mock.mock.calls[0][1].headers.get('X-API-Token')).toBe(server.token)
  })

  it('rejects looping cursors and does not publish a partially fetched inventory', async () => {
    const mock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(jsonResponse({ items: [peer], next_cursor: peer.id })),
      )
    vi.stubGlobal('fetch', mock)
    await expect(api.peers(server)).rejects.toThrow(
      'repeated pagination cursor',
    )
    expect(mock).toHaveBeenCalledTimes(2)
    mock
      .mockReset()
      .mockResolvedValueOnce(
        jsonResponse({ items: [peer], next_cursor: peer.id }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { code: 'unavailable', detail: 'Snapshot unavailable' },
          503,
        ),
      )
    await expect(api.peers(server)).rejects.toThrow('Snapshot unavailable')
  })

  it('accepts public readiness 503 and reads liveness without a token', async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { ...health, status: 'not_ready', reason: 'state_not_converged' },
          503,
        ),
      )
      .mockResolvedValueOnce(jsonResponse(live))
    vi.stubGlobal('fetch', mock)
    expect((await api.ready(server)).status).toBe('not_ready')
    await expect(api.live(server)).resolves.toEqual(live)
    mock.mock.calls.forEach(([, options]) =>
      expect(options.headers.has('X-API-Token')).toBe(false),
    )
  })

  it('reads server capacity and nullable peer observations with UUID URLs', async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(serverInfo))
      .mockResolvedValueOnce(
        jsonResponse({
          ...peer,
          observation: null,
          state: 'pending',
          applied: false,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ config: configTemplate }))
    vi.stubGlobal('fetch', mock)
    await expect(api.server(server)).resolves.toEqual(serverInfo)
    expect((await api.peer(server, peer.id)).observation).toBeNull()
    await expect(api.peerConfig(server, peer.id)).resolves.toEqual({
      config: configTemplate,
    })
    expect(mock.mock.calls.map(([url]) => url)).toEqual([
      `${server.url}/v1/server`,
      `${server.url}/v1/peers/${peer.id}`,
      `${server.url}/v1/peers/${peer.id}/config-template`,
    ])
  })

  it.each([200, 201, 202])(
    'reads creation HTTP %s and merges idempotency and authentication headers',
    async (status) => {
      const body =
        status === 200
          ? {
              ...createdPeer,
              private_key: null,
              client_config: null,
              replayed: true,
            }
          : status === 202
            ? { ...createdPeer, operation: { ...operation, status: 'pending' } }
            : createdPeer
      const mock = vi
        .fn()
        .mockResolvedValue(jsonResponse(body, status, { 'Retry-After': '7' }))
      vi.stubGlobal('fetch', mock)
      await expect(
        api.createPeer(
          server,
          { key_mode: 'generated', address: '10.13.13.2' },
          'client-retry',
        ),
      ).resolves.toMatchObject({ ...body, retryAfterMs: 7000 })
      const options = mock.mock.calls[0][1]
      expect(options.headers.get('Idempotency-Key')).toBe('client-retry')
      expect(options.headers.get('X-API-Token')).toBe(server.token)
      expect(options.headers.get('Content-Type')).toBe('application/json')
      expect(JSON.parse(options.body)).toEqual({
        key_mode: 'generated',
        address: '10.13.13.2',
      })
      expect(mock.mock.calls[0][0]).toBe(`${server.url}/v1/peers`)
    },
  )

  it('handles completed and accepted DELETE, and operation polling', async () => {
    const pending = { ...operation, kind: 'delete', status: 'pending' }
    const mock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse(pending, 202, { 'Retry-After': '5' }))
      .mockResolvedValueOnce(jsonResponse({ ...pending, status: 'complete' }))
    vi.stubGlobal('fetch', mock)
    await expect(api.deletePeer(server, peer.id)).resolves.toBeNull()
    await expect(api.deletePeer(server, peer.id)).resolves.toEqual({
      operation: pending,
      retryAfterMs: 5000,
    })
    await expect(api.operation(server, operation.id)).resolves.toMatchObject({
      operation: { status: 'complete' },
      retryAfterMs: 5000,
    })
    expect(mock.mock.calls[2][0]).toBe(
      `${server.url}/v1/operations/${operation.id}`,
    )
  })

  it('reads public Prometheus text without treating NaN as a healthy zero', async () => {
    const text =
      'wireguard_available 0\nwireguard_peers_total NaN\nwireguard_pending_operations -1\n'
    const mock = vi.fn().mockResolvedValue(new Response(text))
    vi.stubGlobal('fetch', mock)
    await expect(api.metrics(server)).resolves.toBe(text)
    expect(mock.mock.calls[0][1].headers.has('X-API-Token')).toBe(false)
    expect(mock.mock.calls[0][1].headers.get('Accept')).toBe('text/plain')
  })

  it('rejects malformed peer responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ items: [{ public_key: 'key' }], next_cursor: null }),
        ),
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
            jsonResponse(
              { code: 'http_error', detail: 'Invalid token' },
              status,
            ),
          ),
      )
      await expect(api.peers(server)).rejects.toMatchObject({
        status,
        code: 'http_error',
        message: expect.stringContaining('Authentication failed'),
      })
    },
  )
  it('preserves stable backend codes and safe details', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { code: 'conflict', detail: 'Client address is already reserved' },
            409,
          ),
        ),
    )
    await expect(
      api.createPeer(server, { key_mode: 'generated' }, 'request'),
    ).rejects.toMatchObject({
      status: 409,
      code: 'conflict',
      message: 'Client address is already reserved',
    })
  })
  it('handles routing errors without JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Bad gateway', { status: 502 })),
    )
    await expect(api.peers(server)).rejects.toThrow('HTTP 502')
  })
  it('reports network failures and preserves request cancellation', async () => {
    const error = new DOMException('Cancelled', 'AbortError')
    const mock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(error)
    vi.stubGlobal('fetch', mock)
    await expect(api.peers(server)).rejects.toThrow('CORS settings')
    const controller = new AbortController()
    controller.abort()
    await expect(api.peers(server, controller.signal)).rejects.toBe(error)
  })
  it('times out stalled requests', async () => {
    const timeout = AbortSignal.abort(
      new DOMException('Timed out', 'TimeoutError'),
    )
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeout.reason))
    await expect(api.peers(server)).rejects.toThrow('took too long')
  })
  it('tests public probes and authenticated access, including a degraded readyz', async () => {
    const mock = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        url.endsWith('/livez')
          ? jsonResponse(live)
          : url.endsWith('/readyz')
            ? jsonResponse(
                {
                  ...health,
                  status: 'not_ready',
                  reason: 'state_not_converged',
                },
                503,
              )
            : url.endsWith('/v1/server')
              ? jsonResponse(serverInfo)
              : jsonResponse({ items: [], next_cursor: null }),
      ),
    )
    vi.stubGlobal('fetch', mock)
    await expect(api.testConnection(server)).resolves.toEqual(live)
    expect(mock).toHaveBeenCalledTimes(4)
    mock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ detail: 'Invalid token' }, 403)),
    )
    await expect(api.testConnection(server)).rejects.toBeInstanceOf(ApiError)
  })
  it('isolates caches across servers and credential sessions without tokens', () => {
    expect(serverQueryKey(server)).not.toEqual(
      serverQueryKey({ ...server, id: 'berlin' }),
    )
    expect(serverQueryKey(server)).not.toEqual(
      serverQueryKey({ ...server, session: 'session-two' }),
    )
    expect(serverQueryKey(server)).not.toContain(server.token)
  })
})
