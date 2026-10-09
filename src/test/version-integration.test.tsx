import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import App from '@/app'
import { VersionIndicator } from '@/components/version-indicator'
import { saveServers } from '@/lib/server-storage'
import { fetchReleases } from '@/lib/releases'
import { type Release } from '../../shared/releases'
import {
  server,
  health,
  live,
  jsonResponse,
  serverInfo,
  systemInfo,
  vpnStats,
} from './api-fixtures'
import { proxyTargetUrl } from './proxy-fixtures'

const available = (version: string, repository = 'wireguard-api'): Release => ({
  status: 'available',
  version,
  url: `https://github.com/ragnarok22/${repository}/releases/tag/v${version}`,
})
function renderWithClient(element: React.ReactNode, release?: Release) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  if (release)
    client.setQueryData(['releases'], {
      api: release,
      board: { status: 'none' },
    })
  render(<QueryClientProvider client={client}>{element}</QueryClientProvider>)
  return client
}

it.each([
  ['1.0.0', available('1.1.0'), true, 'Update available: v1.1.0'],
  ['1.10.0', available('1.9.0'), false, 'No newer stable release.'],
  ['1.0.0', available('1.0.0'), false, 'No newer stable release.'],
  ['1.0.0-rc.1', available('1.0.0'), true, 'Update available: v1.0.0'],
  ['1.0.0-rc.1', available('0.9.0'), false, 'No newer stable release.'],
  [
    'dev',
    available('1.0.0'),
    false,
    'Update comparison unavailable for this version.',
  ],
  [
    '1.0.0',
    { status: 'none' } as Release,
    false,
    'No stable releases published.',
  ],
  [
    '1.0.0',
    { status: 'unavailable' } as Release,
    false,
    'Update check unavailable.',
  ],
  [undefined, available('1.0.0'), false, 'Installed version unavailable.'],
])(
  'shows the correct update state for %s and %j',
  (version, release, outdated, message) => {
    renderWithClient(
      <VersionIndicator project="api" version={version} />,
      release,
    )
    const indicator = screen.getByLabelText(/^API /)
    expect(indicator.classList.contains('version-outdated')).toBe(outdated)
    expect(indicator).toHaveAttribute('title', message)
    if (outdated && release.status === 'available') {
      expect(screen.getByRole('link')).toHaveAttribute('href', release.url)
      expect(screen.getByRole('link')).toHaveAttribute('rel', 'noreferrer')
    } else expect(screen.queryByRole('link')).not.toBeInTheDocument()
  },
)

it('removes an outdated badge when the update check fails after a successful check', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
  const client = renderWithClient(
    <VersionIndicator project="api" version="1.0.0" />,
    available('1.1.0'),
  )
  expect(screen.getByLabelText(/^API /)).toHaveClass('version-outdated')
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['releases'] })
  })
  expect(screen.getByLabelText(/^API /)).not.toHaveClass('version-outdated')
  expect(screen.getByText('API v1.0.0')).toBeInTheDocument()
  expect(screen.getByText('Update check unavailable.')).toBeInTheDocument()
})

it('shows a pending check without claiming an update is available', () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise(() => {})),
  )
  renderWithClient(<VersionIndicator project="board" version="0.0.0" />)
  expect(screen.getByText('Checking for updates…')).toBeInTheDocument()
  expect(screen.getByLabelText(/^Board /)).not.toHaveClass('version-outdated')
})

