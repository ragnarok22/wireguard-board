import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from '@/app'
import { CreatePeerDialog } from '@/features/peers/create-peer-dialog'
import { ServerDashboard } from '@/features/dashboard/server-dashboard'
import { saveServers, storageKey } from '@/lib/server-storage'
import {
  health,
  jsonResponse,
  partialConfig,
  peer,
  privateKey,
  publicKey,
  server,
} from './api-fixtures'

function renderApp(element = <App />) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  const result = render(
    <QueryClientProvider client={client}>{element}</QueryClientProvider>,
  )
  return { ...result, client }
}

function mockApi() {
  const peersByHost = new Map([
    ['amsterdam.example.com', [peer]],
    ['berlin.example.com', [{ ...peer, allowed_ips: ['10.20.0.2/32'] }]],
  ])
  const fetchMock = vi.fn(
    async (input: string | URL | Request, options?: RequestInit) => {
      const url = new URL(String(input))
      const list = peersByHost.get(url.host) ?? []
      if (url.pathname === '/health')
        return jsonResponse({ ...health, peer_count: list.length })
      if (
        (options?.headers as Record<string, string>)?.['X-API-Token'] !==
        'session-secret'
      )
        return jsonResponse({ detail: 'Invalid token' }, 403)
      if (options?.method === 'DELETE') {
        peersByHost.set(
          url.host,
          list.filter(
            (item) =>
              item.public_key !==
              decodeURIComponent(url.pathname.split('/')[2]),
          ),
        )
        return new Response(null, { status: 204 })
      }
      if (options?.method === 'POST') {
        const created = {
          public_key: 'd'.repeat(43) + '=',
          private_key: privateKey,
          allowed_ips: ['10.13.13.3/32'],
        }
        peersByHost.set(url.host, [...list, { ...peer, ...created }])
        return jsonResponse(created, 201)
      }
      if (url.pathname.endsWith('/config'))
        return jsonResponse({ config: partialConfig })
      if (url.pathname === '/peers') return jsonResponse(list)
      const result = list.find(
        (item) =>
          item.public_key === decodeURIComponent(url.pathname.split('/')[2]),
      )
      return result
        ? jsonResponse(result)
        : jsonResponse({ detail: 'Peer not found' }, 404)
    },
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function connectSavedServer(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Unlock server' }))
  await user.type(screen.getByLabelText('API token'), 'session-secret')
  await user.click(screen.getByRole('button', { name: 'Test & save' }))
  await screen.findByRole('button', { name: 'View peer 10.13.13.2/32' })
}

describe('workspace workflows', () => {
  it('starts with a real empty state and connects a tested server', async () => {
    const fetchMock = mockApi()
    const user = userEvent.setup()
    renderApp()
    expect(
      screen.getByRole('heading', { name: 'A home for your connections.' }),
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    await user.click(
      screen.getByRole('button', { name: 'Add your first server' }),
    )
    await user.type(screen.getByLabelText('Server name'), 'Amsterdam')
    await user.type(screen.getByLabelText(/API URL/), server.url)
    await user.type(screen.getByLabelText('API token'), 'session-secret')
    await user.click(screen.getByRole('button', { name: 'Test & save' }))
    await screen.findByRole('button', { name: 'View peer 10.13.13.2/32' })
    expect(
      screen.getByRole('heading', { name: 'Amsterdam' }),
    ).toBeInTheDocument()
    expect(localStorage.getItem(storageKey)).not.toContain('session-secret')
  })

  it('restores saved servers locked, rejecting bad tokens before saving', async () => {
    mockApi()
    saveServers([server])
    const user = userEvent.setup()
    renderApp()
    expect(
      screen.getByRole('heading', { name: 'Let’s reconnect.' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Unlock server' }))
    await user.type(screen.getByLabelText('API token'), 'wrong-token')
    await user.click(screen.getByRole('button', { name: 'Test & save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Authentication failed',
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('isolates peer data between servers and forgets credentials when locking', async () => {
    mockApi()
    saveServers([server])
    const user = userEvent.setup()
    const { client } = renderApp()
    await connectSavedServer(user)
    await user.click(screen.getAllByRole('button', { name: 'Add server' })[0])
    await user.type(screen.getByLabelText('Server name'), 'Berlin')
    await user.type(
      screen.getByLabelText(/API URL/),
      'https://berlin.example.com',
    )
    await user.type(screen.getByLabelText('API token'), 'session-secret')
    await user.click(screen.getByRole('button', { name: 'Test & save' }))
    await screen.findByRole('button', { name: 'View peer 10.20.0.2/32' })
    expect(
      screen.queryByRole('button', { name: 'View peer 10.13.13.2/32' }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Lock server' }))
    expect(
      screen.getByRole('heading', { name: 'Let’s reconnect.' }),
    ).toBeInTheDocument()
    expect(
      client
        .getQueryCache()
        .getAll()
        .filter((query) => query.queryKey[1] !== server.id)
        .every((query) => query.state.data === undefined),
    ).toBe(true)
    await user.click(screen.getByRole('button', { name: /Amsterdam Healthy/ }))
    await screen.findByRole('button', { name: 'View peer 10.13.13.2/32' })
  })

  it('removes a saved connection without deleting peers on the backend', async () => {
    const fetchMock = mockApi()
    saveServers([server])
    const user = userEvent.setup()
    renderApp()
    await user.click(
      screen.getByRole('button', { name: 'Connection settings' }),
    )
    await user.click(
      screen.getByRole('button', { name: 'Remove server connection' }),
    )
    expect(
      screen.getByText(/Its WireGuard peers will stay/),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove connection' }))
    expect(
      screen.getByRole('heading', { name: 'A home for your connections.' }),
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem(storageKey)!).servers).toEqual([])
  })

  it('filters peers, inspects partial configs and confirms bodyless deletion', async () => {
    const fetchMock = mockApi()
    const user = userEvent.setup()
    renderApp(
      <ServerDashboard
        server={server}
        onSettings={vi.fn()}
        onLock={vi.fn()}
        onNotice={vi.fn()}
      />,
    )
    await screen.findByRole('button', { name: 'View peer 10.13.13.2/32' })
    await user.type(
      screen.getByRole('textbox', { name: 'Search peers' }),
      'not-found',
    )
    expect(
      screen.getByRole('heading', { name: 'No matching peers' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    await user.click(
      screen.getByRole('button', { name: 'View peer 10.13.13.2/32' }),
    )
    await user.click(
      screen.getByRole('button', { name: 'View partial config' }),
    )
    expect(
      await screen.findByText(/Endpoint = vpn.example.com:51820/, {
        selector: 'pre',
      }),
    ).toHaveTextContent('PersistentKeepalive = 25')
    expect(
      screen.getByText(/not a ready-to-import client file/),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete peer' }))
    expect(
      screen.getByRole('heading', { name: 'Delete this peer?' }),
    ).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(([, options]) => options?.method === 'DELETE'),
    ).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Delete peer' }))
    await screen.findByRole('heading', {
      name: 'Your first connection starts here',
    })
    expect(
      fetchMock.mock.calls.filter(
        ([, options]) => options?.method === 'DELETE',
      ),
    ).toHaveLength(1)
  })

  it('shows actionable errors and recovers through manual refresh', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(jsonResponse({ detail: 'Service unavailable' }, 500)),
      )
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    renderApp(
      <ServerDashboard
        server={server}
        onSettings={vi.fn()}
        onLock={vi.fn()}
        onNotice={vi.fn()}
      />,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Service unavailable',
    )
    expect(screen.getByRole('button', { name: 'Add peer' })).toBeDisabled()
    mockApi()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByRole('button', { name: 'View peer 10.13.13.2/32' })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('one-time peer configuration', () => {
  it('creates once and keeps the private key when configuration retrieval must be retried', async () => {
    let configCalls = 0
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (options?.method === 'POST')
        return jsonResponse(
          {
            public_key: publicKey,
            private_key: privateKey,
            allowed_ips: ['10.13.13.2/32'],
          },
          201,
        )
      if (url.endsWith('/config')) {
        configCalls++
        return configCalls === 1
          ? jsonResponse({ detail: 'Temporary configuration error' }, 500)
          : jsonResponse({ config: partialConfig })
      }
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    renderApp(<CreatePeerDialog server={server} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Create peer' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your peer was created successfully',
    )
    expect(
      screen.getByRole('button', { name: 'Save creation response' }),
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'Retry configuration' }),
    )
    await screen.findByRole('button', { name: 'Download .conf' })
    expect(
      screen.getByText(new RegExp(`PrivateKey = ${privateKey}`), {
        selector: 'pre',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByTitle('WireGuard client configuration'),
    ).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST'),
    ).toHaveLength(1)
    expect(configCalls).toBe(2)
    expect(localStorage.length).toBe(0)
  })

  it('creates a custom-key peer without fetching or pretending to have its private key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          public_key: publicKey,
          allowed_ips: ['10.13.13.9/32'],
          private_key: null,
        },
        201,
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    renderApp(<CreatePeerDialog server={server} onClose={vi.fn()} />)
    await user.click(screen.getByText('Advanced options'))
    await user.type(screen.getByLabelText(/Public key/), publicKey)
    await user.type(screen.getByLabelText(/Allowed IPs/), '10.13.13.9/32')
    await user.click(screen.getByRole('button', { name: 'Create peer' }))
    expect(
      await screen.findByText(/Your peer uses the public key you provided/),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Download .conf' }),
    ).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      public_key: publicKey,
      allowed_ips: ['10.13.13.9/32'],
    })
  })

  it('does not automatically retry an ambiguous creation failure', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Lost response'))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    renderApp(<CreatePeerDialog server={server} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Create peer' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'a peer may already exist',
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Create peer',
      }),
    ).toBeEnabled()
  })
})
