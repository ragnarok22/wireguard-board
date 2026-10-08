import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { loadServers, saveServers } from '@/lib/server-storage'
import type { ServerConnection } from '@/lib/api-types'
import type { ServerMetadata } from '@/lib/api-types'
import { mergeServers } from '@/lib/server-transfer'

export function useServerRegistry() {
  const queryClient = useQueryClient()
  const [initial] = useState(loadServers)
  const [servers, setServers] = useState<ServerConnection[]>(() =>
    initial.servers.map((server) => ({
      ...server,
      session: crypto.randomUUID(),
    })),
  )
  const [selectedId, setSelectedId] = useState<string | undefined>(
    () => initial.servers[0]?.id,
  )
  const [warning, setWarning] = useState(initial.warning)

  function persist(next: ServerConnection[]) {
    setServers(next)
    setWarning(saveServers(next))
  }

  function save(server: ServerConnection) {
    const previous = servers.find((item) => item.id === server.id)
    if (previous)
      queryClient.removeQueries({ queryKey: ['server', previous.id] })
    persist(
      previous
        ? servers.map((item) => (item.id === server.id ? server : item))
        : [...servers, server],
    )
    setSelectedId(server.id)
  }

  function remove(id: string) {
    const next = servers.filter((server) => server.id !== id)
    queryClient.removeQueries({ queryKey: ['server', id] })
    persist(next)
    if (selectedId === id) setSelectedId(next[0]?.id)
  }

  function lock(id: string) {
    queryClient.removeQueries({ queryKey: ['server', id] })
    setServers((current) =>
      current.map((server) =>
        server.id === id
          ? { ...server, token: undefined, session: crypto.randomUUID() }
          : server,
      ),
    )
  }

  function importServers(metadata: ServerMetadata[]) {
    const merged = mergeServers(servers, metadata)
    persist(merged.servers)
    if (!selectedId) setSelectedId(merged.servers[0]?.id)
    return { added: merged.added, skipped: merged.skipped }
  }

  return {
    servers,
    selected: servers.find((server) => server.id === selectedId),
    selectedId,
    select: setSelectedId,
    save,
    remove,
    lock,
    warning,
    importServers,
  }
}
