import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from '@/app'
import { CreatePeerDialog } from '@/features/peers/create-peer-dialog'
import { ServerDashboard } from '@/features/dashboard/server-dashboard'
import { saveServers, storageKey } from '@/lib/server-storage'
import { proxyPath, proxyTargetUrl } from './proxy-fixtures'
import {
  health,
  jsonResponse,
  configTemplate,
  clientConfig,
  createdPeer,
  live,
  operation,
  serverInfo,
  systemInfo,
  vpnStats,
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
    ['berlin.example.com', [{ ...peer, address: '10.20.0.2' }]],
  ])
  const fetchMock = vi.fn(
    async (input: string | URL | Request, options?: RequestInit) => {
      if (input === '/api/releases')
        return jsonResponse({
          api: { status: 'none' },
          board: { status: 'none' },
        })
      const url = proxyTargetUrl(input, options)
      const list = peersByHost.get(url.host) ?? []
      if (url.pathname === '/readyz') return jsonResponse(health)
      if (url.pathname === '/livez') return jsonResponse(live)
      if (url.pathname === '/metrics')
        return new Response('wireguard_available 1\nwireguard_peers_total 1\n')
      if (new Headers(options?.headers).get('X-API-Token') !== 'session-secret')
        return jsonResponse({ detail: 'Invalid token' }, 403)
      if (url.pathname === '/v1/system') return jsonResponse(systemInfo)
      if (url.pathname === '/v1/stats')
        return jsonResponse({
          ...vpnStats,
          peers: { ...vpnStats.peers, registered: list.length },
        })
      if (options?.method === 'DELETE') {
        peersByHost.set(
          url.host,
          list.filter((item) => item.id !== url.pathname.split('/')[3]),
        )
        return new Response(null, { status: 204 })
      }
      if (options?.method === 'POST') {
        const nextPeer = {
          ...peer,
          id: '89a94a53-c94a-46c7-ab91-bc52196c1355',
          public_key: 'd'.repeat(42) + 'A=',
          address: '10.13.13.3',
        }
        const created = {
          ...createdPeer,
          peer: nextPeer,
          operation: { ...operation, peer_id: nextPeer.id },
          client_config: clientConfig.replace('10.13.13.2', '10.13.13.3'),
        }
        peersByHost.set(url.host, [...list, nextPeer])
        return jsonResponse(created, 201)
      }
      if (url.pathname.endsWith('/config-template'))
        return jsonResponse({ config: configTemplate })
      if (url.pathname === '/v1/server')
        return jsonResponse({
          ...serverInfo,
          reserved: list.length,
          available: serverInfo.capacity - list.length,
        })
      if (url.pathname === '/v1/peers')
        return jsonResponse({ items: list, next_cursor: null })
      const result = list.find((item) => item.id === url.pathname.split('/')[3])
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
  it('returns keyboard focus to the opening action after closing a dialog', async () => {
    const user = userEvent.setup()
    renderApp()
    const opener = screen.getByRole('button', { name: 'Add your first server' })
    await user.click(opener)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })
  it('starts with a real empty state and connects a tested server', async () => {
    const fetchMock = mockApi()
    const user = userEvent.setup()
    renderApp()
    expect(
      screen.getByRole('heading', { name: 'A home for your connections.' }),
    ).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.every(([input]) => input === '/api/releases'),
    ).toBe(true)
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
    await user.click(screen.getByRole('button', { name: /Amsterdam Ready/ }))
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

  it('filters peers, inspects templates and confirms bodyless deletion', async () => {
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
      screen.getByRole('button', { name: 'View config template' }),
    )
    expect(
      await screen.findByText(/Endpoint = vpn.your-domain.tld:51820/, {
        selector: 'pre',
      }),
    ).toHaveTextContent('PersistentKeepalive = 25')
    expect(
      screen.getByText(/not a ready-to-import client file/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/PrivateKey = <YOUR_PRIVATE_KEY>/, { selector: 'pre' }),
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
  it('allows editing a definitively rejected request and creates a new request key', async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            code: 'invalid_input',
            detail: 'Address must be a usable client IP inside the pool',
          },
          422,
        ),
      )
      .mockResolvedValueOnce(jsonResponse(createdPeer, 201))
    vi.stubGlobal('fetch', mock)
    const user = userEvent.setup()
    renderApp(<CreatePeerDialog server={server} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Create peer' }))
    await user.click(
      await screen.findByRole('button', { name: 'Edit request' }),
    )
    await user.click(screen.getByText('Advanced options'))
    await user.type(screen.getByLabelText(/VPN address/), '10.13.13.2')
    await user.click(screen.getByRole('button', { name: 'Create peer' }))
    await screen.findByRole('heading', { name: 'Your peer is ready' })
    expect(mock.mock.calls[0][1].headers.get('Idempotency-Key')).not.toBe(
      mock.mock.calls[1][1].headers.get('Idempotency-Key'),
    )
    expect(JSON.parse(mock.mock.calls[1][1].body).address).toBe('10.13.13.2')
  })
  it('downloads and copies the generated config, then discards the one-time key on close', async () => {
    mockApi()
    saveServers([server])
    const user = userEvent.setup()
    const clipboard = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue()
    let download: Blob | undefined
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      download = blob as Blob
      return 'blob:client-config'
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    let filename = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      filename = this.download
    })
    const { client } = renderApp()
    await connectSavedServer(user)
    await user.click(screen.getByRole('button', { name: 'Add peer' }))
    const name = screen.getByLabelText(/Configuration filename/)
    await user.clear(name)
    await user.type(name, 'Work Laptop')
    await user.click(screen.getByRole('button', { name: 'Create peer' }))
    await user.click(
      await screen.findByRole('button', { name: 'Download .conf' }),
    )
    expect(filename).toBe('work-laptop.conf')
    expect(await download!.text()).toContain(`PrivateKey = ${privateKey}`)
    expect(await download!.text()).toContain('Address = 10.13.13.3/32')
    await user.click(screen.getByRole('button', { name: 'Copy config' }))
    expect(clipboard).toHaveBeenCalledWith(await download!.text())
    await user.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() =>
      expect(client.getMutationCache().getAll()).toHaveLength(0),
    )
    expect(
      JSON.stringify(
        client
          .getQueryCache()
          .getAll()
          .map((query) => query.state.data),
      ),
    ).not.toContain(privateKey)
    expect(localStorage.getItem(storageKey)).not.toContain(privateKey)
    await screen.findByRole('button', { name: 'View peer 10.13.13.3/32' })
  })
  it('saves pending credentials immediately and enables the QR only after operation completion', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      proxyPath(url).endsWith('/v1/peers')
        ? jsonResponse(
            {
              ...createdPeer,
              operation: {
                ...operation,
                status: 'pending',
                error: 'wireguard_unavailable',
              },
            },
            202,
          )
        : jsonResponse(operation),
    )
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    const { client } = renderApp(
      <CreatePeerDialog server={server} onClose={vi.fn()} />,
    )
    await user.click(screen.getByRole('button', { name: 'Create peer' }))
    await screen.findByRole('heading', { name: 'Peer application pending' })
    expect(screen.getByRole('button', { name: 'Download .conf' })).toBeEnabled()
    expect(
      screen.queryByTitle('WireGuard client configuration'),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(/Wait until the operation is complete/),
    ).toBeInTheDocument()
    await act(async () => {
      await client.refetchQueries({
        queryKey: [
          'server',
          server.id,
          server.session,
          'operation',
          operation.id,
        ],
      })
    })
    await screen.findByRole('heading', { name: 'Your peer is ready' })
    expect(
      screen.getByTitle('WireGuard client configuration'),
    ).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        proxyPath(url).endsWith('/v1/peers'),
      ),
    ).toHaveLength(1)
    expect(
      screen.getByText(/DNS = 9.9.9.9/, { selector: 'pre' }),
    ).toBeInTheDocument()
    expect(localStorage.length).toBe(0)
  })

  it('creates a custom-key peer without fetching or pretending to have its private key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          ...createdPeer,
          peer: { ...peer, address: '10.13.13.9' },
          private_key: null,
          client_config: null,
        },
        201,
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    renderApp(<CreatePeerDialog server={server} onClose={vi.fn()} />)
    await user.click(screen.getByText('Advanced options'))
    await user.type(screen.getByLabelText(/Public key/), publicKey)
    await user.type(screen.getByLabelText(/VPN address/), '10.13.13.9')
    await user.click(screen.getByRole('button', { name: 'Create peer' }))
    expect(
      await screen.findByText(/Your peer uses the public key you provided/),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Download .conf' }),
    ).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      key_mode: 'external',
      public_key: publicKey,
      address: '10.13.13.9',
    })
  })

  it('retries a lost response with exactly the same key and body and explains credential loss', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Lost response'))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            ...createdPeer,
            private_key: null,
            client_config: null,
            replayed: true,
          },
          200,
        ),
      )
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    renderApp(<CreatePeerDialog server={server} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Create peer' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Retry this same request',
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Retry same request',
      }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Revoke this peer',
    )
    expect(fetchMock.mock.calls[0][1].body).toBe(
      fetchMock.mock.calls[1][1].body,
    )
    expect(fetchMock.mock.calls[0][1].headers.get('Idempotency-Key')).toBe(
      fetchMock.mock.calls[1][1].headers.get('Idempotency-Key'),
    )
    expect(
      screen.queryByRole('button', { name: 'Download .conf' }),
    ).not.toBeInTheDocument()
  })

  it('rejects noncanonical public keys and CIDR addresses before sending a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    renderApp(<CreatePeerDialog server={server} onClose={vi.fn()} />)
    await user.click(screen.getByText('Advanced options'))
    await user.type(screen.getByLabelText(/Public key/), 'invalid')
    await user.click(screen.getByRole('button', { name: 'Create peer' }))
    expect(screen.getByRole('alert')).toHaveTextContent('canonical')
    await user.clear(screen.getByLabelText(/Public key/))
    await user.type(screen.getByLabelText(/VPN address/), '10.13.13.9/32')
    await user.click(screen.getByRole('button', { name: 'Create peer' }))
    expect(screen.getByRole('alert')).toHaveTextContent('bare IPv4')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('monitoring and durable operations', () => {
  it('shows server capacity and reads, copies and downloads public metrics on demand', async () => {
    const fetchMock = mockApi()
    const user = userEvent.setup()
    const clipboard = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue()
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:metrics')
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {})
    renderApp(
      <ServerDashboard
        server={server}
        onSettings={vi.fn()}
        onLock={vi.fn()}
        onNotice={vi.fn()}
      />,
    )
    await screen.findByText(/253 total/)
    expect(
      fetchMock.mock.calls.some(([url]) => proxyPath(url).endsWith('/metrics')),
    ).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Metrics' }))
    await screen.findByText(/wireguard_available 1/, { selector: 'pre' })
    await user.click(screen.getByRole('button', { name: 'Copy metrics' }))
    expect(clipboard).toHaveBeenCalledWith(
      expect.stringContaining('wireguard_peers_total 1'),
    )
    await user.click(screen.getByRole('button', { name: 'Download metrics' }))
    expect(click).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Refresh metrics' }))
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps revocation pending after the dialog closes and refreshes only after verified completion', async () => {
    const base = mockApi()
    let completed = false
    const pending = {
      ...operation,
      kind: 'delete',
      status: 'pending',
      error: 'wireguard_unavailable',
      request_key: null,
      fingerprint: null,
    }
    const mock = vi.fn(async (input: string, options?: RequestInit) => {
      if (options?.method === 'DELETE')
        return jsonResponse(pending, 202, { 'Retry-After': '7' })
      if (proxyPath(input).includes('/v1/operations/')) {
        completed = true
        return jsonResponse({ ...pending, status: 'complete', error: null })
      }
      if (completed && proxyPath(input).includes('/v1/peers?'))
        return jsonResponse({ items: [], next_cursor: null })
      return base(input, options)
    })
    vi.stubGlobal('fetch', mock)
    const notice = vi.fn()
    const user = userEvent.setup()
    const { client } = renderApp(
      <ServerDashboard
        server={server}
        onSettings={vi.fn()}
        onLock={vi.fn()}
        onNotice={notice}
      />,
    )
    await user.click(
      await screen.findByRole('button', { name: 'View peer 10.13.13.2/32' }),
    )
    await user.click(screen.getByRole('button', { name: 'Delete peer' }))
    await user.click(screen.getByRole('button', { name: 'Delete peer' }))
    await screen.findByText(/Revocation pending ·/)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(notice).toHaveBeenCalledWith(
      expect.stringContaining('Revocation pending'),
    )
    expect(completed).toBe(false)
    expect(
      screen.getByRole('button', { name: 'View peer 10.13.13.2/32' }),
    ).toBeInTheDocument()
    await act(async () => {
      await client.refetchQueries({
        queryKey: [
          'server',
          server.id,
          server.session,
          'operation',
          operation.id,
        ],
      })
    })
    await screen.findByText(/Revocation complete ·/)
    await screen.findByRole('heading', {
      name: 'Your first connection starts here',
    })
    expect(screen.getByText('VPN access has been removed.')).toBeInTheDocument()
    expect(
      mock.mock.calls.filter(([, options]) => options?.method === 'DELETE'),
    ).toHaveLength(1)
  })

  it('shows not-ready reasons and missing observations without invented traffic', async () => {
    const base = mockApi()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, options?: RequestInit) =>
        proxyPath(input).endsWith('/readyz')
          ? jsonResponse(
              { ...health, status: 'not_ready', reason: 'state_not_converged' },
              503,
            )
          : proxyPath(input).includes('/v1/peers?')
            ? jsonResponse({
                items: [
                  {
                    ...peer,
                    observation: null,
                    state: 'pending',
                    applied: false,
                  },
                ],
                next_cursor: null,
              })
            : base(input, options),
      ),
    )
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
      'state_not_converged',
    )
    const row = (
      await screen.findByRole('button', { name: 'View peer 10.13.13.2/32' })
    ).closest('tr')!
    expect(row).toHaveTextContent('pending')
    expect(row).not.toHaveTextContent('0 B')
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Filter peers by activity' }),
      'pending',
    )
    expect(
      screen.getByRole('button', { name: 'View peer 10.13.13.2/32' }),
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'View peer 10.13.13.2/32' }),
    )
    await screen.findByText('Peer ID')
  })
})
