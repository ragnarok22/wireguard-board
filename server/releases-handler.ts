import { z } from 'zod'
import {
  isStableVersion,
  releaseCheckInterval,
  type Release,
  type Releases,
} from '../shared/releases.ts'

const githubReleaseSchema = z.object({
  tag_name: z.string(),
  draft: z.literal(false),
  prerelease: z.literal(false),
})

async function latestRelease(
  repository: 'wireguard-api' | 'wireguard-board',
  fetchRelease: typeof fetch,
): Promise<Release> {
  try {
    const response = await fetchRelease(
      `https://api.github.com/repos/ragnarok22/${repository}/releases/latest`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'wireguard-board',
        },
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      },
    )
    if (response.status === 404) return { status: 'none' }
    if (!response.ok) return { status: 'unavailable' }
    const parsed = githubReleaseSchema.safeParse(await response.json())
    if (!parsed.success || !isStableVersion(parsed.data.tag_name))
      return { status: 'unavailable' }
    return {
      status: 'available',
      version: parsed.data.tag_name.replace(/^v/, ''),
      url: `https://github.com/ragnarok22/${repository}/releases/tag/${encodeURIComponent(parsed.data.tag_name)}`,
    }
  } catch {
    return { status: 'unavailable' }
  }
}

/** A single bounded cache and in-flight request shared by all callers in this instance. */
export function createReleasesHandler(fetchRelease: typeof fetch = fetch) {
  let cached: { data: Releases; expires: number } | undefined
  let pending: Promise<Releases> | undefined
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET')
      return Response.json(
        { detail: 'Only GET is supported.' },
        { status: 405, headers: { Allow: 'GET', 'Cache-Control': 'no-store' } },
      )
    if (!cached || cached.expires <= Date.now()) {
      pending ??= Promise.all([
        latestRelease('wireguard-api', fetchRelease),
        latestRelease('wireguard-board', fetchRelease),
      ]).then(([api, board]) => {
        const data = { api, board }
        const ttl = [api, board].some((item) => item.status === 'unavailable')
          ? 5 * 60 * 1000
          : releaseCheckInterval
        cached = { data, expires: Date.now() + ttl }
        pending = undefined
        return data
      })
      await pending
    }
    const maxAge = Math.max(
      0,
      Math.floor((cached!.expires - Date.now()) / 1000),
    )
    return Response.json(cached!.data, {
      headers: {
        'Cache-Control': `public, max-age=0, s-maxage=${maxAge}`,
        'X-Content-Type-Options': 'nosniff',
      },
    })
  }
}

// Resolve fetch at request time, allowing the local adapter and tests to use the same handler.
export const handleReleases = createReleasesHandler((input, init) =>
  fetch(input, init),
)
