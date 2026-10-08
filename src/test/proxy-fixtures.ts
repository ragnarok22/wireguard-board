export const proxyUrl = (path: string) =>
  `/api/wireguard?path=${encodeURIComponent(path)}`

export function proxyPath(input: string | URL | Request): string {
  const url = new URL(String(input), 'http://localhost')
  if (url.pathname !== '/api/wireguard')
    throw new Error('Expected a same-origin proxy request')
  return url.searchParams.get('path')!
}

export function proxyTargetUrl(
  input: string | URL | Request,
  options?: RequestInit,
): URL {
  return new URL(
    `${new Headers(options?.headers).get('X-WireGuard-Server')}${proxyPath(input)}`,
  )
}
