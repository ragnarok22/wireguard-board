import { describe, expect, it, vi } from 'vitest'
import { api } from './api-client'
import { proxyUrl } from '@/test/proxy-fixtures'
import { jsonResponse, server, systemInfo, vpnStats } from '@/test/api-fixtures'

describe('authenticated telemetry contracts', () => {
  it('reads both endpoints with authentication, no-store, URL prefixes and cancellation signals', async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(vpnStats))
      .mockResolvedValueOnce(jsonResponse(systemInfo))
    vi.stubGlobal('fetch', mock)
    const connection = { ...server, url: `${server.url}/api` }
    const controller = new AbortController()
    await expect(api.stats(connection, controller.signal)).resolves.toEqual(
      vpnStats,
    )
    await expect(api.system(connection, controller.signal)).resolves.toEqual(
      systemInfo,
    )
    expect(mock.mock.calls.map(([url]) => url)).toEqual([
      proxyUrl('/v1/stats'),
      proxyUrl('/v1/system'),
    ])
    for (const [, options] of mock.mock.calls) {
      expect(options.headers.get('X-API-Token')).toBe(server.token)
      expect(options.headers.get('X-WireGuard-Server')).toBe(connection.url)
      expect(options.cache).toBe('no-store')
      expect(options.credentials).toBe('omit')
      expect(options.signal).toBeInstanceOf(AbortSignal)
    }
  })
  it('supports a custom handshake window and preserves null rates after resets', async () => {
    const stats = {
      ...vpnStats,
      handshakes: { ...vpnStats.handshakes, window_seconds: 60 },
      sample: { ...vpnStats.sample, interval_seconds: null },
      traffic: {
        ...vpnStats.traffic,
        rx_bytes_per_second: null,
        tx_bytes_per_second: null,
      },
    }
    const mock = vi.fn().mockResolvedValue(jsonResponse(stats))
    vi.stubGlobal('fetch', mock)
    await expect(api.stats(server, undefined, 60)).resolves.toEqual(stats)
    expect(mock.mock.calls[0][0]).toBe(
      proxyUrl('/v1/stats?handshake_window_seconds=60'),
    )
  })
  it('accepts CPU quota bursts above 100% and partially unavailable cgroup information', async () => {
    const system = {
      ...systemInfo,
      status: 'partial',
      cpu: { ...systemInfo.cpu, usage_percent: 125.5 },
      memory: {
        source: 'unavailable',
        used_bytes: null,
        limit_bytes: null,
        capacity_bytes: null,
        usage_percent: null,
      },
      disk: null,
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(system)))
    await expect(api.system(server)).resolves.toEqual(system)
  })
  it.each(['stats', 'system'] as const)(
    'preserves safe telemetry-unavailable errors from /v1/%s',
    async (endpoint) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          jsonResponse(
            {
              code: 'telemetry_unavailable',
              detail: 'Telemetry sample is unavailable',
            },
            503,
          ),
        ),
      )
      await expect(api[endpoint](server)).rejects.toMatchObject({
        status: 503,
        code: 'telemetry_unavailable',
        message: 'Telemetry sample is unavailable',
      })
    },
  )
  it.each([
    {
      endpoint: 'stats' as const,
      body: { ...vpnStats, traffic: { ...vpnStats.traffic, rx_bytes: -1 } },
    },
    {
      endpoint: 'stats' as const,
      body: {
        ...vpnStats,
        traffic: { ...vpnStats.traffic, scope: 'historical' },
      },
    },
    {
      endpoint: 'system' as const,
      body: { ...systemInfo, resource_scope: 'host' },
    },
    {
      endpoint: 'system' as const,
      body: { ...systemInfo, cpu: { ...systemInfo.cpu, status: 'healthy' } },
    },
    {
      endpoint: 'system' as const,
      body: {
        ...systemInfo,
        sample: { sampled_at: 1, age_seconds: -1, interval_seconds: 1 },
      },
    },
  ])(
    'rejects malformed or misleading $endpoint telemetry',
    async ({ endpoint, body }) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(body)))
      await expect(api[endpoint](server)).rejects.toThrow('unexpected response')
    },
  )
})
