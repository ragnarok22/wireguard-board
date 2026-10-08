const integerFormatter = new Intl.NumberFormat('en', {
  maximumFractionDigits: 0,
})
const decimalFormatter = new Intl.NumberFormat('en', {
  maximumFractionDigits: 1,
})
const byteUnits = ['B', 'KiB', 'MiB', 'GiB', 'TiB']

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const index = Math.min(
    Math.max(0, Math.floor(Math.log(bytes) / Math.log(1024))),
    byteUnits.length - 1,
  )
  return `${(index === 0 ? integerFormatter : decimalFormatter).format(bytes / 1024 ** index)} ${byteUnits[index]}`
}

export function handshakeLabel(
  timestamp: number | null,
  now = Date.now(),
): string {
  if (!timestamp) return 'Never'
  const seconds = Math.max(0, Math.floor(now / 1000 - timestamp))
  if (seconds < 60) return 'Just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

export const isRecentlyActive = (timestamp: number | null, now = Date.now()) =>
  timestamp !== null &&
  timestamp > 0 &&
  now / 1000 - timestamp >= 0 &&
  now / 1000 - timestamp < 180
export const shortKey = (key: string) => `${key.slice(0, 8)}…${key.slice(-5)}`
export function uptimeLabel(seconds: number): string {
  if (seconds < 60) return 'Less than a minute'
  const [value, unit] =
    seconds < 3600
      ? [Math.floor(seconds / 60), 'minute']
      : seconds < 86400
        ? [Math.floor(seconds / 3600), 'hour']
        : [Math.floor(seconds / 86400), 'day']
  return `${value} ${unit}${value === 1 ? '' : 's'}`
}
