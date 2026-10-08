import { spawnSync } from 'node:child_process'

// This stages one named rule. Publishing is a separate CLI action so an operator
// can review any other existing firewall drafts before they become live.
const mode = process.argv.includes('--update') ? 'edit' : 'add'
const result = spawnSync(
  'vercel',
  [
    'firewall',
    'rules',
    mode,
    'WireGuard proxy',
    '--condition',
    JSON.stringify({
      type: 'rate_limit_api_id',
      op: 'eq',
      value: 'wireguard-proxy',
    }),
    '--action',
    'rate_limit',
    '--rate-limit-window',
    '60',
    '--rate-limit-requests',
    '240',
    '--rate-limit-keys',
    'ip',
    '--rate-limit-algo',
    'fixed_window',
    '--rate-limit-action',
    'rate_limit',
    '--yes',
  ],
  { stdio: 'inherit' },
)

if (result.error) {
  console.error(
    'Install the Vercel CLI, run vercel login, and link this project before configuring its firewall.',
  )
  process.exitCode = 1
} else {
  process.exitCode = result.status ?? 1
  if (result.status === 0)
    console.log(
      'Rule staged. Review with vercel firewall diff, then publish with vercel firewall publish --yes.',
    )
}
