// @vitest-environment node
import { createServer, type Server } from 'node:http'
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
