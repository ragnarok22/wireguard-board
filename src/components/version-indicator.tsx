import { useReleases } from '@/lib/releases'
import { compareVersions, type ReleaseProject } from '../../shared/releases'

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
  const release = releases.error ? undefined : releases.data?.[project]
  const comparison =
    version && release?.status === 'available'
      ? compareVersions(release.version, version)
      : null
  const hasUpdate =
    comparison !== null && comparison !== undefined && comparison > 0
  const label = project === 'api' ? 'API' : 'Board'
  let message = 'Checking for updates…'
  if (!version) message = 'Installed version unavailable.'
  else if (releases.error || release?.status === 'unavailable')
    message = 'Update check unavailable.'
  else if (release?.status === 'none') message = 'No stable releases published.'
  else if (release?.status === 'available') {
    message =
      comparison === null
        ? 'Update comparison unavailable for this version.'
        : hasUpdate
          ? `Update available: v${release.version}`
          : 'No newer stable release.'
  }
  return (
    <span
      className={`version-indicator${hasUpdate ? ' version-outdated' : ''}${compact ? ' version-compact' : ''}`}
      title={message}
      aria-label={`${label} ${version ? `v${version.replace(/^v/, '')}` : 'version unavailable'}. ${message}`}
    >
      <span>
        {label}{' '}
        {version ? `v${version.replace(/^v/, '')}` : 'version unavailable'}
      </span>
      {hasUpdate && release?.status === 'available' ? (
        compact ? (
          <span className="version-note"> · Update available</span>
        ) : (
          <a href={release.url} target="_blank" rel="noreferrer">
            Update available: v{release.version}
          </a>
        )
      ) : !compact ? (
        <span className="version-note">{message}</span>
      ) : null}
    </span>
  )
}
