// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { createReleasesHandler } from './releases-handler.ts'
import vercelHandler from '../api/releases.ts'

const request = () => new Request('https://board.example/api/releases')
const release = (tag = 'v1.10.0') =>
  Response.json({
    tag_name: tag,
    draft: false,
    prerelease: false,
    html_url: 'https://untrusted.example/link',
  })
afterEach(() => vi.useRealTimers())

it('requests only fixed repositories, ignores caller headers, and shares concurrent checks', async () => {
  const fetchRelease = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => release())
  const handle = createReleasesHandler(fetchRelease)
  const [response, concurrent] = await Promise.all([
    handle(
      new Request('https://board.example/api/releases?repo=evil', {
        headers: {
          'X-API-Token': 'secret',
          Cookie: 'secret',
          Authorization: 'secret',
        },
      }),
    ),
    handle(request()),
  ])
  expect(await response.json()).toEqual({
    api: {
      status: 'available',
      version: '1.10.0',
      url: 'https://github.com/ragnarok22/wireguard-api/releases/tag/v1.10.0',
    },
    board: {
      status: 'available',
      version: '1.10.0',
      url: 'https://github.com/ragnarok22/wireguard-board/releases/tag/v1.10.0',
    },
  })
  expect(concurrent.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toContain('s-maxage=')
  expect(fetchRelease).toHaveBeenCalledTimes(2)
  expect(fetchRelease.mock.calls.map(([url]) => url)).toEqual([
    'https://api.github.com/repos/ragnarok22/wireguard-api/releases/latest',
    'https://api.github.com/repos/ragnarok22/wireguard-board/releases/latest',
  ])
  for (const [, init] of fetchRelease.mock.calls) {
    const headers = new Headers(init?.headers)
    expect(headers.get('X-API-Token')).toBeNull()
    expect(headers.get('Authorization')).toBeNull()
    expect(headers.get('Cookie')).toBeNull()
    expect(init?.redirect).toBe('error')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  }
  await handle(request())
  expect(fetchRelease).toHaveBeenCalledTimes(2)
})

it('expires successful checks after one hour', async () => {
  vi.useFakeTimers()
  const fetchRelease = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => release())
  const handle = createReleasesHandler(fetchRelease)
  await handle(request())
  vi.advanceTimersByTime(3_599_000)
  await handle(request())
  expect(fetchRelease).toHaveBeenCalledTimes(2)
  vi.advanceTimersByTime(1_000)
  await handle(request())
  expect(fetchRelease).toHaveBeenCalledTimes(4)
})

it('distinguishes missing releases from GitHub failure, with a shorter failure cache', async () => {
  vi.useFakeTimers()
  const fetchRelease = vi.fn<typeof fetch>().mockImplementation(
    async (url) =>
      new Response(null, {
        status: String(url).includes('wireguard-api') ? 403 : 404,
      }),
  )
  const handle = createReleasesHandler(fetchRelease)
  expect(await (await handle(request())).json()).toEqual({
    api: { status: 'unavailable' },
    board: { status: 'none' },
  })
  vi.advanceTimersByTime(299_000)
  await handle(request())
  expect(fetchRelease).toHaveBeenCalledTimes(2)
  vi.advanceTimersByTime(1_000)
  await handle(request())
  expect(fetchRelease).toHaveBeenCalledTimes(4)
})

it.each([
  { tag_name: 'v1.0.0-rc.1', draft: false, prerelease: false },
  { tag_name: 'v1.0.0', draft: false, prerelease: true },
  { tag_name: 'v1.0.0', draft: true, prerelease: false },
  { tag_name: 'dev', draft: false, prerelease: false },
  { unexpected: true },
])('rejects invalid or non-stable GitHub responses: %j', async (body) => {
  const handle = createReleasesHandler(
    vi.fn<typeof fetch>().mockImplementation(async () => Response.json(body)),
  )
  const result = await (await handle(request())).json()
  expect(result.api.status).toBe('unavailable')
  expect(result.board.status).toBe('unavailable')
})

it('handles network errors and invalid JSON independently per repository', async () => {
  const fetchRelease = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(new Response('not JSON'))
  const result = await (
    await createReleasesHandler(fetchRelease)(request())
  ).json()
  expect(result).toEqual({
    api: { status: 'unavailable' },
    board: { status: 'unavailable' },
  })
})

it('exposes a GET-only Vercel handler', async () => {
  const response = await vercelHandler.fetch(
    new Request('https://board.example/api/releases', { method: 'POST' }),
  )
  expect(response.status).toBe(405)
  expect(response.headers.get('Allow')).toBe('GET')
})
