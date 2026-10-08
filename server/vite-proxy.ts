import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { handleProxy } from './proxy-handler.ts'
import { ProxyError, proxyErrorResponse } from './proxy-error.ts'

export async function serveProxy(
  request: IncomingMessage,
  response: ServerResponse,
  handler = handleProxy,
): Promise<void> {
  const controller = new AbortController()
  const abort = () => {
    if (!response.writableEnded) controller.abort()
  }
  response.once('close', abort)
  try {
    const headers = new Headers()
    for (const [name, value] of Object.entries(request.headers)) {
      if (typeof value === 'string') headers.set(name, value)
    }
    const method = request.method ?? 'GET'
    const init: RequestInit & { duplex?: 'half' } = {
      method,
      headers,
      signal: controller.signal,
    }
    if (!['GET', 'HEAD'].includes(method)) {
      init.body = Readable.toWeb(request) as ReadableStream<Uint8Array>
      init.duplex = 'half'
    }
    const result = await handler(
      new Request(`http://localhost${request.url}`, init),
    )
    response.writeHead(result.status, Object.fromEntries(result.headers))
    response.end(Buffer.from(await result.arrayBuffer()))
  } catch {
    if (!response.destroyed) {
      const result = proxyErrorResponse(
        new ProxyError(
          400,
          'proxy_invalid_request',
          'The proxy received an invalid request.',
        ),
      )
      response.writeHead(result.status, Object.fromEntries(result.headers))
      response.end(await result.text())
    }
  } finally {
    response.off('close', abort)
  }
}

export function wireguardProxy(): Plugin {
  const configure = (server: {
    middlewares: {
      use: (
        middleware: (
          request: IncomingMessage,
          response: ServerResponse,
          next: () => void,
        ) => void,
      ) => void
    }
  }) => {
    server.middlewares.use((request, response, next) => {
      if (request.url?.split('?')[0] !== '/api/wireguard') {
        next()
        return
      }
      void serveProxy(request, response)
    })
  }
  return {
    name: 'wireguard-proxy',
    configureServer: configure,
    configurePreviewServer: configure,
  }
}
