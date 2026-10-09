import { useReleases } from '@/lib/releases'
import {
  compareVersions,
  type Release,
  type ReleaseProject,
} from '../../shared/releases'

type VersionStatus = {
  message: string
  update?: Extract<Release, { status: 'available' }>
}

function getVersionStatus(
  version: string | undefined,
  release: Release | undefined,
  failed: boolean,
): VersionStatus {
  if (!version) return { message: 'Installed version unavailable.' }
  if (failed || release?.status === 'unavailable')
    return { message: 'Update check unavailable.' }
  if (!release) return { message: 'Checking for updates…' }
  if (release.status === 'none')
    return { message: 'No stable releases published.' }

  const comparison = compareVersions(release.version, version)
  if (comparison === null)
    return { message: 'Update comparison unavailable for this version.' }
  if (comparison > 0)
    return { message: `Update available: v${release.version}`, update: release }
  return { message: 'No newer stable release.' }
}

function VersionUpdateNotice({
  status,
  compact,
}: {
  status: VersionStatus
  compact: boolean
}) {
  if (status.update) {
    if (compact)
      return <span className="version-note"> · Update available</span>
    return (
      <a href={status.update.url} target="_blank" rel="noreferrer">
        {status.message}
      </a>
    )
  }
  if (compact) return null
  return <span className="version-note">{status.message}</span>
}

export function VersionIndicator({
  project,
  version,
  compact = false,
}: {
  project: ReleaseProject
  version?: string
  compact?: boolean
}) {
  const releases = useReleases()
  const status = getVersionStatus(
    version,
    releases.data?.[project],
    !!releases.error,
  )
  const label = project === 'api' ? 'API' : 'Board'
  const installedVersion = version
    ? `v${version.replace(/^v/, '')}`
    : 'version unavailable'
  return (
    <span
      role="group"
      className={`version-indicator${status.update ? ' version-outdated' : ''}${compact ? ' version-compact' : ''}`}
      title={status.message}
      aria-label={`${label} ${installedVersion}. ${status.message}`}
    >
      <span>
        {label} {installedVersion}
      </span>
      <VersionUpdateNotice status={status} compact={compact} />
    </span>
  )
}
