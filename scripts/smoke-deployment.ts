import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import type { z } from 'zod'
import {
  createdPeerSchema,
  livenessSchema,
  normalizeApiUrl,
  operationSchema,
  peerSchema,
  peersSchema,
  readinessSchema,
  serverInfoSchema,
} from '../src/lib/api-types.ts'
import { securityHeaders } from '../server/security-headers.ts'

export type SmokeConfig = {
  boardUrl: string
  apiUrl: string
  apiToken: string
  bypassSecret?: string
}
type SmokeOptions = {
  fetch?: typeof fetch
  wait?: (milliseconds: number) => Promise<void>
  onProgress?: (message: string) => void
  timeoutMs?: number
}

class SmokeHttpError extends Error {
  readonly status: number
  readonly retryAfterMs: number
  constructor(label: string, status: number, retryAfterMs = 1000) {
    super(
      status
        ? `${label} returned HTTP ${status}.`
        : `${label} could not be completed.`,
    )
    this.status = status
    this.retryAfterMs = retryAfterMs
  }
}

export function smokeConfig(
  environment: Record<string, string | undefined>,
): SmokeConfig {
  const required = ['SMOKE_BOARD_URL', 'SMOKE_API_URL', 'SMOKE_API_TOKEN']
  const missing = required.filter((name) => !environment[name]?.trim())
  if (missing.length)
    throw new Error(
      `Configure ${missing.join(', ')} before running the deployed smoke test.`,
    )
  const boardUrl = normalizeApiUrl(environment.SMOKE_BOARD_URL!)
  const board = new URL(boardUrl)
  if (
    (board.protocol !== 'https:' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(board.hostname)) ||
    board.pathname !== '/'
  )
    throw new Error(
      'Use an HTTPS board origin, or localhost for a local preview test.',
    )
  const apiToken = environment.SMOKE_API_TOKEN!.trim()
  if (apiToken.length > 4096 || /[^\x20-\x7e]/.test(apiToken))
    throw new Error('The smoke API token has an invalid format.')
  const bypassSecret = environment.SMOKE_BYPASS_SECRET?.trim() || undefined
  if (
    bypassSecret &&
    (bypassSecret.length > 4096 || /[^\x20-\x7e]/.test(bypassSecret))
  )
    throw new Error('The smoke bypass secret has an invalid format.')
  return {
    boardUrl,
    apiUrl: normalizeApiUrl(environment.SMOKE_API_URL!),
    apiToken,
    bypassSecret,
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value)
  if (!result.success)
    throw new Error(`${label} returned an invalid API contract.`)
  return result.data
}

function retryDelay(response: Response): number {
  const raw = response.headers.get('Retry-After')
  if (!raw) return 5000
  const milliseconds = /^\d+$/.test(raw)
    ? Number(raw) * 1000
    : Date.parse(raw) - Date.now()
  return Number.isFinite(milliseconds) ? Math.max(1000, milliseconds) : 5000
}

