// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { handleProxy, maxRequestBytes } from './proxy-handler.ts'
import {
  isPublicAddress,
  parseTarget,
  resolvePublicTarget,
} from './public-target.ts'
import { validateRoute } from './proxy-route.ts'
import type {
  UpstreamInput,
  UpstreamResponse,
  SendUpstream,
} from './upstream-request.ts'
import { api } from '../src/lib/api-client.ts'
import { createdPeer, peer, server } from '../src/test/api-fixtures.ts'

const publicIp = { address: '8.8.8.8', family: 4 }
const resolve = vi.fn(async () => [publicIp])
function upstream(
  data: unknown = { status: 'alive', version: '1.0.0' },
  status = 200,
  headers = {},
): UpstreamResponse {
  return {
    status,
    headers: new Headers({ 'Content-Type': 'application/json', ...headers }),
    body: Buffer.from(JSON.stringify(data)),
  }
}
function request(
  path = '/v1/server',
  options: RequestInit = {},
  target = 'http://vpn.example.com:8008/api',
): Request {
  const headers = new Headers({
    'X-WireGuard-Server': target,
    'X-API-Token': 'test-token',
  })
  new Headers(options.headers).forEach((value, name) =>
    headers.set(name, value),
  )
  return new Request(
    `https://board.example.com/api/wireguard?path=${encodeURIComponent(path)}`,
    {
      ...options,
      headers,
    },
  )
}

describe('public destination validation', () => {
  it.each([
    '0.0.0.0',
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '198.18.0.1',
    '203.0.113.1',
    '224.0.0.1',
    '240.0.0.1',
    '::',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:8.8.8.8',
    '2001:db8::1',
    '2002:0808:0808::1',
    '64:ff9b::808:808',
    'invalid',
  ])('rejects non-public address %s', (address) => {
    expect(isPublicAddress(address)).toBe(false)
  })
  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])(
    'accepts public address %s',
    (address) => {
      expect(isPublicAddress(address)).toBe(true)
    },
  )
  it.each([
    'http://127.1',
    'http://2130706433',
    'http://0x7f000001',
    'http://[::ffff:127.0.0.1]',
    'http://[::1]',
  ])('rejects alternate private URL %s', async (value) => {
    await expect(resolvePublicTarget(parseTarget(value))).rejects.toMatchObject(
      { code: 'proxy_private_target' },
    )
  })
  it.each([
    '',
    'not-a-url',
    'ftp://8.8.8.8',
    'http://user:pass@8.8.8.8',
    'http://8.8.8.8?token=secret',
    'http://8.8.8.8#fragment',
    'http://8.8.8.8/a%2fb',
    'http://8.8.8.8\\private',
  ])('rejects malformed target %s', (value) => {
    expect(() => parseTarget(value)).toThrow()
  })
  it('rejects mixed public/private DNS answers and empty or invalid answers', async () => {
    for (const addresses of [
      [publicIp, { address: '127.0.0.1', family: 4 }],
      [],
      [{ address: '8.8.8.8', family: 6 }],
    ]) {
      await expect(
        resolvePublicTarget(
          parseTarget('https://vpn.example.com'),
          async () => addresses,
        ),
      ).rejects.toMatchObject({ code: 'proxy_private_target' })
    }
  })
  it('does not resolve a literal public IP and supports IPv6 and prefixes', async () => {
    const resolver = vi.fn()
    expect(
      await resolvePublicTarget(
        parseTarget('https://[2606:4700:4700::1111]/api/'),
        resolver,
      ),
    ).toEqual({ address: '2606:4700:4700::1111', family: 6 })
    expect(resolver).not.toHaveBeenCalled()
    expect(parseTarget('http://8.8.8.8:8008/api///').pathname).toBe('/api')
  })
})

