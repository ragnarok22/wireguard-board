import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ServerDashboard } from '@/features/dashboard/server-dashboard'
import { proxyPath } from './proxy-fixtures'
import {
  health,
  jsonResponse,
  live,
  peer,
  server,
  serverInfo,
  systemInfo,
  vpnStats,
} from './api-fixtures'

function setup(overrides: Record<string, () => Response> = {}) {
  const mock = vi.fn(async (input: string) => {
    const path = new URL(proxyPath(input), 'http://localhost').pathname
    if (overrides[path]) return overrides[path]()
    if (path === '/v1/system') return jsonResponse(systemInfo)
    if (path === '/v1/stats') return jsonResponse(vpnStats)
    if (path === '/v1/server') return jsonResponse(serverInfo)
    if (path === '/v1/peers')
      return jsonResponse({ items: [peer], next_cursor: null })
    return path === '/livez' ? jsonResponse(live) : jsonResponse(health)
  })
  vi.stubGlobal('fetch', mock)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  client.setQueryData(['releases'], {
    api: { status: 'none' },
    board: { status: 'none' },
  })
  render(
    <QueryClientProvider client={client}>
      <ServerDashboard
        server={server}
        onSettings={vi.fn()}
        onLock={vi.fn()}
        onNotice={vi.fn()}
      />
    </QueryClientProvider>,
  )
  return { mock, client }
}

describe('dashboard telemetry', () => {
  it('uses API-wide aggregates rather than peer-list sums and displays system scope and capacity', async () => {
    setup()
    const vpn = within(screen.getByRole('region', { name: 'VPN telemetry' }))
    await vpn.findByText('1 KiB/s')
    expect(vpn.getByText('4')).toBeInTheDocument()
    expect(vpn.getByText('2 KiB/s')).toBeInTheDocument()
    expect(vpn.getByText('2 / 1 / 1')).toBeInTheDocument()
    expect(vpn.getByText('2 / 3 / 1')).toBeInTheDocument()
    expect(vpn.getByText(/249 available/)).toBeInTheDocument()
    expect(
      vpn.getByText(/unmanaged peers on the current interface/),
    ).toBeInTheDocument()
    const system = within(
      screen.getByRole('region', { name: 'System resources' }),
    )
    await system.findByText('25%')
    expect(system.getAllByText('50%')).toHaveLength(2)
    expect(system.getByText('0.25 / 0.5 effective cores')).toBeInTheDocument()
    expect(
      system.getByText('128 MiB / 256 MiB effective capacity'),
    ).toBeInTheDocument()
    expect(system.getByText(/not host-wide usage/)).toBeInTheDocument()
    expect(system.getByText(/Age at fetch: 0.25s/)).toBeInTheDocument()
  })
  it('distinguishes missing rates from zero, warm-up CPU and absent limits from unavailable resources', async () => {
    setup({
      '/v1/stats': () =>
        jsonResponse({
          ...vpnStats,
          traffic: {
            ...vpnStats.traffic,
            rx_bytes_per_second: null,
            tx_bytes_per_second: 0,
          },
          handshakes: { ...vpnStats.handshakes, latest_at: null },
        }),
      '/v1/system': () =>
        jsonResponse({
          ...systemInfo,
          status: 'partial',
          sample: { ...systemInfo.sample, interval_seconds: null },
          cpu: {
            ...systemInfo.cpu,
            status: 'warming_up',
            usage_percent: null,
            used_cores: null,
          },
          memory: { ...systemInfo.memory, limit_bytes: null },
          disk: null,
        }),
    })
    const vpn = within(screen.getByRole('region', { name: 'VPN telemetry' }))
    await vpn.findByText('0 B/s')
    expect(vpn.getByText('—')).toBeInTheDocument()
    expect(vpn.getByText('Never')).toBeInTheDocument()
    const system = within(
      screen.getByRole('region', { name: 'System resources' }),
    )
    await system.findByText('Partial telemetry')
    expect(system.getByText(/Warming up/)).toBeInTheDocument()
    expect(system.getByText('No configured limit')).toBeInTheDocument()
    expect(
      system.getByText(/Measurement interval: unavailable/),
    ).toBeInTheDocument()
  })
  it('hides old VPN measurements after a failed refresh while keeping system information and peers usable', async () => {
    let failed = false
    const { client } = setup({
      '/v1/stats': () =>
        failed
          ? jsonResponse(
              { code: 'telemetry_unavailable', detail: 'VPN sampler failed' },
              503,
            )
          : jsonResponse(vpnStats),
    })
    await screen.findByText('1 KiB/s')
    failed = true
    await act(async () => {
      await client.refetchQueries({
        queryKey: ['server', server.id, server.session, 'vpn-stats'],
      })
    })
    const vpn = within(screen.getByRole('region', { name: 'VPN telemetry' }))
    expect(await vpn.findByRole('status')).toHaveTextContent(
      'VPN sampler failed',
    )
    expect(vpn.queryByText('1 KiB/s')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add peer' })).toBeEnabled()
    expect(
      screen.getByRole('button', { name: 'View peer 10.13.13.2/32' }),
    ).toBeInTheDocument()
    expect(
      within(
        screen.getByRole('region', { name: 'System resources' }),
      ).getByText('25%'),
    ).toBeInTheDocument()
    failed = false
    const user = userEvent.setup()
    await user.click(vpn.getByRole('button', { name: 'Retry vpn statistics' }))
    await vpn.findByText('1 KiB/s')
  })
  it('refreshes both authenticated endpoints manually and keeps VPN data available when system sampling fails', async () => {
    let failed = true
    const { mock } = setup({
      '/v1/system': () =>
        failed
          ? jsonResponse(
              {
                code: 'telemetry_unavailable',
                detail: 'System sampler failed',
              },
              503,
            )
          : jsonResponse(systemInfo),
    })
    const system = within(
      screen.getByRole('region', { name: 'System resources' }),
    )
    expect(
      await system.findByText(/System telemetry unavailable/),
    ).toHaveTextContent('System sampler failed')
    expect(screen.getByText('1 KiB/s')).toBeInTheDocument()
    failed = false
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    await system.findByText('25%')
    expect(
      mock.mock.calls.filter(([url]) => proxyPath(url).endsWith('/v1/system')),
    ).toHaveLength(2)
    expect(
      mock.mock.calls.filter(([url]) => proxyPath(url).endsWith('/v1/stats')),
    ).toHaveLength(2)
  })
  it('does not cap CPU bursts or fabricate counters for unsupported cgroups', async () => {
    setup({
      '/v1/system': () =>
        jsonResponse({
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
        }),
    })
    const system = within(
      screen.getByRole('region', { name: 'System resources' }),
    )
    await system.findByText('125.5%')
    expect(
      system.getByText('Unavailable / Unavailable effective capacity'),
    ).toBeInTheDocument()
    expect(system.queryByText('No configured limit')).not.toBeInTheDocument()
  })
})
