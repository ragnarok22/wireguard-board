import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import ipaddr from 'ipaddr.js'
import { ProxyError } from './proxy-error.ts'

export type ResolvedAddress = { address: string; family: number }
export type ResolveHost = (hostname: string) => Promise<ResolvedAddress[]>
export const resolveHost: ResolveHost = (hostname) =>
  lookup(hostname, { all: true, verbatim: true })

export function isPublicAddress(value: string): boolean {
  if (!isIP(value)) return false
  const address = ipaddr.parse(value)
  if (address.range() !== 'unicast') return false
  // Only native global IPv6, excluding mapped, translation and transition ranges.
  return (
    address.kind() === 'ipv4' || address.match(ipaddr.parseCIDR('2000::/3'))
  )
}

export function parseTarget(value: string | null): URL {
  if (!value || value.length > 2048 || /[\\\s]/.test(value))
    throw new ProxyError(
      400,
      'proxy_invalid_target',
      'Enter a complete HTTP or HTTPS API URL.',
    )
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ProxyError(
      400,
      'proxy_invalid_target',
      'Enter a complete HTTP or HTTPS API URL.',
    )
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    /%/.test(url.pathname)
  ) {
    throw new ProxyError(
      400,
      'proxy_invalid_target',
      'The API URL must use HTTP or HTTPS without credentials, query parameters or encoded path segments.',
    )
  }
  url.pathname = url.pathname.replace(/\/+$/, '')
  return url
}

export async function resolvePublicTarget(
  url: URL,
  resolver: ResolveHost = resolveHost,
): Promise<ResolvedAddress> {
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const family = isIP(hostname)
  const addresses = family
    ? [{ address: hostname, family }]
    : await resolver(hostname)
  if (
    !addresses.length ||
    addresses.some(
      (item) =>
        !isPublicAddress(item.address) || isIP(item.address) !== item.family,
    )
  ) {
    throw new ProxyError(
      400,
      'proxy_private_target',
      'The proxy only connects to public IP addresses. Private, loopback and reserved destinations are not supported.',
    )
  }
  return addresses[0]
}
