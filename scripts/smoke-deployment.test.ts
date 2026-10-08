// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  runDeploymentSmoke,
  smokeConfig,
  type SmokeConfig,
} from './smoke-deployment.ts'
import { securityHeaders } from '../server/security-headers.ts'
import {
  createdPeer,
  health,
  live,
  operation,
  peer,
  serverInfo,
} from '../src/test/api-fixtures.ts'

const config: SmokeConfig = {
  boardUrl: 'https://board.example.com',
  apiUrl: 'http://8.8.8.8:8008',
  apiToken: 'never-log-this-api-token',
  bypassSecret: 'never-log-this-bypass',
}
const json = (body: unknown, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  })

function fixture(
  options: {
    fail?:
      | 'configuration'
      | 'replay'
      | 'inspection'
      | 'cleanup'
      | 'headers'
      | 'metrics'
      | 'contract'
      | 'network'
    preexisting?: boolean
    pending?: boolean
  } = {},
) {
  let created = false
  let deleted = false
  let postCount = 0
  const deleteOperation = {
    ...operation,
    id: 'f5df978a-5c11-4d17-b425-4aeb2c349cb8',
    kind: 'delete',
    status: 'pending',
  }
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname === '/')
      return new Response('<html>WireGuard Board</html>', {
        headers: {
          'Content-Type': 'text/html',
          ...securityHeaders,
          'Strict-Transport-Security': 'max-age=31536000',
          ...(options.fail === 'headers'
            ? { 'Content-Security-Policy': '' }
            : {}),
        },
      })
    expect(url.origin).toBe('https://board.example.com')
    expect(new Headers(init?.headers).get('X-WireGuard-Server')).toBe(
      config.apiUrl,
    )
    expect(new Headers(init?.headers).get('x-vercel-protection-bypass')).toBe(
      config.bypassSecret,
    )
    expect(init?.redirect).toBe('error')
    const path = url.searchParams.get('path')!
    if (path.startsWith('/v1/'))
      expect(new Headers(init?.headers).get('X-API-Token')).toBe(
        config.apiToken,
      )
    else expect(new Headers(init?.headers).has('X-API-Token')).toBe(false)
    if (path === '/livez') return json(live)
    if (path === '/readyz') return json(health)
    if (path === '/v1/server') return json(serverInfo)
    if (path === '/metrics')
      return new Response(
        options.fail === 'metrics' ? 'not-metrics' : 'wireguard_available 1\n',
        { headers: { 'Content-Type': 'text/plain' } },
      )
    if (init?.method === 'DELETE') {
      expect(path).toBe(`/v1/peers/${peer.id}`)
      if (options.fail === 'cleanup') return json({}, 503)
      if (options.pending)
        return json(deleteOperation, 202, { 'Retry-After': '7' })
      deleted = true
      return new Response(null, { status: 204 })
    }
    if (init?.method === 'POST') {
      postCount++
      if (options.fail === 'network' && postCount === 1) {
        created = true
        throw new Error(config.apiToken)
      }
      const replayed = created
      created = true
      if (options.fail === 'contract')
        return json({ peer: { id: peer.id } }, 201)
      if (replayed)
        return json({
          ...createdPeer,
          replayed: true,
          private_key:
            options.fail === 'replay' ? createdPeer.private_key : null,
          client_config: null,
        })
      return json(
        {
          ...createdPeer,
          client_config:
            options.fail === 'configuration'
              ? 'bad-config'
              : createdPeer.client_config,
          operation: options.pending
            ? { ...operation, status: 'pending' }
            : operation,
        },
        options.pending ? 202 : 201,
        { 'Retry-After': '7' },
      )
    }
    if (path.startsWith('/v1/peers?'))
      return json({
        items: (created && !deleted) || options.preexisting ? [peer] : [],
        next_cursor: null,
      })
    if (path === `/v1/operations/${deleteOperation.id}`) {
      deleted = true
      return json({ ...deleteOperation, status: 'complete' })
    }
    if (path === `/v1/operations/${operation.id}`) return json(operation)
    if (path === `/v1/peers/${peer.id}`)
      return deleted
        ? json({}, 404)
        : options.fail === 'inspection'
          ? json({}, 500)
          : json(peer)
    throw new Error('Unexpected smoke route')
  })
  return fetchMock
}

