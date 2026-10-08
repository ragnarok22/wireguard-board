import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileCode2, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { CopyButton, ErrorNotice, Spinner } from '@/components/ui/feedback'
import { api, errorMessage, serverQueryKey } from '@/lib/api-client'
import type { Peer, ServerConnection } from '@/lib/api-types'
import { downloadText } from '@/lib/client-config'
import { formatBytes, handshakeLabel, shortKey } from '@/lib/formatters'

export function PeerDetailsDialog({
  server,
  peer,
  onClose,
  onDeleted,
}: {
  server: ServerConnection
  peer: Peer
  onClose: () => void
  onDeleted: () => void
}) {
  const client = useQueryClient()
  const [showConfig, setShowConfig] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const detail = useQuery({
    queryKey: [...serverQueryKey(server), 'peer', peer.public_key],
    queryFn: ({ signal }) => api.peer(server, peer.public_key, signal),
  })
  const config = useQuery({
    queryKey: [...serverQueryKey(server), 'partial-config', peer.public_key],
    queryFn: ({ signal }) => api.peerConfig(server, peer.public_key, signal),
    enabled: showConfig,
  })
  const deletion = useMutation({
    mutationFn: () => api.deletePeer(server, peer.public_key),
    retry: false,
    onSuccess: () => {
      client.removeQueries({
        queryKey: [...serverQueryKey(server), 'peer', peer.public_key],
      })
      client.removeQueries({
        queryKey: [
          ...serverQueryKey(server),
          'partial-config',
          peer.public_key,
        ],
      })
      void client.invalidateQueries({ queryKey: serverQueryKey(server) })
      onDeleted()
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
                This removes{' '}
                <strong>
                  {data.allowed_ips.join(', ') || shortKey(peer.public_key)}
                </strong>{' '}
                from <strong>{server.name}</strong>. The device will lose VPN
                access.
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
            <dl className="detail-grid">
              <div>
                <dt>VPN address</dt>
                <dd>{data.allowed_ips.join(', ') || 'Not assigned'}</dd>
              </div>
              <div>
                <dt>Endpoint</dt>
                <dd>{data.endpoint || 'Not seen yet'}</dd>
              </div>
              <div>
                <dt>Last handshake</dt>
                <dd>{handshakeLabel(data.latest_handshake)}</dd>
              </div>
              <div>
                <dt>Keepalive</dt>
                <dd>
                  {data.persistent_keepalive
                    ? `${data.persistent_keepalive}s`
                    : 'Off'}
                </dd>
              </div>
              <div>
                <dt>Received by server</dt>
                <dd>{formatBytes(data.transfer_rx)}</dd>
              </div>
              <div>
                <dt>Sent by server</dt>
                <dd>{formatBytes(data.transfer_tx)}</dd>
              </div>
            </dl>
            <div className="field">
              <span>Public key</span>
              <code className="full-key">{data.public_key}</code>
              <CopyButton text={data.public_key} label="Copy public key" />
            </div>
            {showConfig ? (
              <div className="partial-config">
                <div className="notice">
                  This is a partial configuration, not a ready-to-import client
                  file. Add an [Interface] section with your device’s private
                  key, address and DNS.
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
                      <CopyButton
                        text={config.data.config}
                        label="Copy partial config"
                      />
                      <Button
                        variant="outline"
                        onClick={() =>
                          downloadText(
                            config.data!.config,
                            'wireguard-partial.conf',
                          )
                        }
                      >
                        <Download />
                        Download partial .conf
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <Button variant="outline" onClick={() => setShowConfig(true)}>
                <FileCode2 />
                View partial config
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
