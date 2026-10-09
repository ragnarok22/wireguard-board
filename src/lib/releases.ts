import { useQuery } from '@tanstack/react-query'
import { releasesSchema, releaseCheckInterval } from '../../shared/releases'

export async function fetchReleases(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(12_000)
  const response = await fetch('/api/releases', {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    credentials: 'omit',
    redirect: 'error',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error('Update check unavailable.')
  return releasesSchema.parse(await response.json())
}

export function useReleases() {
  return useQuery({
    queryKey: ['releases'],
    queryFn: ({ signal }) => fetchReleases(signal),
    staleTime: releaseCheckInterval,
    gcTime: releaseCheckInterval,
    refetchInterval: releaseCheckInterval,
    retry: false,
  })
}
