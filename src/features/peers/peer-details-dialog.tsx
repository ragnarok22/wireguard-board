import { useState } from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import { Download, FileCode2, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { CopyButton, ErrorNotice, Spinner } from '@/components/ui/feedback'
import { api, errorMessage, serverQueryKey } from '@/lib/api-client'
import type { Peer, ServerConnection } from '@/lib/api-types'
import { downloadText } from '@/lib/client-config'
import { formatBytes, handshakeLabel, shortKey } from '@/lib/formatters'
import { refreshInventory, trackOperation } from '@/hooks/use-operations'

export function PeerDetailsDialog({
  server,
  peer,
  onClose,
  onDeleted,
}: {
  server: ServerConnection
  peer: Peer
  onClose: () => void
  onDeleted: (message: string) => void
}) {
  const client = useQueryClient()
  const [showConfig, setShowConfig] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const detail = useQuery({
    queryKey: [...serverQueryKey(server), 'peer', peer.id],
    queryFn: ({ signal }) => api.peer(server, peer.id, signal),
    refetchInterval: 15_000,
  })
  const config = useQuery({
    queryKey: [...serverQueryKey(server), 'config-template', peer.id],
    queryFn: ({ signal }) => api.peerConfig(server, peer.id, signal),
    enabled: showConfig,
  })
  const deletion = useMutation({
    mutationFn: () => api.deletePeer(server, peer.id),
    retry: false,
    onSuccess: (operation) => {
      if (operation) trackOperation(client, server, operation)
      client.removeQueries({
        queryKey: [...serverQueryKey(server), 'peer', peer.id],
      })
      client.removeQueries({
        queryKey: [...serverQueryKey(server), 'config-template', peer.id],
      })
      refreshInventory(client, server)
      onDeleted(
        operation
          ? 'Revocation pending. The address stays reserved until VPN access removal is verified.'
          : 'Peer deleted. Its VPN access has been removed.',
      )
      onClose()
    },
  })
  const data = detail.data ?? peer
  return (
    <Dialog
      title={confirmDelete ? 'Delete this peer?' : 'Peer details'}
      description={`${shortKey(peer.public_key)} · ${server.name}`}
      onClose={onClose}
      busy={deletion.isPending}
      wide={showConfig && !confirmDelete}
    >
      <div className="dialog-body">
        {confirmDelete ? (
          <>
            <div className="notice notice-error">
              <Trash2 size={18} />
              <span>
                This removes <strong>{data.address}</strong> from{' '}
                <strong>{server.name}</strong>. The device will lose VPN access.
              </span>
            </div>
            {deletion.error && (
              <ErrorNotice message={errorMessage(deletion.error)} />
            )}
            <div className="dialog-actions">
              <Button
                variant="outline"
                disabled={deletion.isPending}
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={deletion.isPending}
                onClick={() => deletion.mutate()}
              >
                {deletion.isPending ? <Spinner /> : <Trash2 />}
                {deletion.isPending ? 'Deleting…' : 'Delete peer'}
              </Button>
            </div>
          </>
        ) : (
          <>
            {detail.isPending && (
              <div className="loading-inline">
                <Spinner />
                Loading current peer details…
              </div>
            )}
            {detail.error && (
              <>
                <ErrorNotice message={errorMessage(detail.error)} />
                <Button
                  variant="outline"
                  onClick={() => {
                    void detail.refetch()
                  }}
                >
                  <RefreshCw />
                  Retry details
                </Button>
              </>
            )}
            <PeerObservationDetails peer={data} />
            <dl className="detail-grid">
              <div>
                <dt>State</dt>
                <dd>{data.state}</dd>
              </div>
              <div>
                <dt>Applied in WireGuard</dt>
                <dd>{data.applied ? 'Yes' : 'No'}</dd>
              </div>
              <div>
                <dt>Peer ID</dt>
                <dd className="full-key">{data.id}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{new Date(data.created_at * 1000).toLocaleString()}</dd>
              </div>
            </dl>
            <div className="field">
              <span>Public key</span>
              <code className="full-key">{data.public_key}</code>
              <CopyButton text={data.public_key} label="Copy public key" />
            </div>
            {showConfig ? (
              <PeerConfigTemplate config={config} />
            ) : (
              <Button variant="outline" onClick={() => setShowConfig(true)}>
                <FileCode2 />
                View config template
              </Button>
            )}
            <div className="dialog-actions">
              <Button
                variant="destructive"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 />
                Delete peer
              </Button>
              <Button variant="outline" onClick={onClose}>
                Done
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}

function PeerObservationDetails({ peer: data }: { peer: Peer }) {
  return (
    <dl className="detail-grid">
      <div>
        <dt>VPN address</dt>
        <dd>{data.address}/32</dd>
      </div>
      <div>
        <dt>Endpoint</dt>
        <dd>
          {data.observation
            ? data.observation.endpoint || 'Not seen yet'
            : 'Unavailable'}
        </dd>
      </div>
      <div>
        <dt>Last handshake</dt>
        <dd>
          {data.observation
            ? handshakeLabel(data.observation.latest_handshake)
            : 'Unavailable'}
        </dd>
      </div>
      <div>
        <dt>Keepalive</dt>
        <dd>
          {data.observation
            ? data.observation.persistent_keepalive
              ? `${data.observation.persistent_keepalive}s`
              : 'Off'
            : 'Unavailable'}
        </dd>
      </div>
      <div>
        <dt>Received by server</dt>
        <dd>
          {data.observation ? formatBytes(data.observation.transfer_rx) : '—'}
        </dd>
      </div>
      <div>
        <dt>Sent by server</dt>
        <dd>
          {data.observation ? formatBytes(data.observation.transfer_tx) : '—'}
        </dd>
      </div>
    </dl>
  )
}

function PeerConfigTemplate({
  config,
}: {
  config: UseQueryResult<Awaited<ReturnType<typeof api.peerConfig>>>
}) {
  return (
    <div className="config-template">
      <div className="notice">
        This is a configuration template, not a ready-to-import client file.
        Replace &lt;YOUR_PRIVATE_KEY&gt; locally with your retained private key
        before importing. The API cannot recover a generated private key.
      </div>
      {config.isPending && (
        <div className="loading-inline">
          <Spinner />
          Loading configuration…
        </div>
      )}
      {config.error && (
        <>
          <ErrorNotice message={errorMessage(config.error)} />
          <Button
            variant="outline"
            onClick={() => {
              void config.refetch()
            }}
          >
            Retry configuration
          </Button>
        </>
      )}
      {config.data && (
        <>
          <pre tabIndex={0}>{config.data.config}</pre>
          <div className="button-row">
            <CopyButton text={config.data.config} label="Copy template" />
            <Button
              variant="outline"
              onClick={() =>
                downloadText(config.data!.config, 'wireguard-template.conf')
              }
            >
              <Download />
              Download template .conf
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
