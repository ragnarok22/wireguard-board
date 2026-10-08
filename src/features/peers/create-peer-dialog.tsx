import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, KeyRound, Plus, RefreshCw } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { CopyButton, ErrorNotice, Spinner } from '@/components/ui/feedback'
import { api, errorMessage, serverQueryKey } from '@/lib/api-client'
import type { PeerInput, ServerConnection } from '@/lib/api-types'
import {
  buildClientConfig,
  configFilename,
  downloadText,
} from '@/lib/client-config'

export function CreatePeerDialog({
  server,
  onClose,
}: {
  server: ServerConnection
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('wireguard-client')
  const [publicKey, setPublicKey] = useState('')
  const [addresses, setAddresses] = useState('')
  const [validation, setValidation] = useState('')
  const create = useMutation({
    mutationFn: (input: PeerInput) => api.createPeer(server, input),
    retry: false,
    gcTime: 0,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: serverQueryKey(server) })
    },
  })
  const created = create.data
  const configQuery = useQuery({
    queryKey: [
      ...serverQueryKey(server),
      'created-config',
      created?.public_key,
    ],
    queryFn: ({ signal }) =>
      api.peerConfig(server, created!.public_key, signal),
    enabled: !!created?.private_key,
    retry: false,
    gcTime: 0,
  })
  let config = ''
  let configError = ''
  if (created && configQuery.data) {
    try {
      config = buildClientConfig(created, configQuery.data.config)
    } catch (error) {
      configError = errorMessage(error)
    }
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setValidation('')
    const input: PeerInput = {}
    if (publicKey.trim()) {
      if (!/^[A-Za-z0-9+/]{43}=$/.test(publicKey.trim())) {
        setValidation('Enter a valid 44-character WireGuard public key.')
        return
      }
      input.public_key = publicKey.trim()
    }
    if (addresses.trim())
      input.allowed_ips = addresses
        .split(',')
        .map((address) => address.trim())
        .filter(Boolean)
    create.mutate(input)
  }

  return (
    <Dialog
      title={created ? 'Your peer is ready' : 'Add a peer'}
      description={`${created ? 'Connect your device to' : 'Create a device configuration on'} ${server.name}.`}
      onClose={onClose}
      busy={create.isPending}
      wide={!!created?.private_key}
    >
      {!created ? (
        <form className="dialog-body" onSubmit={submit}>
          <fieldset disabled={create.isPending}>
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
                Used for the download. The API identifies peers by their public
                key.
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
                    Keep your private key on the device. No complete client
                    config or QR will be generated.
                  </span>
                </label>
                <label className="field">
                  Allowed IPs <span className="optional">optional</span>
                  <input
                    value={addresses}
                    onChange={(event) => setAddresses(event.target.value)}
                    placeholder="10.13.13.10/32"
                  />
                  <span className="field-hint">
                    Comma-separated CIDRs. Leave empty for automatic allocation.
                  </span>
                </label>
              </div>
            </details>
          </fieldset>
          {validation && <ErrorNotice message={validation} />}
          {create.error && (
            <ErrorNotice
              message={`${errorMessage(create.error)} If the request reached the server, a peer may already exist. Refresh the peer list before trying again.`}
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
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <Spinner /> : <Plus />}
              {create.isPending ? 'Creating peer…' : 'Create peer'}
            </Button>
          </div>
        </form>
      ) : (
        <div className="dialog-body">
          <div className="created-summary">
            <span className="status-badge healthy">Peer created</span>
            <code>{created.allowed_ips.join(', ')}</code>
          </div>
          {created.private_key ? (
            <>
              <div className="notice">
                <KeyRound size={18} />
                <span>
                  Save this configuration before closing. The API returns the
                  private key only once.
                </span>
              </div>
              {configQuery.isPending && (
                <div className="loading-inline">
                  <Spinner /> Preparing your configuration…
                </div>
              )}
              {(configQuery.error || configError) && (
                <>
                  <ErrorNotice
                    message={`${configError || errorMessage(configQuery.error)} Your peer was created successfully. Retry the configuration request or save the creation response below to keep its private key.`}
                  />
                  <div className="button-row">
                    <Button
                      variant="outline"
                      disabled={configQuery.isFetching}
                      onClick={() => {
                        void configQuery.refetch()
                      }}
                    >
                      <RefreshCw />
                      Retry configuration
                    </Button>
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
              )}
              {config && (
                <>
                  <div className="config-preview">
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
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="notice">
              Your peer uses the public key you provided. Configure its private
              key on your device; you can view the server’s partial
              configuration in peer details.
            </div>
          )}
          <details className="advanced">
            <summary>Peer public key</summary>
            <code className="full-key">{created.public_key}</code>
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
