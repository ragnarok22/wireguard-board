import { handleReleases } from '../server/releases-handler.ts'

export default { fetch: (request: Request) => handleReleases(request) }
