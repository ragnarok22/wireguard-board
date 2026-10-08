import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { CopyButton, ErrorNotice, Spinner } from '@/components/ui/feedback'
import { api, errorMessage, serverQueryKey } from '@/lib/api-client'
import type { ServerConnection } from '@/lib/api-types'
import { downloadText } from '@/lib/client-config'

export function MetricsDialog({
  server,
  onClose,
}: {
  server: ServerConnection
  onClose: () => void
}) {
  const metrics = useQuery({
    queryKey: [...serverQueryKey(server), 'metrics'],
    queryFn: ({ signal }) => api.metrics(server, signal),
    retry: false,
    gcTime: 0,
  })
  return (
    <Dialog
      title="Prometheus metrics"
      description={`Current exposition from ${server.name}.`}
      wide
      onClose={onClose}
    >
      <div className="dialog-body">
        <div className="notice">
          These are cumulative metrics, not traffic rates. NaN and -1 indicate
          unavailable observations or pending counts.
        </div>
        {metrics.isPending && (
          <div className="loading-inline">
            <Spinner />
            Loading metrics…
          </div>
        )}
        {metrics.error && <ErrorNotice message={errorMessage(metrics.error)} />}
        {metrics.data !== undefined && (
          <>
            <pre tabIndex={0}>{metrics.data}</pre>
            <div className="button-row">
              <CopyButton text={metrics.data} label="Copy metrics" />
              <Button
                variant="outline"
                onClick={() =>
                  downloadText(metrics.data!, 'wireguard-metrics.txt')
                }
              >
                Download metrics
              </Button>
            </div>
          </>
        )}
        <div className="dialog-actions">
          <Button
            variant="outline"
            disabled={metrics.isFetching}
            onClick={() => {
              void metrics.refetch()
            }}
          >
            Refresh metrics
          </Button>
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </Dialog>
  )
}