export async function runDeploymentSmoke(
  config: SmokeConfig,
  options: SmokeOptions = {},
): Promise<void> {
  const send = options.fetch ?? fetch
  const wait = options.wait ?? ((milliseconds) => delay(milliseconds))
  const progress = options.onProgress ?? (() => {})
  const timeoutMs = options.timeoutMs ?? 120_000
  const deadline = Date.now() + timeoutMs
  const requestKey = randomUUID()
  let cleanupId: string | undefined
  let creationAttempted = false
  let failure: unknown

  async function request(
    path: string,
    label: string,
    init: RequestInit = {},
    until = deadline,
  ): Promise<Response> {
    if (Date.now() >= until)
      throw new Error(`${label} exceeded the smoke-test deadline.`)
    const headers = new Headers(init.headers)
    headers.set('X-WireGuard-Server', config.apiUrl)
    if (path.startsWith('/v1/')) headers.set('X-API-Token', config.apiToken)
    if (config.bypassSecret)
      headers.set('x-vercel-protection-bypass', config.bypassSecret)
    if (init.body) headers.set('Content-Type', 'application/json')
    try {
      return await send(
        new URL(
          `/api/wireguard?path=${encodeURIComponent(path)}`,
          config.boardUrl,
        ),
        {
          ...init,
          headers,
          redirect: 'error',
          cache: 'no-store',
          signal: AbortSignal.timeout(
            Math.max(1, Math.min(20_000, until - Date.now())),
          ),
        },
      )
    } catch {
      throw new SmokeHttpError(label, 0)
    }
  }

  async function json(
    path: string,
    label: string,
    init: RequestInit = {},
    until = deadline,
  ): Promise<{ body: unknown; response: Response }> {
    const response = await request(path, label, init, until)
    if (!response.ok)
      throw new SmokeHttpError(label, response.status, retryDelay(response))
    try {
      return { body: await response.json(), response }
    } catch {
      throw new Error(`${label} did not return valid JSON.`)
    }
  }

  async function inventory(): Promise<Set<string>> {
    const ids = new Set<string>()
    const cursors = new Set<string>()
    let after: string | null = null
    for (let page = 0; page < 20; page++) {
      const result = await json(
        `/v1/peers?limit=100${after ? `&after=${after}` : ''}`,
        'Peer listing',
      )
      const peers = parse(peersSchema, result.body, 'Peer listing')
      peers.items.forEach((peer) => ids.add(peer.id))
      after = peers.next_cursor
      if (!after) return ids
      if (cursors.has(after))
        throw new Error('Peer listing repeated its cursor.')
      cursors.add(after)
    }
    throw new Error(
      'Use a test server with at most 2,000 peers for the smoke test.',
    )
  }

  async function poll(
    initial: z.infer<typeof operationSchema>,
    peerId: string,
    kind: 'create' | 'delete',
    response: Response,
    until: number,
  ) {
    let operation = initial
    let currentResponse = response
    for (let attempt = 0; attempt < 120; attempt++) {
      if (operation.peer_id !== peerId || operation.kind !== kind)
        throw new Error('Operation identity did not match the disposable peer.')
      if (operation.status === 'complete') return
      if (operation.status === 'cancelled')
        throw new Error('The disposable peer operation was cancelled.')
      const remaining = until - Date.now()
      if (remaining <= 0) break
      await wait(Math.min(retryDelay(currentResponse), remaining))
      if (Date.now() >= until) break
      const result = await json(
        `/v1/operations/${operation.id}`,
        'Operation polling',
        {},
        until,
      )
      operation = parse(operationSchema, result.body, 'Operation polling')
      currentResponse = result.response
    }
    throw new Error(
      'The disposable peer operation did not complete before the deadline.',
    )
  }

  async function revoke(peerId: string) {
    const until = Date.now() + timeoutMs
    let response: Response | undefined
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await request(
          `/v1/peers/${peerId}`,
          'Peer cleanup',
          { method: 'DELETE' },
          until,
        )
      } catch (error) {
        if (
          !(error instanceof SmokeHttpError) ||
          error.status !== 0 ||
          attempt === 2
        )
          throw error
        await wait(Math.min(1000, Math.max(0, until - Date.now())))
        continue
      }
      if (response.ok || response.status === 404) break
      if (response.status !== 429 && response.status < 500) break
      await wait(
        Math.min(retryDelay(response), Math.max(0, until - Date.now())),
      )
    }
    if (!response || (!response.ok && response.status !== 404))
      throw new Error('Peer cleanup was rejected.')
    if (response.status === 202) {
      let body: unknown
      try {
        body = await response.json()
      } catch {
        throw new Error('Peer cleanup did not return valid JSON.')
      }
      await poll(
        parse(operationSchema, body, 'Peer cleanup'),
        peerId,
        'delete',
        response,
        until,
      )
    } else if (![204, 404].includes(response.status))
      throw new Error('Peer cleanup returned an unexpected status.')
    const removed = await request(
      `/v1/peers/${peerId}`,
      'Removal verification',
      {},
      until,
    )
    if (removed.status !== 404)
      throw new Error('The disposable peer still exists after cleanup.')
    progress('Disposable peer revoked and removal verified.')
  }

  try {
    const homeHeaders = new Headers()
    if (config.bypassSecret)
      homeHeaders.set('x-vercel-protection-bypass', config.bypassSecret)
    let home: Response
    try {
      home = await send(config.boardUrl, {
        headers: homeHeaders,
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      })
    } catch {
      throw new Error('The deployed board could not be reached.')
    }
    if (!home.ok || !home.headers.get('Content-Type')?.includes('text/html'))
      throw new Error('The deployed board did not serve the frontend.')
    for (const [name, value] of Object.entries(securityHeaders))
      if (home.headers.get(name) !== value)
        throw new Error(
          `The deployed board is missing its expected ${name} policy.`,
        )
    if (
      new URL(config.boardUrl).protocol === 'https:' &&
      !home.headers.get('Strict-Transport-Security')?.includes('max-age=')
    )
      throw new Error('The deployed board is missing HSTS.')
    progress('Deployed frontend and security headers verified.')

    parse(livenessSchema, (await json('/livez', 'Liveness')).body, 'Liveness')
    const ready = parse(
      readinessSchema,
      (await json('/readyz', 'Readiness')).body,
      'Readiness',
    )
    if (ready.status !== 'ready')
      throw new Error('The test WireGuard server is not ready.')
    parse(
      serverInfoSchema,
      (await json('/v1/server', 'Server information')).body,
      'Server information',
    )
    const existing = await inventory()
    const metrics = await request('/metrics', 'Metrics')
    if (
      !metrics.ok ||
      !metrics.headers.get('Content-Type')?.startsWith('text/plain') ||
      !(await metrics.text()).includes('wireguard_')
    )
      throw new Error(
        'The deployed proxy did not return WireGuard metrics as text.',
      )
    progress(
      'Public probes, authenticated inventory and text metrics verified.',
    )

    let createdResult: { body: unknown; response: Response } | undefined
    const init: RequestInit = {
      method: 'POST',
      headers: { 'Idempotency-Key': requestKey },
      body: '{"key_mode":"generated"}',
    }
    creationAttempted = true
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        createdResult = await json('/v1/peers', 'Peer creation', init)
        break
      } catch (error) {
        if (
          attempt ||
          !(error instanceof SmokeHttpError) ||
          (error.status > 0 && error.status < 500 && error.status !== 429)
        )
          throw error
        await wait(
          Math.min(error.retryAfterMs, Math.max(0, deadline - Date.now())),
        )
      }
    }
    if (!createdResult) throw new Error('No creation response was received.')
    // Capture only a new identity before validating the rest of the response, so
    // a malformed credential/operation response can still be cleaned up safely.
    if (
      createdResult.body &&
      typeof createdResult.body === 'object' &&
      'peer' in createdResult.body
    ) {
      const identity = peerSchema
        .pick({ id: true })
        .safeParse(createdResult.body.peer)
      if (identity.success && !existing.has(identity.data.id))
        cleanupId = identity.data.id
    }
    const created = parse(
      createdPeerSchema,
      createdResult.body,
      'Peer creation',
    )
    if (!cleanupId || cleanupId !== created.peer.id)
      throw new Error(
        'Creation did not return a new disposable peer; existing peers will not be deleted.',
      )
    if (
      created.replayed ||
      !created.private_key ||
      !/^[A-Za-z0-9+/]{43}=$/.test(created.private_key) ||
      !created.client_config?.includes(
        `[Interface]\nPrivateKey = ${created.private_key}`,
      ) ||
      !created.client_config.includes('[Peer]')
    )
      throw new Error(
        'The initial creation response did not include a complete one-time client configuration.',
      )
    progress('Disposable peer and downloadable client configuration verified.')

    const replay = parse(
      createdPeerSchema,
      (await json('/v1/peers', 'Idempotency replay', init)).body,
      'Idempotency replay',
    )
    if (
      !replay.replayed ||
      replay.peer.id !== cleanupId ||
      replay.operation.id !== created.operation.id ||
      replay.private_key !== null ||
      replay.client_config !== null
    )
      throw new Error(
        'Idempotency replay changed identity or re-exposed generated credentials.',
      )
    progress(
      'Identical-request replay verified without credential re-exposure.',
    )
    await poll(
      created.operation,
      cleanupId,
      'create',
      createdResult.response,
      deadline,
    )
    const applied = parse(
      peerSchema,
      (await json(`/v1/peers/${cleanupId}`, 'Applied peer inspection')).body,
      'Applied peer inspection',
    )
    if (
      applied.id !== cleanupId ||
      applied.state !== 'active' ||
      !applied.applied
    )
      throw new Error('The new peer was not verified as applied in WireGuard.')
    if (!(await inventory()).has(cleanupId))
      throw new Error('The disposable peer is missing from the inventory.')
    progress(
      'Peer listing, operation completion and WireGuard application verified.',
    )
  } catch (error) {
    failure = error
  } finally {
    if (cleanupId) {
      try {
        await revoke(cleanupId)
      } catch {
        failure = new Error(
          `Cleanup failed for disposable peer ${cleanupId}. Revoke this exact peer manually on the test server.`,
        )
      }
    }
  }
  if (failure) {
    const message =
      failure instanceof Error
        ? failure.message
        : 'The deployed smoke test failed.'
    throw new Error(
      creationAttempted && !cleanupId
        ? `${message} If creation was accepted without a recoverable response, inspect the test server using request key ${requestKey}.`
        : message,
    )
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await runDeploymentSmoke(smokeConfig(process.env), {
      onProgress: (message) => console.log(message),
    })
    console.log(
      'Deployment smoke test passed. No generated credentials were written to disk.',
    )
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : 'The deployment smoke test failed.',
    )
    process.exitCode = 1
  }
}