describe('deployed smoke workflow', () => {
  it('retries cleanup of only the disposable identity after a lost DELETE response', async () => {
    const base = fixture()
    let firstDelete = true
    const fetchMock = vi.fn<typeof fetch>(async (input, options) => {
      const result = await base(input, options)
      if (options?.method === 'DELETE' && firstDelete) {
        firstDelete = false
        throw new Error(config.apiToken)
      }
      return result
    })
    await runDeploymentSmoke(config, { fetch: fetchMock, wait: async () => {} })
    const deletes = fetchMock.mock.calls.filter(
      ([, options]) => options?.method === 'DELETE',
    )
    expect(deletes).toHaveLength(2)
    expect(String(deletes[0][0])).toBe(String(deletes[1][0]))
  })
  it('verifies deployment policies, creation, config, replay, inspection and exact-peer cleanup', async () => {
    const fetchMock = fixture()
    const progress = vi.fn()
    await runDeploymentSmoke(config, {
      fetch: fetchMock,
      wait: async () => {},
      onProgress: progress,
    })
    const mutations = fetchMock.mock.calls.filter(([, options]) =>
      ['POST', 'DELETE'].includes(options?.method ?? 'GET'),
    )
    expect(mutations.map(([, options]) => options?.method)).toEqual([
      'POST',
      'POST',
      'DELETE',
    ])
    expect(new Headers(mutations[0][1]?.headers).get('Idempotency-Key')).toBe(
      new Headers(mutations[1][1]?.headers).get('Idempotency-Key'),
    )
    expect(mutations[0][1]?.body).toBe(mutations[1][1]?.body)
    expect(progress).toHaveBeenCalledWith(
      'Disposable peer revoked and removal verified.',
    )
    const messages = JSON.stringify(progress.mock.calls)
    for (const secret of [
      config.apiToken,
      config.bypassSecret!,
      createdPeer.private_key!,
      createdPeer.client_config!,
    ])
      expect(messages).not.toContain(secret)
  })
  it('follows accepted creation and revocation using the upstream retry interval', async () => {
    const wait = vi.fn<(milliseconds: number) => Promise<void>>(async () => {})
    const fetchMock = fixture({ pending: true })
    await runDeploymentSmoke(config, { fetch: fetchMock, wait })
    expect(wait.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([
      7000, 7000,
    ])
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes(operation.id),
      ),
    ).toBe(true)
  })
  it.each(['configuration', 'replay', 'inspection', 'contract'] as const)(
    'cleans up a newly created peer after a %s failure',
    async (fail) => {
      const fetchMock = fixture({ fail })
      await expect(
        runDeploymentSmoke(config, { fetch: fetchMock, wait: async () => {} }),
      ).rejects.toThrow()
      expect(
        fetchMock.mock.calls.filter(
          ([, options]) => options?.method === 'DELETE',
        ),
      ).toHaveLength(1)
    },
  )
  it('never deletes an identity that existed before the smoke run', async () => {
    const fetchMock = fixture({ preexisting: true })
    await expect(
      runDeploymentSmoke(config, { fetch: fetchMock, wait: async () => {} }),
    ).rejects.toThrow('existing peers will not be deleted')
    expect(
      fetchMock.mock.calls.some(([, options]) => options?.method === 'DELETE'),
    ).toBe(false)
  })
  it.each(['headers', 'metrics'] as const)(
    'rejects a bad deployment %s before creating any peer',
    async (fail) => {
      const fetchMock = fixture({ fail })
      await expect(
        runDeploymentSmoke(config, { fetch: fetchMock }),
      ).rejects.toThrow()
      expect(
        fetchMock.mock.calls.some(([, options]) => options?.method === 'POST'),
      ).toBe(false)
    },
  )
  it('recovers identity with the same key after a lost response and still revokes it', async () => {
    const fetchMock = fixture({ fail: 'network' })
    let failure = ''
    try {
      await runDeploymentSmoke(config, {
        fetch: fetchMock,
        wait: async () => {},
      })
    } catch (error) {
      failure = (error as Error).message
    }
    expect(failure).toContain('one-time client configuration')
    expect(failure).not.toContain(config.apiToken)
    expect(
      fetchMock.mock.calls.filter(
        ([, options]) => options?.method === 'DELETE',
      ),
    ).toHaveLength(1)
    const posts = fetchMock.mock.calls.filter(
      ([, options]) => options?.method === 'POST',
    )
    expect(new Headers(posts[0][1]?.headers).get('Idempotency-Key')).toBe(
      new Headers(posts[1][1]?.headers).get('Idempotency-Key'),
    )
  })
  it('reports the exact disposable identity if cleanup cannot be completed', async () => {
    const fetchMock = fixture({ fail: 'cleanup' })
    await expect(
      runDeploymentSmoke(config, { fetch: fetchMock, wait: async () => {} }),
    ).rejects.toThrow(`Cleanup failed for disposable peer ${peer.id}`)
    expect(
      fetchMock.mock.calls.filter(
        ([, options]) => options?.method === 'DELETE',
      ),
    ).toHaveLength(3)
  })
  it('requires configuration without exposing credentials in validation errors', () => {
    expect(() => smokeConfig({})).toThrow(
      'SMOKE_BOARD_URL, SMOKE_API_URL, SMOKE_API_TOKEN',
    )
    expect(
      smokeConfig({
        SMOKE_BOARD_URL: config.boardUrl,
        SMOKE_API_URL: config.apiUrl,
        SMOKE_API_TOKEN: config.apiToken,
        SMOKE_BYPASS_SECRET: config.bypassSecret,
      }),
    ).toMatchObject(config)
  })
})
