// @vitest-environment node
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
  type Server,
} from 'node:http'
import { once } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import { serveProxy, wireguardProxy } from './vite-proxy.ts'
import { handleProxy } from './proxy-handler.ts'
import vercelHandler from '../api/wireguard.ts'

let server: Server | undefined
afterEach(async () => {
  vi.unstubAllEnvs()
  if (server) {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server!.close(() => resolve()))
    server = undefined
  }
})

it('serves the same Web handler through a real local HTTP request', async () => {
  server = createServer((request, response) => {
    void serveProxy(request, response, (input) =>
      handleProxy(input, {
        send: async (upstream) => ({
          status: 202,
          headers: new Headers({ 'Retry-After': '7' }),
          body: Buffer.from(
            JSON.stringify({
              body: Buffer.from(upstream.body!).toString(),
              key: upstream.headers['Idempotency-Key'],
            }),
          ),
        }),
      }),
    )
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('Missing test port')
  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/wireguard?path=/v1/peers`,
    {
      method: 'POST',
      headers: {
        'X-WireGuard-Server': 'http://8.8.8.8:8008',
        'X-API-Token': 'test-token',
        'Idempotency-Key': 'same-key',
        'Content-Type': 'application/json',
      },
      body: '{"key_mode":"generated"}',
    },
  )
  expect(response.status).toBe(202)
  expect(response.headers.get('Retry-After')).toBe('7')
  expect(await response.json()).toEqual({
    body: '{"key_mode":"generated"}',
    key: 'same-key',
  })
})

it('forwards a real HTTP DELETE without a payload through the local adapter', async () => {
  let deleted = false
  server = createServer((request, response) => {
    void serveProxy(request, response, (input) =>
      handleProxy(input, {
        send: async (upstream) => {
          expect(upstream.method).toBe('DELETE')
          expect(upstream.body).toBeUndefined()
          deleted = true
          return { status: 204, headers: new Headers(), body: new Uint8Array() }
        },
      }),
    )
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('Missing test port')
  const path = '/v1/peers/79a94a53-c94a-46c7-ab91-bc52196c1355'
  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/wireguard?path=${encodeURIComponent(path)}`,
    {
      method: 'DELETE',
      headers: {
        'X-WireGuard-Server': 'http://8.8.8.8:8008',
        'X-API-Token': 'test-token',
      },
    },
  )
  expect(response.status).toBe(204)
  expect(deleted).toBe(true)
})

it('exposes the Vercel handler and local development/preview adapters', async () => {
  expect(wireguardProxy().configureServer).toBeTypeOf('function')
  expect(wireguardProxy().configurePreviewServer).toBeTypeOf('function')
  const response = await vercelHandler.fetch(
    new Request('https://board.example.com/api/wireguard?path=/livez', {
      headers: {
        'X-WireGuard-Server': 'http://127.0.0.1',
        'x-real-ip': '8.8.8.8',
      },
    }),
  )
  expect(response.status).toBe(400)
  expect((await response.json()).code).toBe('proxy_private_target')
})

it('routes local release checks through the shared handler and passes other paths on', async () => {
  const browserFetch = fetch
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
  )
  let middleware: (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => void
  const plugin = wireguardProxy()
  const configure = plugin.configureServer as (server: unknown) => void
  configure({
    middlewares: {
      use: (handler: typeof middleware) => {
        middleware = handler
      },
    },
  })
  expect(plugin.configurePreviewServer).toBe(plugin.configureServer)
  server = createServer((request, response) => {
    middleware(request, response, () => {
      response.writeHead(404)
      response.end()
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('Missing test port')
  const origin = `http://127.0.0.1:${address.port}`
  const response = await browserFetch(`${origin}/api/releases`)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    api: { status: 'none' },
    board: { status: 'none' },
  })
  expect((await browserFetch(`${origin}/other`)).status).toBe(404)
})
