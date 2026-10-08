import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ArrowRight, LockKeyhole, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { ErrorNotice, Spinner } from '@/components/ui/feedback'
import { api, errorMessage } from '@/lib/api-client'
import { normalizeApiUrl, type ServerConnection } from '@/lib/api-types'

export function ServerForm({
  server,
  servers,
  onSave,
  onRemove,
  onClose,
}: {
  server?: ServerConnection
  servers: ServerConnection[]
  onSave: (server: ServerConnection) => void
  onRemove: (id: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState(server?.name ?? '')
  const [url, setUrl] = useState(server?.url ?? '')
  const [token, setToken] = useState(server?.token ?? '')
  const [validation, setValidation] = useState('')
  const [removing, setRemoving] = useState(false)
  const connection = useMutation({
    mutationFn: async (candidate: ServerConnection) => {
      await api.testConnection(candidate)
      return candidate
    },
    onSuccess: (candidate) => {
      onSave(candidate)
      onClose()
    },
    retry: false,
    gcTime: 0,
  })

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setValidation('')
    try {
      const normalizedUrl = normalizeApiUrl(url)
      if (
        servers.some(
          (item) => item.id !== server?.id && item.url === normalizedUrl,
        )
      )
        throw new Error('This API URL is already in your workspace.')
      if (!name.trim() || !token.trim())
        throw new Error('Enter a server name and API token.')
      connection.mutate({
        id: server?.id ?? crypto.randomUUID(),
        name: name.trim(),
        url: normalizedUrl,
        token: token.trim(),
        session: crypto.randomUUID(),
      })
    } catch (error) {
      setValidation(errorMessage(error))
    }
  }

  return (
    <Dialog
      title={
        server
          ? server.token
            ? 'Connection settings'
            : 'Unlock server'
          : 'Add a server'
      }
      description={
        server
          ? `Manage the connection to ${server.name}.`
          : 'Bring your WireGuard servers into one workspace.'
      }
      onClose={onClose}
      busy={connection.isPending}
    >
      {removing && server ? (
        <div className="dialog-body">
          <div className="notice">
            Remove <strong>{server.name}</strong> from this browser? Its
            WireGuard peers will stay on the server.
          </div>
          <div className="dialog-actions">
            <Button variant="outline" onClick={() => setRemoving(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                onRemove(server.id)
                onClose()
              }}
            >
              <Trash2 />
              Remove connection
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="dialog-body">
          <fieldset disabled={connection.isPending}>
            <label className="field">
              Server name
              <input
                autoComplete="off"
                maxLength={80}
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Amsterdam"
              />
            </label>
            <label className="field">
              API URL
              <input
                type="url"
                autoComplete="url"
                required
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://vpn.example.com"
              />
              <span className="field-hint">
                The HTTP API address, not the WireGuard VPN endpoint.
              </span>
            </label>
            <label className="field">
              API token
              <input
                type="password"
                autoComplete="off"
                required
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="Enter your X-API-Token"
              />
            </label>
          </fieldset>
          <div className="notice notice-subtle">
            <LockKeyhole size={17} />
            <span>
              Your token stays in memory for this session. Only the server name
              and URL are saved in this browser.
            </span>
          </div>
          {(validation || connection.error) && (
            <ErrorNotice
              message={validation || errorMessage(connection.error)}
            />
          )}
          <ServerFormActions
            pending={connection.isPending}
            canRemove={!!server}
            onRemove={() => setRemoving(true)}
            onClose={onClose}
          />
        </form>
      )}
    </Dialog>
  )
}

function ServerFormActions({
  pending,
  canRemove,
  onRemove,
  onClose,
}: {
  pending: boolean
  canRemove: boolean
  onRemove: () => void
  onClose: () => void
}) {
  return (
    <div className="dialog-actions">
      {canRemove && (
        <Button
          variant="ghost"
          disabled={pending}
          onClick={onRemove}
          aria-label="Remove server connection"
        >
          <Trash2 />
        </Button>
      )}
      <Button variant="outline" disabled={pending} onClick={onClose}>
        Cancel
      </Button>
      <Button type="submit" disabled={pending}>
        {pending ? <Spinner /> : <ArrowRight />}
        {pending ? 'Testing connection…' : 'Test & save'}
      </Button>
    </div>
  )
}
