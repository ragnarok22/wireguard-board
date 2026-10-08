import { Button } from '@/components/ui/button'
import { ErrorNotice, Spinner } from '@/components/ui/feedback'
import { useOperation, useTrackedOperations } from '@/hooks/use-operations'
import { errorMessage } from '@/lib/api-client'
import type { OperationResponse, ServerConnection } from '@/lib/api-types'

function OperationStatus({
  server,
  initial,
}: {
  server: ServerConnection
  initial: OperationResponse
}) {
  const query = useOperation(server, initial)
  const operation = query.data?.operation ?? initial.operation
  const action = operation.kind === 'create' ? 'Creation' : 'Revocation'
  return (
    <div className="notice" role="status">
      {operation.status === 'pending' && <Spinner />}
      <div>
        <strong>
          {action} {operation.status} · {operation.address}
        </strong>
        <div>
          {operation.status === 'pending'
            ? 'The backend is reconciling this operation. VPN access changes are not yet confirmed.'
            : operation.status === 'cancelled'
              ? 'Creation was superseded by deletion.'
              : operation.kind === 'delete'
                ? 'VPN access has been removed.'
                : 'The peer is ready to use.'}
        </div>
        {operation.status === 'pending' && operation.error && (
          <div>Last backend error: {operation.error}</div>
        )}
        {query.error && (
          <>
            <ErrorNotice message={errorMessage(query.error)} />
            <Button
              variant="outline"
              onClick={() => {
                void query.refetch()
              }}
            >
              Check operation
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

export function TrackedOperations({ server }: { server: ServerConnection }) {
  const operations = useTrackedOperations(server)
  return operations.length > 0 ? (
    <section aria-label="Operation progress">
      {operations.map((item) => (
        <OperationStatus
          key={item.operation.id}
          server={server}
          initial={item}
        />
      ))}
    </section>
  ) : null
}
