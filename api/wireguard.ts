import { handleProxy } from '../server/proxy-handler.ts'

export default { fetch: (request: Request) => handleProxy(request) }