describe('bounded API routing', () => {
  it.each([
    '/livez',
    '/readyz',
    '/metrics',
    '/v1/server',
    '/v1/system',
    '/v1/stats',
    '/v1/stats?handshake_window_seconds=60',
    `/v1/peers?limit=100&after=${peer.id}`,
    `/v1/peers/${peer.id}`,
    `/v1/peers/${peer.id}/config-template`,
    `/v1/operations/${peer.id}`,
  ])('accepts GET %s', (path) => {
    expect(validateRoute(path, 'GET').path).toBe(path)
  })
  it.each([
    '/docs',
    '/admin',
    '//evil.example/v1/server',
    '/v1/../server',
    '/v1/%70eers',
    '/v1/peers/not-a-uuid',
    '/v1/server?redirect=elsewhere',
    '/v1/peers?limit=101',
    '/v1/peers?limit=0',
    '/v1/peers?limit=1&limit=2',
    '/v1/peers?after=invalid',
    '/v1/stats?handshake_window_seconds=3601',
    '/livez#fragment',
    '/livez??extra',
    '',
  ])('rejects route %s', (path) => {
    expect(() => validateRoute(path, 'GET')).toThrow()
  })
  it('limits mutation routes and rejects unsupported methods', () => {
    expect(validateRoute('/v1/peers', 'POST').authenticated).toBe(true)
    expect(validateRoute(`/v1/peers/${peer.id}`, 'DELETE').authenticated).toBe(
      true,
    )
    expect(() => validateRoute('/livez', 'POST')).toThrow()
    expect(() => validateRoute('/v1/peers?limit=10', 'POST')).toThrow()
    expect(() => validateRoute('/v1/server', 'DELETE')).toThrow()
    expect(() => validateRoute('/v1/server', 'CONNECT')).toThrow()
  })
})

