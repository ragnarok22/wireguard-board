import { describe, expect, it, vi } from 'vitest'
import {
  buildClientConfig,
  configFilename,
  downloadText,
} from './client-config'
import { loadServers, saveServers, storageKey } from './server-storage'
import { normalizeApiUrl } from './api-types'
import {
  handshakeLabel,
  isRecentlyActive,
  formatBytes,
  uptimeLabel,
} from './formatters'
import {
  partialConfig,
  privateKey,
  publicKey,
  server,
} from '@/test/api-fixtures'

describe('client configurations', () => {
  it('combines the one-time private key with the server’s real Peer block', () => {
    const config = buildClientConfig(
      {
        public_key: publicKey,
        private_key: privateKey,
        allowed_ips: ['10.13.13.2/32'],
      },
      partialConfig,
    )
    expect(config).toContain(
      `[Interface]\nPrivateKey = ${privateKey}\nAddress = 10.13.13.2/32\nDNS = 1.1.1.1`,
    )
    expect(config).toContain(partialConfig)
    expect(config.match(/\[Peer\]/g)).toHaveLength(1)
  })
  it('rejects custom-key peers and malformed partial configurations', () => {
    expect(() =>
      buildClientConfig(
        { public_key: publicKey, allowed_ips: ['10.13.13.2/32'] },
        partialConfig,
      ),
    ).toThrow('own key')
    expect(() =>
      buildClientConfig(
        {
          public_key: publicKey,
          private_key: privateKey,
          allowed_ips: ['10.13.13.2/32'],
        },
        '[Interface]\nPrivateKey=unexpected',
      ),
    ).toThrow('invalid partial')
  })
  it('creates safe kebab-case filenames', () => {
    expect(configFilename('../../Work Laptop.conf')).toBe(
      'work-laptop-conf.conf',
    )
    expect(configFilename('⚡')).toBe('wireguard-client.conf')
  })
  it('downloads through a temporary local object URL', async () => {
    vi.useFakeTimers()
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:config')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {})
    downloadText('private config', 'work-laptop.conf')
    expect(click).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1000)
    expect(revoke).toHaveBeenCalledWith('blob:config')
    vi.useRealTimers()
  })
})

describe('server persistence', () => {
  it('only saves metadata, never API tokens or session identifiers', () => {
    saveServers([server])
    const raw = localStorage.getItem(storageKey)!
    expect(raw).not.toContain(server.token)
    expect(raw).not.toContain(server.session)
    expect(loadServers().servers).toEqual([
      { id: server.id, name: server.name, url: server.url },
    ])
  })
  it('recovers gracefully from corrupt, outdated or duplicate data', () => {
    for (const raw of [
      'not json',
      '{"version":2,"servers":[]}',
      JSON.stringify({ version: 1, servers: [server, server] }),
    ]) {
      localStorage.setItem(storageKey, raw)
      expect(loadServers()).toMatchObject({
        servers: [],
        warning: expect.any(String),
      })
    }
  })
  it('reports unavailable browser storage', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('Quota')
    })
    expect(saveServers([server])).toContain('only last for this session')
  })
})

describe('URL and statistics', () => {
  it('normalizes API URLs while retaining reverse-proxy prefixes', () => {
    expect(normalizeApiUrl(' https://vpn.example.com/api/// ')).toBe(
      'https://vpn.example.com/api',
    )
    expect(normalizeApiUrl('http://localhost:8008')).toBe(
      'http://localhost:8008',
    )
  })
  it.each([
    'vpn.example.com',
    'ftp://vpn.example.com',
    'https://user:pass@vpn.example.com',
    'https://vpn.example.com?token=key',
    'https://vpn.example.com#docs',
  ])('rejects unsuitable URL %s', (value) => {
    expect(() => normalizeApiUrl(value)).toThrow()
  })
  it('formats bytes and uptime with explicit units', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1024)).toBe('1 KiB')
    expect(formatBytes(1048576 * 1.5)).toBe('1.5 MiB')
    expect(uptimeLabel(12)).toBe('Less than a minute')
    expect(uptimeLabel(600)).toBe('10 minutes')
    expect(uptimeLabel(3600)).toBe('1 hour')
    expect(uptimeLabel(86400 * 2)).toBe('2 days')
  })
  it('uses handshake activity rather than pretending there is a connection state', () => {
    const now = 1_800_000_000_000
    expect(handshakeLabel(null, now)).toBe('Never')
    expect(handshakeLabel(now / 1000 - 20, now)).toBe('Just now')
    expect(handshakeLabel(now / 1000 - 300, now)).toBe('5m ago')
    expect(handshakeLabel(now / 1000 - 7200, now)).toBe('2h ago')
    expect(handshakeLabel(now / 1000 - 86400 * 2, now)).toBe('2d ago')
    expect(isRecentlyActive(now / 1000 - 179, now)).toBe(true)
    expect(isRecentlyActive(now / 1000 - 180, now)).toBe(false)
    expect(isRecentlyActive(now / 1000 + 10, now)).toBe(false)
    expect(isRecentlyActive(null, now)).toBe(false)
  })
})
