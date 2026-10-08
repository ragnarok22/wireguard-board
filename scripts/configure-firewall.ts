import { spawnSync } from 'node:child_process'
import { firewallPolicy } from '../server/firewall-policy.ts'

// This stages one named rule. Publishing is a separate CLI action so an operator
// can review any other existing firewall drafts before they become live.
const mode = process.argv.includes('--update') ? 'edit' : 'add'
const result = spawnSync(
  'vercel',
  [
    'firewall',
    'rules',
    mode,
    firewallPolicy.name,
    '--condition',
    JSON.stringify(firewallPolicy.condition),
    '--action',
    firewallPolicy.action,
    '--rate-limit-window',
    String(firewallPolicy.windowSeconds),
    '--rate-limit-requests',
    String(firewallPolicy.requests),
    '--rate-limit-keys',
    firewallPolicy.keys.join(','),
    '--rate-limit-algo',
    firewallPolicy.algorithm,
    '--rate-limit-action',
    firewallPolicy.exceededAction,
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
