import { ProxyError } from './proxy-error.ts'

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const peer = new RegExp(`^/v1/peers/${uuid}$`, 'i')
const template = new RegExp(`^/v1/peers/${uuid}/config-template$`, 'i')
const operation = new RegExp(`^/v1/operations/${uuid}$`, 'i')
const uuidValue = new RegExp(`^${uuid}$`, 'i')

export function validateRoute(
  path: string | null,
  method: string,
): { path: string; authenticated: boolean; metrics: boolean } {
  if (!['GET', 'POST', 'DELETE'].includes(method))
    throw new ProxyError(
      405,
      'proxy_method_not_allowed',
      'The proxy supports GET, POST and DELETE requests only.',
    )
  const invalid = () =>
    new ProxyError(
      400,
      'proxy_invalid_route',
      'This route or its query parameters are not supported by the WireGuard proxy.',
    )
  if (
    !path ||
    path.length > 2048 ||
    !path.startsWith('/') ||
    /[%\\#\s]/.test(path)
  )
    throw invalid()
  const [pathname, query = '', ...extra] = path.split('?')
  if (extra.length) throw invalid()
  const params = new URLSearchParams(query)
  const names = [...params.keys()]
  if (new Set(names).size !== names.length) throw invalid()
  const publicRead = ['/livez', '/readyz', '/metrics'].includes(pathname)
  const fixedRead =
    publicRead || ['/v1/server', '/v1/system', '/v1/stats'].includes(pathname)
  const allowed =
    method === 'GET'
      ? fixedRead ||
        pathname === '/v1/peers' ||
        peer.test(pathname) ||
        template.test(pathname) ||
        operation.test(pathname)
      : method === 'POST'
        ? pathname === '/v1/peers'
        : peer.test(pathname)
  if (!allowed) throw invalid()
  for (const [name, value] of params) {
    const valid =
      method === 'GET' &&
      ((pathname === '/v1/peers' &&
        name === 'limit' &&
        /^\d+$/.test(value) &&
        Number(value) >= 1 &&
        Number(value) <= 100) ||
        (pathname === '/v1/peers' &&
          name === 'after' &&
          uuidValue.test(value)) ||
        (pathname === '/v1/stats' &&
          name === 'handshake_window_seconds' &&
          /^\d+$/.test(value) &&
          Number(value) >= 1 &&
          Number(value) <= 3600))
    if (!valid) throw invalid()
  }
  return { path, authenticated: !publicRead, metrics: pathname === '/metrics' }
}
