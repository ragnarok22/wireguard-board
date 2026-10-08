import { checkRateLimit } from '@vercel/firewall'
import { ProxyError, proxyErrorResponse } from './proxy-error.ts'

export const rateLimitId = 'wireguard-proxy'
export const rateLimitWindowSeconds = 60

type RateCheck = (
  id: string,
  options: { headers: Headers; timeout: number },
) => Promise<{ rateLimited: boolean; error?: string }>

export async function limitProxyRequest(
  request: Request,
  options: { enabled?: boolean; check?: RateCheck } = {},
): Promise<Response | null> {
  if (!(options.enabled ?? process.env.VERCEL === '1')) return null
  try {
    // The SDK only receives routing/client-IP headers supplied by Vercel, never
    // the destination, API token, cookies or idempotency key.
    const headers = new Headers({ host: new URL(request.url).host })
    const ip = request.headers.get('x-real-ip')
    if (!ip || (!options.check && process.env.NODE_ENV !== 'production'))
      throw new Error('Unavailable platform context')
    headers.set('x-real-ip', ip)
    const result = await (options.check ?? checkRateLimit)(rateLimitId, {
      headers,
      timeout: 1000,
    })
    if (result.error === 'not-found') throw new Error('Missing rate limit rule')
    if (!result.rateLimited && result.error)
      throw new Error('Rate limit unavailable')
    if (!result.rateLimited) return null
    const response = proxyErrorResponse(
      new ProxyError(
        429,
        'proxy_rate_limited',
        'Too many proxy requests. Wait one minute before trying again.',
      ),
    )
    response.headers.set('Retry-After', String(rateLimitWindowSeconds))
    return response
  } catch {
    const response = proxyErrorResponse(
      new ProxyError(
        503,
        'proxy_rate_limit_unavailable',
        'Proxy rate limiting is unavailable. Check that the wireguard-proxy Vercel Firewall rule is published.',
      ),
    )
    response.headers.set('Retry-After', '5')
    return response
  }
}
