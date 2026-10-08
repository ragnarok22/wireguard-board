import {
  QueryClient,
  QueryClientProvider,
  focusManager,
} from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { operation, server, jsonResponse } from '@/test/api-fixtures'
import { serverQueryKey } from '@/lib/api-client'
import {
  trackOperation,
  useOperation,
  useTrackedOperations,
} from './use-operations'
import type { OperationResponse } from '@/lib/api-types'

const pending: OperationResponse = {
  operation: { ...operation, status: 'pending' },
  retryAfterMs: 7000,
}

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

afterEach(() => {
  vi.useRealTimers()
  focusManager.setFocused(undefined)
})

describe('durable operation tracking', () => {
  it('honors Retry-After, polls at the new interval and stops after completion', async () => {
    vi.useFakeTimers()
    focusManager.setFocused(true)
    const mock = vi
      .fn()
      .mockImplementationOnce(() =>
        Promise.resolve(
          jsonResponse(pending.operation, 200, { 'Retry-After': '2' }),
        ),
      )
      .mockImplementationOnce(() => Promise.resolve(jsonResponse(operation)))
    vi.stubGlobal('fetch', mock)
    const { client, wrapper } = setup()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result, unmount } = renderHook(
      () => useOperation(server, pending),
      { wrapper },
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6999)
    })
    expect(mock).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(mock).toHaveBeenCalledOnce()
    expect(invalidate).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2001)
    })
    expect(result.current.data?.operation.status).toBe('complete')
    expect(invalidate.mock.calls.map(([options]) => options?.queryKey)).toEqual(
      ['peers', 'server-info', 'readiness'].map((name) => [
        ...serverQueryKey(server),
        name,
      ]),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000)
    })
    expect(mock).toHaveBeenCalledTimes(2)
    unmount()
    client.clear()
  })

  it('retains pending state across polling failures and treats cancellation as terminal', async () => {
    vi.useFakeTimers()
    focusManager.setFocused(true)
    const mock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Network unavailable'))
      .mockResolvedValueOnce(
        jsonResponse({ ...operation, status: 'cancelled' }),
      )
    vi.stubGlobal('fetch', mock)
    const { client, wrapper } = setup()
    const { result, unmount } = renderHook(
      () => useOperation(server, pending),
      { wrapper },
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7001)
    })
    expect(result.current.data?.operation.status).toBe('pending')
    expect(result.current.error?.message).toContain('CORS')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7001)
    })
    expect(result.current.data?.operation.status).toBe('cancelled')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000)
    })
    expect(mock).toHaveBeenCalledTimes(2)
    unmount()
    client.clear()
  })

  it('keeps progress across unmounting and resumes when returning to the server', async () => {
    vi.useFakeTimers()
    focusManager.setFocused(true)
    const mock = vi.fn().mockResolvedValue(jsonResponse(operation))
    vi.stubGlobal('fetch', mock)
    const { client, wrapper } = setup()
    const first = renderHook(() => useOperation(server, pending), { wrapper })
    first.unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000)
    })
    expect(mock).not.toHaveBeenCalled()
    const second = renderHook(() => useOperation(server, pending), { wrapper })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7001)
    })
    expect(second.result.current.data?.operation.status).toBe('complete')
    second.unmount()
    client.clear()
  })

  it('deduplicates tracked operations, isolates sessions and clears tracking with server caches', async () => {
    const { client, wrapper } = setup()
    const mock = vi.fn()
    vi.stubGlobal('fetch', mock)
    trackOperation(client, server, pending)
    trackOperation(client, server, pending)
    const { result, rerender, unmount } = renderHook(
      ({ selected }) => useTrackedOperations(selected),
      { wrapper, initialProps: { selected: server } },
    )
    expect(result.current).toEqual([pending])
    rerender({ selected: { ...server, session: 'another-session' } })
    expect(result.current).toEqual([])
    rerender({ selected: server })
    expect(result.current).toEqual([pending])
    unmount()
    client.removeQueries({ queryKey: ['server', server.id] })
    expect(client.getQueryCache().getAll()).toHaveLength(0)
    expect(mock).not.toHaveBeenCalled()
    client.clear()
  })
})
