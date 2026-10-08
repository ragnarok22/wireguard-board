// @vitest-environment node
import { createServer, type Server, type RequestListener } from 'node:http'
import { once } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import { sendUpstream, maxResponseBytes } from './upstream-request.ts'

let server: Server | undefined
afterEach(async () => {
  if (server) {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server!.close(() => resolve()))
    server = undefined
  }
})

async function start(handler: RequestListener) {
  // The transport is tested on loopback directly; the proxy separately rejects it.
  server = createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test port')
  return new URL(`http://vpn.example.com:${address.port}/api/v1/peers`)
}
const signal = () => AbortSignal.timeout(1000)

describe('pinned native HTTP transport', () => {
  it('connects to the supplied address while keeping Host, path, body and status', async () => {
    let host = ''
    let path = ''
    let body = ''
    const url = await start((request, response) => {
      host = request.headers.host!
      path = request.url!
      request.on('data', (chunk) => {
        body += chunk.toString()
      })
      request.on('end', () => {
        response.writeHead(202, {
          'Content-Type': 'application/json',
          'Retry-After': '7',
          Location: '/v1/operations/test',
          'Set-Cookie': 'should-not-pass',
        })
        response.end('{"status":"pending"}')
      })
    })
    const result = await sendUpstream({
      url,
      address: { address: '127.0.0.1', family: 4 },
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.from('{"key_mode":"generated"}'),
      signal: signal(),
    })
    expect(host).toBe(url.host)
    expect(path).toBe('/api/v1/peers')
    expect(body).toBe('{"key_mode":"generated"}')
    expect(result.status).toBe(202)
    expect(result.headers.get('Retry-After')).toBe('7')
    expect(result.headers.has('Set-Cookie')).toBe(false)
    expect(Buffer.from(result.body).toString()).toBe('{"status":"pending"}')
  })
  it('rejects redirects without requesting their destination', async () => {
    let count = 0
    const url = await start((_request, response) => {
      count++
      response.writeHead(302, { Location: 'http://169.254.169.254/latest' })
      response.end()
    })
    await expect(
      sendUpstream({
        url,
        address: { address: '127.0.0.1', family: 4 },
        method: 'GET',
        headers: {},
        signal: signal(),
      }),
    ).rejects.toMatchObject({ code: 'proxy_redirect_rejected' })
    expect(count).toBe(1)
  })
  it('stops oversized and interrupted responses', async () => {
    const url = await start((_request, response) => {
      response.writeHead(200)
      response.end(Buffer.alloc(maxResponseBytes + 1))
    })
    await expect(
      sendUpstream({
        url,
        address: { address: '127.0.0.1', family: 4 },
        method: 'GET',
        headers: {},
        signal: signal(),
      }),
    ).rejects.toMatchObject({ code: 'proxy_response_too_large' })
  })
  it('cancels a stalled upstream connection', async () => {
    const url = await start(() => {})
    await expect(
      sendUpstream({
        url,
        address: { address: '127.0.0.1', family: 4 },
        method: 'GET',
        headers: {},
        signal: AbortSignal.timeout(10),
      }),
    ).rejects.toThrow()
  })
})
