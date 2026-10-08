export class ProxyError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, detail: string) {
    super(detail)
    this.status = status
    this.code = code
  }
}

export function proxyErrorResponse(error: ProxyError): Response {
  return Response.json(
    { code: error.code, detail: error.message },
    {
      status: error.status,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  )
}
