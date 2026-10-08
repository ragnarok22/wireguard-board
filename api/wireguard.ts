import { handleProxy } from '../server/proxy-handler.ts'
import { limitProxyRequest } from '../server/proxy-rate-limit.ts'

export default {
  fetch: (request: Request) =>
    handleProxy(request, {
      rateLimit: (input) => limitProxyRequest(input, { enabled: true }),
    }),
}
