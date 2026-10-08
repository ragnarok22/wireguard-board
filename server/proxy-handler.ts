import { ProxyError, proxyErrorResponse } from './proxy-error.ts'
import {
  parseTarget,
  resolvePublicTarget,
  type ResolveHost,
} from './public-target.ts'
import { validateRoute } from './proxy-route.ts'
import { sendUpstream, type SendUpstream } from './upstream-request.ts'

export const maxRequestBytes = 16 * 1024

async function readBody(
  request: Request,
  signal: AbortSignal,
): Promise<Uint8Array | undefined> {
  if (request.method !== 'POST') {
    if (request.body)
      throw new ProxyError(
        400,
        'proxy_invalid_body',
        'Only peer creation accepts a request body.',
      )
    return undefined
  }
  if (
    request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !==
    'application/json'
  )
    throw new ProxyError(
      415,
      'proxy_invalid_body',
      'Peer creation requires a JSON request body.',
    )
  const reader = request.body?.getReader()
  if (!reader)
    throw new ProxyError(
      400,
      'proxy_invalid_body',
      'Peer creation requires a JSON request body.',
    )
  const chunks: Uint8Array[] = []
  const cancel = () => {
    void reader.cancel(signal.reason).catch(() => {})
  }
  signal.addEventListener('abort', cancel, { once: true })
  if (signal.aborted) cancel()
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > maxRequestBytes) {
        void reader.cancel().catch(() => {})
        throw new ProxyError(
          413,
          'proxy_request_too_large',
          'The request exceeded the proxy’s 16 KiB limit.',
        )
      }
      chunks.push(chunk.value)
    }
  } finally {
    signal.removeEventListener('abort', cancel)
    reader.releaseLock()
  }
  const body = Buffer.concat(chunks)
  try {
    const value: unknown = JSON.parse(body.toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Invalid object')
  } catch {
    throw new ProxyError(
      400,
      'proxy_invalid_body',
      'Peer creation requires a valid JSON object.',
    )
  }
  return body
}

export async function withSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort))
  })
}

export async function handleProxy(
  request: Request,
  dependencies: {
    resolve?: ResolveHost
    send?: SendUpstream
    timeoutMs?: number
  } = {},
): Promise<Response> {
  const timeout = AbortSignal.timeout(dependencies.timeoutMs ?? 10_000)
  const signal = AbortSignal.any([request.signal, timeout])
  try {
    const parameters = new URL(request.url).searchParams
    if (
      parameters.getAll('path').length !== 1 ||
      [...parameters.keys()].some((name) => name !== 'path')
    )
      throw new ProxyError(
        400,
        'proxy_invalid_route',
        'Provide one supported API path.',
      )
    const route = validateRoute(parameters.get('path'), request.method)
    const target = parseTarget(request.headers.get('X-WireGuard-Server'))
    const headers: Record<string, string> = {
      Accept: route.metrics ? 'text/plain' : 'application/json',
      'Accept-Encoding': 'identity',
    }
    if (route.authenticated) {
      const token = request.headers.get('X-API-Token')
      if (!token || token.length > 4096)
        throw new ProxyError(
          401,
          'proxy_token_required',
          'Enter this server’s API token.',
        )
      headers['X-API-Token'] = token
    }
    if (request.method === 'POST') {
      const key = request.headers.get('Idempotency-Key')
      if (!key || key.length > 200)
        throw new ProxyError(
          400,
          'proxy_idempotency_required',
          'Peer creation requires an Idempotency-Key.',
        )
      headers['Idempotency-Key'] = key
      headers['Content-Type'] = 'application/json'
    }
    const body = await withSignal(readBody(request, signal), signal)
    const address = await withSignal(
      resolvePublicTarget(target, dependencies.resolve),
      signal,
    )
    const prefix = target.pathname.replace(/\/+$/, '')
    const upstreamUrl = new URL(`${target.origin}${prefix}${route.path}`)
    const response = await withSignal(
      (dependencies.send ?? sendUpstream)({
        url: upstreamUrl,
        address,
        method: request.method,
        headers,
        body,
        signal,
      }),
      signal,
    )
    if (response.status >= 300 && response.status < 400)
      throw new ProxyError(
        502,
        'proxy_redirect_rejected',
        'The API redirected the request. Enter its final URL instead.',
      )
    const outputHeaders = new Headers({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    const contentType = response.headers.get('content-type')
    outputHeaders.set(
      'Content-Type',
      route.metrics
        ? 'text/plain; charset=utf-8'
        : contentType?.startsWith('application/json')
          ? contentType
          : 'application/json; charset=utf-8',
    )
    for (const name of ['Retry-After', 'Location']) {
      const value = response.headers.get(name)
      if (value) outputHeaders.set(name, value)
    }
    return new Response(
      [204, 205].includes(response.status) ? null : Buffer.from(response.body),
      { status: response.status, headers: outputHeaders },
    )
  } catch (error) {
    if (error instanceof ProxyError) return proxyErrorResponse(error)
    if (request.signal.aborted)
      return proxyErrorResponse(
        new ProxyError(499, 'proxy_cancelled', 'The request was cancelled.'),
      )
    if (timeout.aborted)
      return proxyErrorResponse(
        new ProxyError(
          504,
          'proxy_timeout',
          'The API did not respond within the proxy timeout.',
        ),
      )
    return proxyErrorResponse(
      new ProxyError(
        502,
        'proxy_unreachable',
        'The proxy could not reach the API. Check its public address, port, firewall and HTTPS certificate.',
      ),
    )
  }
}
