import { z } from 'zod'

const numeric = '(0|[1-9]\\d*)'
const versionPattern = new RegExp(
  `^v?${numeric}\\.${numeric}\\.${numeric}(?:-([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$`,
)

function parseVersion(value: string) {
  const match = versionPattern.exec(value)
  if (!match) return null
  const prerelease = match[4]?.split('.') ?? []
  if (prerelease.some((part) => /^\d+$/.test(part) && /^0\d/.test(part)))
    return null
  return {
    core: match.slice(1, 4).map(BigInt),
    prerelease,
  }
}

/** Returns null for unknown versions; build metadata does not affect precedence. */
export function compareVersions(left: string, right: string): number | null {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a || !b) return null
  for (let index = 0; index < 3; index++) {
    if (a.core[index] !== b.core[index])
      return a.core[index] > b.core[index] ? 1 : -1
  }
  if (!a.prerelease.length || !b.prerelease.length)
    return Math.sign(b.prerelease.length - a.prerelease.length)
  for (
    let index = 0;
    index < Math.max(a.prerelease.length, b.prerelease.length);
    index++
  ) {
    const x = a.prerelease[index]
    const y = b.prerelease[index]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    const xNumeric = /^\d+$/.test(x)
    const yNumeric = /^\d+$/.test(y)
    if (xNumeric && yNumeric) return BigInt(x) > BigInt(y) ? 1 : -1
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1
    return x > y ? 1 : -1
  }
  return 0
}

export function isStableVersion(value: string): boolean {
  const parsed = parseVersion(value)
  return parsed !== null && parsed.prerelease.length === 0
}

const releaseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('available'),
    version: z.string().refine(isStableVersion),
    url: z
      .url()
      .regex(
        /^https:\/\/github\.com\/ragnarok22\/wireguard-(api|board)\/releases\/tag\/[^/?#]+$/,
      ),
  }),
  z.object({ status: z.literal('none') }),
  z.object({ status: z.literal('unavailable') }),
])

export const releasesSchema = z.object({
  api: releaseSchema,
  board: releaseSchema,
})
export type Release = z.infer<typeof releaseSchema>
export type Releases = z.infer<typeof releasesSchema>
export type ReleaseProject = keyof Releases
export const releaseCheckInterval = 60 * 60 * 1000
