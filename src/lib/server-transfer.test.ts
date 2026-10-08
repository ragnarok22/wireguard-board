import { describe, expect, it, vi } from 'vitest'
import {
  exportServers,
  maxServerImportBytes,
  mergeServers,
  parseServerImport,
} from './server-transfer'
import { server } from '@/test/api-fixtures'

describe('metadata-only server transfer', () => {
  it('exports only metadata and round-trips URLs without credentials or sessions', () => {
    const exportFile = exportServers([
      { ...server, private_key: 'private-value' } as typeof server,
    ])
    expect(JSON.parse(exportFile)).toEqual({
      version: 1,
      servers: [{ id: server.id, name: server.name, url: server.url }],
    })
    for (const secret of [server.token!, server.session, 'private-value'])
      expect(exportFile).not.toContain(secret)
    expect(parseServerImport(exportFile)).toEqual([
      { id: server.id, name: server.name, url: server.url },
    ])
  })
  it('normalizes and deduplicates imported URLs', () => {
    const text = JSON.stringify({
      version: 1,
      servers: [
        { id: 'one', name: 'First', url: 'https://VPN.example.com/api/' },
        { id: 'two', name: 'Second', url: 'https://vpn.example.com/api' },
      ],
    })
    expect(parseServerImport(text)).toEqual([
      { id: 'one', name: 'First', url: 'https://vpn.example.com/api' },
    ])
  })
  it.each([
    'not-json',
    JSON.stringify({ version: 2, servers: [] }),
    JSON.stringify({ version: 1, servers: [{ ...server }] }),
    JSON.stringify({
      version: 1,
      servers: [
        {
          id: 'one',
          name: 'Server',
          url: 'https://user:secret@vpn.example.com',
        },
      ],
    }),
    JSON.stringify({
      version: 1,
      servers: [{ id: 'one', name: 'Server', url: 'javascript:alert(1)' }],
    }),
    JSON.stringify({
      version: 1,
      servers: Array.from({ length: 251 }, (_, index) => ({
        id: String(index),
        name: 'Server',
        url: 'https://vpn.example.com',
      })),
    }),
  ])('rejects unsupported, secret-bearing or malformed input', (text) => {
    expect(() => parseServerImport(text)).toThrow('version 1 server export')
  })
  it('bounds UTF-8 input size before parsing', () => {
    expect(() =>
      parseServerImport('é'.repeat(maxServerImportBytes / 2 + 1)),
    ).toThrow('1 MiB')
  })
  it('merges by normalized URL without changing active connections and regenerates imported identities', () => {
    const uuid = vi
      .fn()
      .mockReturnValueOnce(server.id)
      .mockReturnValueOnce('new-id')
      .mockReturnValueOnce('new-session')
    const imported = [
      { id: server.id, name: 'Overwrite attempt', url: `${server.url}/` },
      { id: server.id, name: 'Berlin', url: 'https://berlin.example.com' },
    ]
    const result = mergeServers([server], imported, uuid)
    expect(result.added).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.servers[0]).toBe(server)
    expect(result.servers[1]).toEqual({
      id: 'new-id',
      name: 'Berlin',
      url: 'https://berlin.example.com',
      session: 'new-session',
    })
    expect(result.servers[1].token).toBeUndefined()
  })
})
