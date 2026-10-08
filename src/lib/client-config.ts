import type { CreatedPeer } from './api-types'

export function buildClientConfig(peer: CreatedPeer, partial: string): string {
  if (!peer.private_key)
    throw new Error(
      'This peer uses your own key. Add its private key on the client.',
    )
  if (!/^\[Peer\]\s*$/m.test(partial) || /^\[Interface\]/m.test(partial))
    throw new Error('The API returned an invalid partial configuration.')
  return `[Interface]\nPrivateKey = ${peer.private_key}\nAddress = ${peer.allowed_ips[0]}\nDNS = 1.1.1.1\n\n${partial.trim()}\n`
}

export function configFilename(name: string): string {
  return `${
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64) || 'wireguard-client'
  }.conf`
}

export function downloadText(text: string, filename: string): void {
  const url = URL.createObjectURL(
    new Blob([text], { type: 'text/plain;charset=utf-8' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
