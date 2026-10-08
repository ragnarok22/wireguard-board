import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { api, serverQueryKey } from '@/lib/api-client'
import type { OperationResponse, ServerConnection } from '@/lib/api-types'

export function refreshInventory(
  client: QueryClient,
  server: ServerConnection,
) {
  for (const name of ['peers', 'server-info', 'readiness'])
    void client.invalidateQueries({
      queryKey: [...serverQueryKey(server), name],
    })
}

export function trackOperation(
  client: QueryClient,
  server: ServerConnection,
  result: OperationResponse,
) {
  const key = [...serverQueryKey(server), 'tracked-operations']
  client.setQueryData<OperationResponse[]>(key, (current = []) => [
    ...current.filter((item) => item.operation.id !== result.operation.id),
    result,
  ])
  refreshInventory(client, server)
}

export function useTrackedOperations(server: ServerConnection) {
  return useQuery({
    queryKey: [...serverQueryKey(server), 'tracked-operations'],
    queryFn: (): OperationResponse[] => [],
    enabled: false,
    initialData: [],
    gcTime: Infinity,
  }).data
}

export function useOperation(
  server: ServerConnection,
  initial?: OperationResponse,
) {
  const client = useQueryClient()
  return useQuery({
    queryKey: [...serverQueryKey(server), 'operation', initial?.operation.id],
    queryFn: async ({ signal }) => {
      const result = await api.operation(server, initial!.operation.id, signal)
      if (result.operation.status !== 'pending')
        refreshInventory(client, server)
      return result
    },
    initialData: initial,
    staleTime: initial?.retryAfterMs ?? 5000,
    enabled: (query) =>
      !!initial &&
      (query.state.data?.operation.status ?? initial.operation.status) ===
        'pending',
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchInterval: (query) =>
      query.state.data?.operation.status === 'pending'
        ? query.state.data.retryAfterMs
        : false,
    retry: false,
  })
}
