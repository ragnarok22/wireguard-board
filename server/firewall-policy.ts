export const firewallPolicy = {
  name: 'WireGuard proxy',
  condition: { type: 'path', op: 'pre', value: '/api/wireguard' },
  action: 'rate_limit',
  windowSeconds: 60,
  requests: 240,
  keys: ['ip'],
  algorithm: 'fixed_window',
  exceededAction: 'rate_limit',
} as const
