import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { checkServerIdentity } from 'node:tls'
import type { ResolvedAddress } from './public-target.ts'
import { ProxyError } from './proxy-error.ts'

export const maxResponseBytes = 2 * 1024 * 1024
export type UpstreamInput = {
  url: URL
  address: ResolvedAddress
  method: string
  headers: Record<string, string>
  body?: Uint8Array
  signal: AbortSignal
}
export type UpstreamResponse = {
  status: number
  headers: Headers
  body: Uint8Array
}
export type SendUpstream = (input: UpstreamInput) => Promise<UpstreamResponse>

export const sendUpstream: SendUpstream = ({
  url,
  address,
  method,
  headers,
  body,
  signal,
}) =>
  new Promise((resolve, reject) => {
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest
    // Connect to the validated IP directly: there is no second DNS resolution.
    // Retain the original Host, TLS SNI and certificate identity checks.
    const request = transport(
      url,
      {
        hostname: address.address,
        family: address.family,
        method,
        agent: false,
        signal,
        headers: {
          ...headers,
          Host: url.host,
          ...(body ? { 'Content-Length': String(body.byteLength) } : {}),
        },
        servername: isIP(hostname) ? undefined : hostname,
        checkServerIdentity: (_name, certificate) =>
          checkServerIdentity(hostname, certificate),
      },
      (response) => {
        response.on('error', reject)
        const status = response.statusCode ?? 502
        if (status >= 300 && status < 400) {
          const error = new ProxyError(
            502,
            'proxy_redirect_rejected',
            'The API redirected the request. Enter its final URL instead.',
          )
          response.destroy(error)
          reject(error)
          return
        }
        const chunks: Buffer[] = []
        let size = 0
        response.on('data', (chunk: Buffer) => {
          size += chunk.byteLength
          if (size > maxResponseBytes) {
            response.destroy(
              new ProxyError(
                502,
                'proxy_response_too_large',
                'The API response exceeded the proxy’s 2 MiB limit.',
              ),
            )
          } else chunks.push(chunk)
        })
        response.on('end', () => {
          const resultHeaders = new Headers()
          for (const name of ['content-type', 'retry-after', 'location']) {
            const value = response.headers[name]
            if (typeof value === 'string') resultHeaders.set(name, value)
          }
          resolve({
            status,
            headers: resultHeaders,
            body: Buffer.concat(chunks),
          })
        })
      },
    )
    request.on('error', reject)
    request.end(body)
  })
