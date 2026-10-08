// @vitest-environment node
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { IncomingMessage } from 'node:http'
import type { RequestOptions } from 'node:https'
import type { PeerCertificate } from 'node:tls'
import { expect, it, vi } from 'vitest'

const { transport } = vi.hoisted(() => ({ transport: vi.fn() }))
vi.mock('node:https', () => ({ request: transport }))
import { sendUpstream } from './upstream-request.ts'

it.each([
  {
    target: 'https://vpn.example.com:8443/v1/server',
    hostname: 'vpn.example.com',
    sni: 'vpn.example.com',
    valid: 'DNS:vpn.example.com',
  },
  {
    target: 'https://8.8.8.8/v1/server',
    hostname: '8.8.8.8',
    sni: undefined,
    valid: 'IP Address:8.8.8.8',
  },
])(
  'retains HTTPS certificate identity for $hostname while connecting to a pinned IP',
  async ({ target, hostname, sni, valid }) => {
    let options: RequestOptions | undefined
    transport.mockImplementation(
      (
        _url: URL,
        input: RequestOptions,
        callback: (response: IncomingMessage) => void,
      ) => {
        options = input
        const client = Object.assign(new EventEmitter(), {
          end: () => {
            const response = Object.assign(new PassThrough(), {
              statusCode: 200,
              headers: { 'content-type': 'application/json' },
            })
            callback(response as unknown as IncomingMessage)
            response.end('{}')
          },
        })
        return client
      },
    )
    await sendUpstream({
      url: new URL(target),
      address: { address: '8.8.8.8', family: 4 },
      method: 'GET',
      headers: {},
      signal: AbortSignal.timeout(1000),
    })
    expect(options?.hostname).toBe('8.8.8.8')
    expect(options?.servername).toBe(sni)
    expect(options?.headers).toMatchObject({ Host: new URL(target).host })
    expect(options?.rejectUnauthorized).not.toBe(false)
    expect(
      options?.checkServerIdentity?.('8.8.8.8', {
        subjectaltname: valid,
      } as PeerCertificate),
    ).toBeUndefined()
    expect(
      options?.checkServerIdentity?.(hostname, {
        subjectaltname: 'DNS:attacker.example.com',
      } as PeerCertificate),
    ).toBeInstanceOf(Error)
  },
)
