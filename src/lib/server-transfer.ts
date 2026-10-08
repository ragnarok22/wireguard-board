import { z } from 'zod'
import {
  normalizeApiUrl,
  serverMetadataSchema,
  type ServerConnection,
  type ServerMetadata,
} from './api-types'

export const maxServerImportBytes = 1024 * 1024
const transferSchema = z.strictObject({
  version: z.literal(1),
  servers: z
    .array(
      z.strictObject({
        ...serverMetadataSchema.shape,
        id: z.string().min(1).max(128),
        url: z.url().max(2048),
      }),
    )
    .max(250),
})

export function exportServers(servers: ServerMetadata[]): string {
  const metadata = servers.map(({ id, name, url }) => ({
    id,
    name,
    url: normalizeApiUrl(url),
  }))
  return (
    JSON.stringify(
      transferSchema.parse({ version: 1, servers: metadata }),
      null,
      2,
    ) + '\n'
  )
}

export function parseServerImport(text: string): ServerMetadata[] {
  if (new TextEncoder().encode(text).byteLength > maxServerImportBytes)
    throw new Error('The server file must be no larger than 1 MiB.')
  try {
    const parsed = transferSchema.parse(JSON.parse(text))
    const unique = new Map<string, ServerMetadata>()
    for (const server of parsed.servers) {
      const url = normalizeApiUrl(server.url)
      if (!unique.has(url)) unique.set(url, { ...server, url })
    }
    return [...unique.values()]
  } catch {
    throw new Error(
      'Use a version 1 server export containing only id, name and URL, with at most 250 entries. Tokens and other fields are not accepted.',
    )
  }
}

export function mergeServers(
  existing: ServerConnection[],
  imported: ServerMetadata[],
  uuid = () => crypto.randomUUID(),
): { servers: ServerConnection[]; added: number; skipped: number } {
  const urls = new Set(existing.map((server) => normalizeApiUrl(server.url)))
  const ids = new Set(existing.map((server) => server.id))
  const next = [...existing]
  for (const metadata of imported) {
    const url = normalizeApiUrl(metadata.url)
    if (urls.has(url)) continue
    let id = uuid()
    while (ids.has(id)) id = uuid()
    ids.add(id)
    urls.add(url)
    next.push({ id, name: metadata.name, url, session: uuid() })
  }
  const added = next.length - existing.length
  return { servers: next, added, skipped: imported.length - added }
}
