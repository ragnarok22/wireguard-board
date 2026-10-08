// @vitest-environment node
import { expect, it } from 'vitest'
import { securityHeaders } from './security-headers.ts'
import { firewallPolicy } from './firewall-policy.ts'
import deployment from '../vercel.json'
import { handleProxy } from './proxy-handler.ts'

it('keeps preview and production security policies consistent', () => {
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

it('counts all proxy methods together at the edge using the client IP', () => {
  expect(firewallPolicy).toMatchObject({
    condition: { type: 'path', op: 'pre', value: '/api/wireguard' },
    requests: 240,
    windowSeconds: 60,
    keys: ['ip'],
    action: 'rate_limit',
    exceededAction: 'rate_limit',
  })
  expect(firewallPolicy.condition).not.toHaveProperty('method')
})

it('allows alternate hosts to reject requests before DNS or upstream access', async () => {
  let contacted = false
  const response = await handleProxy(
    new Request('https://board.example.com/api/wireguard?path=/livez'),
    {
      rateLimit: async () => new Response(null, { status: 429 }),
      resolve: async () => {
        contacted = true
        return []
      },
    },
  )
  expect(response.status).toBe(429)
  expect(contacted).toBe(false)
})
