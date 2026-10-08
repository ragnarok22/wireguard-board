// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { limitProxyRequest } from './proxy-rate-limit.ts'
import { handleProxy } from './proxy-handler.ts'
import { securityHeaders } from './security-headers.ts'
import vercelHandler from '../api/wireguard.ts'
import deployment from '../vercel.json'

afterEach(() => vi.unstubAllEnvs())

function request(ip = '8.8.8.8') {
  return new Request('https://board.example.com/api/wireguard?path=/livez', {
    headers: {
      'x-real-ip': ip,
      Host: 'attacker.example.com',
      'X-WireGuard-Server': 'https://private-destination.example',
      'X-API-Token': 'secret-token',
      Cookie: 'secret-cookie',
      'Idempotency-Key': 'secret-key',
    },
  })
}

describe('Vercel-backed rate limiting', () => {
  it('enforces the Vercel entrypoint limit even when the VERCEL marker is absent', async () => {
    vi.stubEnv('VERCEL', '')
    vi.stubEnv('NODE_ENV', 'production')
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 429 }))
    vi.stubGlobal('fetch', fetchMock)
    const response = await vercelHandler.fetch(request())
    expect(response.status).toBe(429)
    expect(fetchMock).toHaveBeenCalledOnce()
  })
  it('uses shared platform counters without sending API credentials or trusting a supplied Host', async () => {
    vi.stubEnv('VERCEL', '1')
    vi.stubEnv('NODE_ENV', 'production')
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await limitProxyRequest(request())).toBeNull()
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://board.example.com/.well-known/vercel/rate-limit-api/wireguard-proxy',
    )
    const headers = new Headers(fetchMock.mock.calls[0][1].headers)
    expect(headers.get('x-vercel-rate-limit-key')).toMatch(/^8\.8\.8\.8-/)
    const serialized = JSON.stringify([...headers])
    for (const secret of [
      'secret-token',
      'secret-cookie',
      'secret-key',
      'private-destination',
      'attacker.example.com',
    ])
      expect(serialized).not.toContain(secret)
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })
  it.each([429, 403])(
    'returns a no-store 429 with Retry-After for platform HTTP %s',
    async (status) => {
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response(null, { status })),
      )
      const response = await limitProxyRequest(request(), { enabled: true })
      expect(response?.status).toBe(429)
      expect(response?.headers.get('Retry-After')).toBe('60')
      expect(response?.headers.get('Cache-Control')).toBe('no-store')
      expect((await response!.json()).code).toBe('proxy_rate_limited')
    },
  )
  it('fails closed when the rule is missing or the counter service fails', async () => {
    for (const check of [
      async () => ({ rateLimited: false, error: 'not-found' }),
      async () => ({ rateLimited: false, error: 'unknown' }),
      async () => {
        throw new Error('Secret provider detail')
      },
    ]) {
      const response = await limitProxyRequest(request(), {
        enabled: true,
        check,
      })
      expect(response?.status).toBe(503)
      expect(response?.headers.get('Retry-After')).toBe('5')
      expect(await response!.text()).not.toContain('Secret provider detail')
    }
  })
  it('skips platform checks locally and rejects missing trusted platform context', async () => {
    const check = vi.fn()
    expect(
      await limitProxyRequest(request(), { enabled: false, check }),
    ).toBeNull()
    expect(check).not.toHaveBeenCalled()
    expect(
      (await limitProxyRequest(request(''), { enabled: true, check }))?.status,
    ).toBe(503)
    vi.stubEnv('NODE_ENV', 'development')
    expect(
      (await limitProxyRequest(request(), { enabled: true }))?.status,
    ).toBe(503)
  })
  it('stops rejected requests before DNS resolution or upstream calls', async () => {
    const resolve = vi.fn()
    const send = vi.fn()
    const response = await handleProxy(request(), {
      resolve,
      send,
      rateLimit: (input) =>
        limitProxyRequest(input, {
          enabled: true,
          check: async () => ({ rateLimited: true }),
        }),
    })
    expect(response.status).toBe(429)
    expect(resolve).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })
})

it('keeps local preview headers and the Vercel production policies consistent', () => {
  const headers = Object.fromEntries(
    deployment.headers[0].headers.map((header) => [header.key, header.value]),
  )
  expect(headers).toMatchObject(securityHeaders)
  expect(headers['Strict-Transport-Security']).toBe('max-age=31536000')
  expect(headers['Content-Security-Policy']).toContain("connect-src 'self'")
  expect(headers['Content-Security-Policy']).toContain("script-src 'self';")
  expect(headers['Content-Security-Policy']).not.toContain(
    "script-src 'self' 'unsafe-inline'",
  )
})
