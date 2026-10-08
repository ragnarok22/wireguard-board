import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, KeyRound, Plus, RefreshCw } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { CopyButton, ErrorNotice, Spinner } from '@/components/ui/feedback'
import { api, errorMessage } from '@/lib/api-client'
import type { PeerInput, ServerConnection } from '@/lib/api-types'
import { configFilename, downloadText } from '@/lib/client-config'
import {
  refreshInventory,
  trackOperation,
  useOperation,
} from '@/hooks/use-operations'

type Attempt = { input: PeerInput; requestKey: string }

export function CreatePeerDialog({
  server,
  onClose,
}: {
  server: ServerConnection
  onClose: () => void
}) {
  const client = useQueryClient()
  const [name, setName] = useState('wireguard-client')
  const [publicKey, setPublicKey] = useState('')
  const [address, setAddress] = useState('')
  const [validation, setValidation] = useState('')
  const [attempt, setAttempt] = useState<Attempt>()
  const create = useMutation({
    mutationFn: ({ input, requestKey }: Attempt) =>
      api.createPeer(server, input, requestKey),
    retry: false,
    gcTime: 0,
    onSuccess: (created) => {
      refreshInventory(client, server)
      if (created.operation.status === 'pending')
        trackOperation(client, server, {
          operation: created.operation,
          retryAfterMs: created.retryAfterMs,
        })
    },
  })
  const created = create.data
  const progress = useOperation(
    server,
    created
      ? { operation: created.operation, retryAfterMs: created.retryAfterMs }
      : undefined,
  )
  const status = progress.data?.operation.status ?? created?.operation.status
  const config = created?.client_config

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setValidation('')
    const key = publicKey.trim()
    if (key && !/^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/.test(key)) {
      setValidation('Enter a canonical 44-character WireGuard public key.')
      return
    }
    if (address.trim() && !z.ipv4().safeParse(address.trim()).success) {
      setValidation('Enter one bare IPv4 address, without a CIDR suffix.')
      return
    }
    const input: PeerInput = key
      ? { key_mode: 'external', public_key: key }
      : { key_mode: 'generated' }
    if (address.trim()) input.address = address.trim()
    const next = { input, requestKey: crypto.randomUUID() }
    setAttempt(next)
    create.mutate(next)
  }

  return (
    <Dialog
      title={
        created
          ? status === 'complete'
            ? 'Your peer is ready'
            : status === 'cancelled'
              ? 'Creation cancelled'
              : 'Peer application pending'
          : 'Add a peer'
      }
      description={`Create a device configuration on ${server.name}.`}
      onClose={onClose}
      busy={create.isPending}
      wide={!!config}
    >
      {!created ? (
        <form className="dialog-body" onSubmit={submit}>
          <fieldset disabled={create.isPending || !!attempt}>
            <label className="field">
              Configuration filename
              <input
                required
                maxLength={64}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. work-laptop"
              />
              <span className="field-hint">
                Used for the download. The API identifies peers by UUID.
              </span>
            </label>
            <div className="notice notice-subtle">
              <KeyRound size={18} />
              <span>
                Keys and an available VPN address are generated automatically.
              </span>
            </div>
            <details className="advanced">
              <summary>Advanced options</summary>
              <div className="advanced-fields">
                <label className="field">
                  Public key <span className="optional">optional</span>
                  <input
                    value={publicKey}
                    onChange={(event) => setPublicKey(event.target.value)}
                    autoComplete="off"
                    placeholder="Use your own public key"
                  />
                  <span className="field-hint">
                    Keep your private key on the device. Use the configuration
                    template in peer details.
                  </span>
                </label>
                <label className="field">
                  VPN address <span className="optional">optional</span>
                  <input
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                    placeholder="10.13.13.10"
                  />
                  <span className="field-hint">
                    One bare IPv4 address inside the server pool. Leave empty
                    for automatic allocation.
                  </span>
                </label>
              </div>
            </details>
          </fieldset>
          {validation && <ErrorNotice message={validation} />}
          {create.error && (
            <ErrorNotice
              message={`${errorMessage(create.error)} Retry this same request to recover its peer and operation identity. Generated credentials cannot be recovered if the first response was lost.`}
            />
          )}
          <div className="dialog-actions">
            <Button
              variant="outline"
              disabled={create.isPending}
              onClick={onClose}
            >
              Cancel
            </Button>
            {attempt && create.error ? (
              <Button
                disabled={create.isPending}
                onClick={() => create.mutate(attempt)}
              >
                <RefreshCw />
                Retry same request
              </Button>
            ) : (
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? <Spinner /> : <Plus />}
                {create.isPending ? 'Creating peer…' : 'Create peer'}
              </Button>
            )}
          </div>
        </form>
      ) : (
        <div className="dialog-body">
          <div className="created-summary">
            <span
              className={`status-badge ${status === 'complete' ? 'healthy' : ''}`}
            >
              {status === 'complete'
                ? 'Peer created'
                : status === 'cancelled'
                  ? 'Creation cancelled'
                  : 'Application pending'}
            </span>
            <code>{created.peer.address}/32</code>
          </div>
          {status === 'pending' && (
            <div className="notice" role="status">
              <Spinner />
              <span>
                Save any credentials now. Wait until the operation is complete
                before importing or activating this tunnel. The backend is
                retrying application.
                {progress.data?.operation.error &&
                  ` Last error: ${progress.data.operation.error}`}
              </span>
            </div>
          )}
          {status === 'cancelled' && (
            <ErrorNotice message="This creation was superseded by deletion. Do not activate this configuration." />
          )}
          {progress.error && (
            <>
              <ErrorNotice message={errorMessage(progress.error)} />
              <Button
                variant="outline"
                onClick={() => {
                  void progress.refetch()
                }}
              >
                Check operation
              </Button>
            </>
          )}
          {created.replayed &&
          !config &&
          attempt?.input.key_mode === 'generated' ? (
            <ErrorNotice message="The request was recovered, but its one-time private key is no longer available. Revoke this peer, wait for completed revocation, then create a replacement with a new request key." />
          ) : config ? (
            <>
              <div className="notice">
                <KeyRound size={18} />
                <span>
                  Save this configuration before closing. The API returns the
                  private key only once.
                </span>
              </div>
              <div className="config-preview">
                {status === 'complete' && (
                  <div className="qr-panel">
                    <QRCodeSVG
                      value={config}
                      size={176}
                      marginSize={2}
                      level="M"
                      title="WireGuard client configuration"
                    />
                    <span>Scan with the WireGuard app</span>
                  </div>
                )}
                <pre tabIndex={0}>{config}</pre>
              </div>
              <div className="button-row">
                <Button
                  onClick={() => downloadText(config, configFilename(name))}
                >
                  <Download />
                  Download .conf
                </Button>
                <CopyButton text={config} label="Copy config" />
                <Button
                  variant="outline"
                  onClick={() =>
                    downloadText(
                      JSON.stringify(created, null, 2),
                      configFilename(name).replace('.conf', '-keys.json'),
                    )
                  }
                >
                  <Download />
                  Save creation response
                </Button>
              </div>
            </>
          ) : (
            <div className="notice">
              Your peer uses the public key you provided. Configure its private
              key on your device using the configuration template in peer
              details.
            </div>
          )}
          <details className="advanced">
            <summary>Peer identity</summary>
            <code className="full-key">{created.peer.id}</code>
            <code className="full-key">{created.peer.public_key}</code>
            <code className="full-key">Operation: {created.operation.id}</code>
          </details>
          <div className="dialog-actions">
            <Button variant="outline" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}
