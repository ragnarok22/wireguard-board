import { z } from 'zod'
import {
  normalizeApiUrl,
  serverMetadataSchema,
  type ServerMetadata,
} from './api-types'

export const storageKey = 'wireguard-board:servers:v1'
const registrySchema = z.object({
  version: z.literal(1),
  servers: z.array(serverMetadataSchema),
})

export function loadServers(): { servers: ServerMetadata[]; warning?: string } {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return { servers: [] }
    const stored = registrySchema.parse(JSON.parse(raw))
    const ids = new Set<string>()
    const servers = stored.servers.map((server) => {
      if (ids.has(server.id)) throw new Error('Duplicate server')
      ids.add(server.id)
      return { ...server, url: normalizeApiUrl(server.url) }
    })
    return { servers }
  } catch {
    return {
      servers: [],
      warning:
        'Saved servers could not be loaded. You can add a connection again.',
    }
  }
}

export function saveServers(servers: ServerMetadata[]): string | undefined {
  try {
    // Explicitly select metadata: tokens and session credentials never enter storage.
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 1,
        servers: servers.map(({ id, name, url }) => ({ id, name, url })),
      }),
    )
    return undefined
  } catch {
    return 'Browser storage is unavailable. Connections will only last for this session.'
  }
}
