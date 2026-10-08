import { useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { ErrorNotice, Spinner } from '@/components/ui/feedback'
import type { ServerConnection, ServerMetadata } from '@/lib/api-types'
import { downloadText } from '@/lib/client-config'
import { errorMessage } from '@/lib/api-client'
import {
  exportServers,
  maxServerImportBytes,
  parseServerImport,
} from '@/lib/server-transfer'

export function ServerTransferDialog({
  servers,
  onImport,
  onClose,
}: {
  servers: ServerConnection[]
  onImport: (servers: ServerMetadata[]) => void
  onClose: () => void
}) {
  const [candidates, setCandidates] = useState<ServerMetadata[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const existingUrls = new Set(servers.map((server) => server.url))
  const added =
    candidates?.filter((server) => !existingUrls.has(server.url)).length ?? 0

  async function readFile(file?: File) {
    setCandidates(null)
    setError('')
    if (!file) return
    setBusy(true)
    try {
      if (file.size > maxServerImportBytes)
        throw new Error('The server file must be no larger than 1 MiB.')
      setCandidates(parseServerImport(await file.text()))
    } catch (issue) {
      setError(errorMessage(issue))
    } finally {
      setBusy(false)
    }
  }

  function download() {
    setError('')
    try {
      downloadText(exportServers(servers), 'wireguard-servers.json')
    } catch {
      setError(
        'These connections could not be exported. Check their URLs and the 250-entry export limit.',
      )
    }
  }

  return (
    <Dialog
      title="Import / export servers"
      description="Move your connection list between browsers or keep a local backup."
      onClose={onClose}
      busy={busy}
    >
      <div className="dialog-body">
        <div className="notice notice-subtle">
          Exports contain server names, URLs and IDs only. API tokens, private
          keys and session data are never included.
        </div>
        <section className="transfer-section">
          <h3>Export connections</h3>
          <p>
            Download {servers.length} saved{' '}
            {servers.length === 1 ? 'connection' : 'connections'} as a JSON
            file.
          </p>
          <Button
            variant="outline"
            disabled={servers.length === 0 || busy}
            onClick={download}
          >
            <Download />
            Export servers
          </Button>
        </section>
        <section className="transfer-section">
          <h3>Import connections</h3>
          <p>
            Merge a metadata export with your list. Existing URLs are skipped;
            new connections start locked.
          </p>
          <label className="field">
            Server metadata file
            <input
              type="file"
              accept=".json,application/json"
              disabled={busy}
              onChange={(event) => {
                void readFile(event.target.files?.[0])
              }}
            />
          </label>
        </section>
        {busy && (
          <div className="loading-inline">
            <Spinner />
            Reading server file…
          </div>
        )}
        {error && <ErrorNotice message={error} />}
        {candidates && (
          <div className="notice" role="status">
            {added} new {added === 1 ? 'connection' : 'connections'} ·{' '}
            {candidates.length - added} already registered. Existing connection
            settings and tokens will be preserved.
          </div>
        )}
        <div className="dialog-actions">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Close
          </Button>
          <Button
            disabled={!candidates || added === 0 || busy}
            onClick={() => {
              if (candidates) {
                onImport(candidates)
                onClose()
              }
            }}
          >
            <Upload />
            Import servers
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