describe('proxy request contract', () => {
  it('pins DNS once, retains prefixes and forwards only selected headers', async () => {
    const resolver = vi.fn(async () => [publicIp])
    const send = vi.fn<SendUpstream>(async () => upstream())
    const response = await handleProxy(
      request('/v1/peers?limit=100', {
        headers: {
          Cookie: 'private-cookie',
          Authorization: 'secret',
          'X-Forwarded-For': '127.0.0.1',
        },
      }),
      { resolve: resolver, send },
    )
    expect(response.status).toBe(200)
    expect(resolver).toHaveBeenCalledOnce()
    const input = send.mock.calls[0][0] as UpstreamInput
    expect(input.url.href).toBe(
      'http://vpn.example.com:8008/api/v1/peers?limit=100',
    )
    expect(input.address).toEqual(publicIp)
    expect(input.headers).toEqual({
      Accept: 'application/json',
      'Accept-Encoding': 'identity',
      'X-API-Token': 'test-token',
    })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false)
  })
  it.each([200, 201, 202, 204, 403, 409, 422, 503])(
    'preserves upstream HTTP %s and retry headers',
    async (status) => {
      const response = await handleProxy(request(), {
        resolve,
        send: async () =>
          upstream(
            { code: 'backend_code', detail: 'Safe backend detail' },
            status,
            { 'Retry-After': '7', Location: `/v1/operations/${peer.id}` },
          ),
      })
      expect(response.status).toBe(status)
      expect(response.headers.get('Retry-After')).toBe('7')
      expect(response.headers.get('Location')).toContain(peer.id)
      if (status === 204) expect(await response.text()).toBe('')
      else expect(await response.json()).toMatchObject({ code: 'backend_code' })
    },
  )
  it('forwards a creation body byte-for-byte and preserves its idempotency key', async () => {
    const send = vi.fn<SendUpstream>(async () => upstream(createdPeer, 202))
    const body = '{ "key_mode": "generated" }'
    await handleProxy(
      request('/v1/peers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'request-one',
        },
        body,
      }),
      { resolve, send },
    )
    const input = send.mock.calls[0][0] as UpstreamInput
    expect(Buffer.from(input.body!).toString()).toBe(body)
    expect(input.headers['Idempotency-Key']).toBe('request-one')
    expect(send).toHaveBeenCalledOnce()
  })
  it('returns public metrics as text without forwarding credentials or cookies', async () => {
    const send = vi.fn<SendUpstream>(async () => ({
      status: 200,
      headers: new Headers({
        'Content-Type': 'text/html',
        'Set-Cookie': 'session=bad',
      }),
      body: Buffer.from('<script>not executable</script>\nmetric 1\n'),
    }))
    const response = await handleProxy(request('/metrics'), { resolve, send })
    expect(response.headers.get('Content-Type')).toBe(
      'text/plain; charset=utf-8',
    )
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.has('Set-Cookie')).toBe(false)
    expect((send.mock.calls[0][0] as UpstreamInput).headers).not.toHaveProperty(
      'X-API-Token',
    )
    expect(await response.text()).toContain('metric 1')
  })
  it.each<RequestInit & { path: string; target?: string; status: number }>([
    { path: '/v1/server', target: 'http://127.0.0.1', status: 400 },
    { path: '/v1/server', method: 'PUT', status: 405 },
    { path: '/v1/server', headers: { 'X-API-Token': '' }, status: 401 },
    { path: '/v1/peers', method: 'POST', status: 400 },
    {
      path: '/v1/peers',
      method: 'POST',
      headers: { 'Idempotency-Key': 'key' },
      body: '{}',
      status: 415,
    },
    {
      path: '/v1/peers',
      method: 'POST',
      headers: { 'Idempotency-Key': 'key', 'Content-Type': 'application/json' },
      body: 'not json',
      status: 400,
    },
    {
      path: '/v1/peers',
      method: 'POST',
      headers: { 'Idempotency-Key': 'key', 'Content-Type': 'application/json' },
      body: '[]',
      status: 400,
    },
    {
      path: '/v1/peers',
      method: 'POST',
      headers: { 'Idempotency-Key': 'key', 'Content-Type': 'application/json' },
      body: '',
      status: 400,
    },
    {
      path: '/v1/peers',
      method: 'POST',
      headers: { 'Idempotency-Key': 'key', 'Content-Type': 'application/json' },
      body: 'x'.repeat(maxRequestBytes + 1),
      status: 413,
    },
  ])(
    'rejects invalid requests before connecting: $status $path',
    async ({ path, target, status, ...options }) => {
      const send = vi.fn()
      const response = await handleProxy(request(path, options, target), {
        resolve,
        send,
      })
      expect(response.status).toBe(status)
      expect(send).not.toHaveBeenCalled()
      expect(response.headers.get('Cache-Control')).toBe('no-store')
    },
  )
  it('rejects duplicate routing parameters, redirects and safely handles DNS failures', async () => {
    const invalid = await handleProxy(
      new Request(
        'https://board.example.com/api/wireguard?path=/livez&path=/metrics',
      ),
    )
    expect(invalid.status).toBe(400)
    const redirect = await handleProxy(request(), {
      resolve,
      send: async () => upstream({}, 302, { Location: 'http://127.0.0.1' }),
    })
    expect((await redirect.json()).code).toBe('proxy_redirect_rejected')
    const failure = await handleProxy(request(), {
      resolve: async () => {
        throw new Error('Secret internal network detail')
      },
    })
    expect(failure.status).toBe(502)
    expect(await failure.text()).not.toContain('Secret internal')
  })
  it('bounds stalled DNS, transport and upload reads and handles cancellation', async () => {
    const stream = new ReadableStream<Uint8Array>({ start() {} })
    const uploadRequest = new Request(
      'https://board.example.com/api/wireguard?path=/v1/peers',
      {
        method: 'POST',
        headers: {
          'X-WireGuard-Server': 'http://8.8.8.8',
          'X-API-Token': 'token',
          'Idempotency-Key': 'key',
          'Content-Type': 'application/json',
        },
        body: stream,
        duplex: 'half',
      } as RequestInit,
    )
    const upload = await handleProxy(uploadRequest, { timeoutMs: 5 })
    expect(upload.status).toBe(504)
    const dns = await handleProxy(request(), {
      resolve: () => new Promise(() => {}),
      timeoutMs: 5,
    })
    expect(dns.status).toBe(504)
    const transport = await handleProxy(request(), {
      resolve,
      send: () => new Promise(() => {}),
      timeoutMs: 5,
    })
    expect(transport.status).toBe(504)
    const controller = new AbortController()
    controller.abort()
    const cancelled = await handleProxy(
      request('/livez', { signal: controller.signal }),
      { resolve },
    )
    expect(cancelled.status).toBe(499)
  })
  it('connects the browser API client to the proxy with pending responses and exact idempotency', async () => {
    const send = vi.fn<SendUpstream>(async () =>
      upstream(createdPeer, 202, { 'Retry-After': '7' }),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string, options: RequestInit) =>
        handleProxy(new Request(`https://board.example.com${input}`, options), {
          resolve,
          send,
        }),
      ),
    )
    const result = await api.createPeer(
      server,
      { key_mode: 'generated' },
      'same-request-key',
    )
    expect(result.retryAfterMs).toBe(7000)
    expect(result.private_key).toBe(createdPeer.private_key)
    expect(send).toHaveBeenCalledOnce()
    expect(
      (send.mock.calls[0][0] as UpstreamInput).headers['Idempotency-Key'],
    ).toBe('same-request-key')
  })
})
