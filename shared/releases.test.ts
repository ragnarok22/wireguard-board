import { describe, expect, it } from 'vitest'
import { compareVersions, isStableVersion, releasesSchema } from './releases'

describe('semantic version comparison', () => {
  it.each([
    ['1.10.0', '1.9.0', 1],
    ['v2.0.0', '1.99.99', 1],
    ['1.0.1', '1.0.0', 1],
    ['1.0.0', '1.0.1', -1],
    ['v1.0.0', '1.0.0+build.12', 0],
    ['1.0.0', '1.0.0-rc.1', 1],
    ['0.9.0', '1.0.0-rc.1', -1],
    ['1.0.0-rc.10', '1.0.0-rc.2', 1],
    ['1.0.0-alpha', '1.0.0-beta', -1],
    ['1.0.0-1', '1.0.0-alpha', -1],
    ['1.0.0-alpha', '1.0.0-alpha.1', -1],
    ['1.0.0-alpha.1', '1.0.0-alpha', 1],
    ['1.0.0-rc.1', '1.0.0-rc.1', 0],
    ['1.0.0-rc.1', '1.0.0', -1],
    ['1.0.0-beta', '1.0.0-1', 1],
    ['1.0.0-beta', '1.0.0-alpha', 1],
    ['1.0.0-rc.2', '1.0.0-rc.10', -1],
    ['unknown', '1.0.0', null],
    ['1.0.0', 'dev', null],
    ['01.0.0', '1.0.0', null],
    ['1.0.0-rc.01', '1.0.0', null],
  ])('compares %s to %s', (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected)
  })

  it.each(['1.0.0-rc.1', 'v1.0.0-beta', 'dev', '1.0', '01.0.0'])(
    'rejects %s as stable',
    (version) => {
      expect(isStableVersion(version)).toBe(false)
    },
  )

  it('accepts stable versions and rejects external release links', () => {
    expect(isStableVersion('v1.2.3+build.4')).toBe(true)
    expect(
      releasesSchema.safeParse({
        api: {
          status: 'available',
          version: '1.2.3',
          url: 'https://evil.example/release',
        },
        board: { status: 'none' },
      }).success,
    ).toBe(false)
  })
})