it('uses one release query across the board and multiple servers, with independent API versions', async () => {
  const user = userEvent.setup()
  saveServers([
    server,
    {
      ...server,
      id: 'berlin',
      name: 'Berlin',
      url: 'https://berlin.example.com',
    },
  ])
  const fetchMock = vi.fn(
    async (input: string | URL | Request, options?: RequestInit) => {
      if (input === '/api/releases') {
        const headers = new Headers(options?.headers)
        expect(headers.get('X-API-Token')).toBeNull()
        expect(headers.get('X-WireGuard-Server')).toBeNull()
        expect(options?.credentials).toBe('omit')
        return jsonResponse({
          api: available('1.2.0'),
          board: available('2.0.0', 'wireguard-board'),
        })
      }
      const url = proxyTargetUrl(input, options)
      const version = url.host === 'berlin.example.com' ? '1.2.0' : '1.0.0'
      if (url.pathname === '/livez') return jsonResponse({ ...live, version })
      // Readiness is independent of version reporting and does not block a connection.
      if (url.pathname === '/readyz')
        return jsonResponse(
          { ...health, status: 'not_ready', reason: 'reconciling', version },
          503,
        )
      if (url.pathname === '/v1/server') return jsonResponse(serverInfo)
      if (url.pathname === '/v1/system') return jsonResponse(systemInfo)
      if (url.pathname === '/v1/stats') return jsonResponse(vpnStats)
      return jsonResponse({ items: [], next_cursor: null })
    },
  )
  vi.stubGlobal('fetch', fetchMock)
  renderWithClient(<App />)
  const board = await screen.findByLabelText(
    new RegExp(`^Board v${__BOARD_VERSION__}`),
  )
  await waitFor(() => expect(board).toHaveClass('version-outdated'))
  expect(board).toHaveTextContent(`Board v${__BOARD_VERSION__}`)
  const navigation = screen.getByRole('navigation', { name: 'Servers' })
  const unlock = async () => {
    await user.click(screen.getByRole('button', { name: 'Unlock server' }))
    await user.type(screen.getByLabelText('API token'), 'session-secret')
    await user.click(screen.getByRole('button', { name: 'Test & save' }))
    await screen.findByRole('region', { name: 'Server connection' })
  }
  await unlock()
  const amsterdam = within(navigation).getByRole('button', {
    name: /^Amsterdam/,
  })
  expect(await within(amsterdam).findByLabelText(/^API v1.0.0/)).toHaveClass(
    'version-outdated',
  )
  expect(amsterdam).toHaveTextContent('Not ready')
  expect(within(amsterdam).queryByRole('link')).not.toBeInTheDocument()
  const connection = screen.getByRole('region', { name: 'Server connection' })
  expect(
    within(connection).getByRole('link', { name: 'Update available: v1.2.0' }),
  ).toHaveAttribute(
    'href',
    'https://github.com/ragnarok22/wireguard-api/releases/tag/v1.2.0',
  )
  await user.click(within(navigation).getByRole('button', { name: /^Berlin/ }))
  await unlock()
  const berlin = within(navigation).getByRole('button', { name: /^Berlin/ })
  expect(await within(berlin).findByLabelText(/^API v1.2.0/)).not.toHaveClass(
    'version-outdated',
  )
  expect(within(amsterdam).getByLabelText(/^API v1.0.0/)).toHaveClass(
    'version-outdated',
  )
  await user.click(screen.getByRole('button', { name: 'Lock server' }))
  const lockedBerlin = within(navigation).getByRole('button', {
    name: /^Berlin/,
  })
  expect(
    within(lockedBerlin).getByLabelText(/^API version unavailable/),
  ).not.toHaveClass('version-outdated')
  expect(
    fetchMock.mock.calls.filter(([input]) => input === '/api/releases'),
  ).toHaveLength(1)
})

it('checks release HTTP status, response schema and request cancellation', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(
      jsonResponse({
        api: {
          status: 'available',
          version: 'dev',
          url: 'https://evil.example',
        },
        board: { status: 'none' },
      }),
    )
    .mockResolvedValueOnce(
      jsonResponse({ api: { status: 'none' }, board: { status: 'none' } }),
    )
  vi.stubGlobal('fetch', fetchMock)
  await expect(fetchReleases()).rejects.toThrow('Update check unavailable')
  await expect(fetchReleases()).rejects.toThrow()
  const controller = new AbortController()
  await expect(fetchReleases(controller.signal)).resolves.toEqual({
    api: { status: 'none' },
    board: { status: 'none' },
  })
  controller.abort()
  expect(fetchMock.mock.calls[2][1].signal.aborted).toBe(true)
})
