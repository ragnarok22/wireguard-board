import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import App from '@/app'
import { exportServers, maxServerImportBytes } from '@/lib/server-transfer'
import { saveServers, storageKey } from '@/lib/server-storage'
import { server } from './api-fixtures'

function setup() {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 } },
        })
      }
    >
      <App />
    </QueryClientProvider>,
  )
  return fetchMock
}

it('imports metadata as locked connections without network access or overwriting saved URLs', async () => {
  saveServers([server])
  const fetchMock = setup()
  const user = userEvent.setup()
  await user.click(
    screen.getByRole('button', { name: 'Import / export servers' }),
  )
  const file = new File(
    [
      exportServers([
        server,
        {
          ...server,
          id: 'same-external-id',
          name: 'Berlin',
          url: 'https://berlin.example.com',
        },
      ]),
    ],
    'servers.json',
    { type: 'application/json' },
  )
  await user.upload(screen.getByLabelText('Server metadata file'), file)
  expect(await screen.findByRole('status')).toHaveTextContent(
    '1 new connection · 1 already registered',
  )
  await user.click(screen.getByRole('button', { name: 'Import servers' }))
  expect(
    screen.getByRole('button', { name: 'Berlin Locked' }),
  ).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Amsterdam' })).toBeInTheDocument()
  expect(fetchMock).not.toHaveBeenCalled()
  const stored = JSON.parse(localStorage.getItem(storageKey)!)
  expect(stored.servers).toHaveLength(2)
  expect(stored.servers[0].name).toBe('Amsterdam')
  expect(stored.servers[1].id).not.toBe('same-external-id')
  expect(JSON.stringify(stored)).not.toContain('session-secret')
})

it('exports a metadata file and rejects secret-bearing or oversized imports', async () => {
  saveServers([server])
  setup()
  const user = userEvent.setup()
  let download: Blob | undefined
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    download = blob as Blob
    return 'blob:servers'
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  await user.click(
    screen.getByRole('button', { name: 'Import / export servers' }),
  )
  await user.click(screen.getByRole('button', { name: 'Export servers' }))
  expect(await download!.text()).toBe(exportServers([server]))
  const input = screen.getByLabelText('Server metadata file')
  await user.upload(
    input,
    new File(
      [JSON.stringify({ version: 1, servers: [server] })],
      'secret.json',
      { type: 'application/json' },
    ),
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Tokens and other fields are not accepted',
  )
  expect(screen.getByRole('button', { name: 'Import servers' })).toBeDisabled()
  await user.upload(
    input,
    new File(['x'.repeat(maxServerImportBytes + 1)], 'oversized.json', {
      type: 'application/json',
    }),
  )
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('1 MiB'),
  )
})

it('selects the first imported server when the workspace is empty', async () => {
  setup()
  const user = userEvent.setup()
  await user.click(
    screen.getByRole('button', { name: 'Import / export servers' }),
  )
  expect(screen.getByRole('button', { name: 'Export servers' })).toBeDisabled()
  await user.upload(
    screen.getByLabelText('Server metadata file'),
    new File([exportServers([server])], 'servers.json', {
      type: 'application/json',
    }),
  )
  await user.click(
    await screen.findByRole('button', { name: 'Import servers' }),
  )
  expect(
    screen.getByRole('heading', { name: 'Let’s reconnect.' }),
  ).toBeInTheDocument()
})
