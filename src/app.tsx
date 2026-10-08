import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  Globe2,
  LayoutDashboard,
  LockKeyhole,
  Network,
  Plus,
  Server,
  ShieldCheck,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api, serverQueryKey } from '@/lib/api-client'
import type { ServerConnection } from '@/lib/api-types'
import { useServerRegistry } from '@/hooks/use-server-registry'
import { ServerForm } from '@/features/servers/server-form'
import { ServerDashboard } from '@/features/dashboard/server-dashboard'
import './app.css'

function ServerItem({
  server,
  selected,
  onSelect,
}: {
  server: ServerConnection
  selected: boolean
  onSelect: () => void
}) {
  const health = useQuery({
    queryKey: [...serverQueryKey(server), 'readiness'],
    queryFn: ({ signal }) => api.ready(server, signal),
    enabled: !!server.token,
    refetchInterval: 30_000,
  })
  const status = !server.token
    ? 'Locked'
    : health.isPending
      ? 'Checking'
      : health.error
        ? 'Unreachable'
        : health.data.status === 'ready'
          ? 'Ready'
          : 'Not ready'
  return (
    <button
      className={`server-nav-item ${selected ? 'selected' : ''}`}
      aria-current={selected ? 'page' : undefined}
      onClick={onSelect}
    >
      <Server size={17} />
      <span>
        <strong>{server.name}</strong>
        <small>{status}</small>
      </span>
      <span
        className={`status-dot ${status === 'Ready' ? 'dot-green' : status === 'Locked' || status === 'Checking' ? '' : 'dot-amber'}`}
      />
    </button>
  )
}

export default function App() {
  const registry = useServerRegistry()
  const [serverDialog, setServerDialog] = useState<{
    server?: ServerConnection
  } | null>(null)
  const [notice, setNotice] = useState('')
  const selected = registry.selected

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Workspace navigation">
        <a className="brand" href="./">
          <span className="brand-mark">
            <Network size={23} strokeWidth={1.8} />
          </span>
          <span>
            wireguard<span className="brand-subtitle">BOARD</span>
          </span>
        </a>
        <div className="workspace-label">
          <span className="workspace-avatar">W</span>
          <div>
            <strong>My workspace</strong>
            <span>Personal network</span>
          </div>
          <ShieldCheck size={17} />
        </div>
        <div className="sidebar-section-label">WORKSPACE</div>
        <div className="overview-nav">
          <LayoutDashboard size={18} />
          <span>Overview</span>
          <span className="count-tag">{registry.servers.length}</span>
        </div>
        <div className="sidebar-section-label server-label">
          YOUR SERVERS
          <button
            className="icon-button"
            aria-label="Add server"
            onClick={() => setServerDialog({})}
          >
            <Plus size={16} />
          </button>
        </div>
        <nav className="server-list" aria-label="Servers">
          {registry.servers.map((server) => (
            <ServerItem
              key={`${server.id}:${server.session}`}
              server={server}
              selected={server.id === registry.selectedId}
              onSelect={() => {
                registry.select(server.id)
                setNotice('')
              }}
            />
          ))}
          {registry.servers.length === 0 && (
            <p className="sidebar-empty">Your servers will appear here.</p>
          )}
        </nav>
        <button className="add-server-link" onClick={() => setServerDialog({})}>
          <Plus size={16} />
          Add server
        </button>
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <Globe2 size={20} />
            <strong>One board. Every server.</strong>
            <p>Connect your infrastructure, wherever it lives.</p>
          </div>
          <a
            href="https://github.com/ragnarok22/wireguard-api#usage"
            target="_blank"
            rel="noreferrer"
          >
            API documentation
            <ExternalLink size={14} />
          </a>
          <span className="sidebar-version">
            WIREGUARD BOARD <span>v0.1</span>
          </span>
        </div>
      </aside>
      <div className="main-shell">
        <div className="topbar">
          <div>
            Workspace
            <ChevronRight size={14} />
            <strong>Overview</strong>
          </div>
          <span>
            <ShieldCheck size={15} />
            Your network, simplified
          </span>
        </div>
        <main id="main-content" tabIndex={-1}>
          {registry.warning && (
            <div className="notice" role="status">
              {registry.warning}
            </div>
          )}
          {notice && (
            <div className="notice notice-success" role="status">
              <CheckCircle2 size={18} />
              <span>{notice}</span>
              <button
                className="icon-button"
                aria-label="Dismiss notification"
                onClick={() => setNotice('')}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {selected ? (
            selected.token ? (
              <ServerDashboard
                key={`${selected.id}:${selected.session}`}
                server={selected}
                onSettings={() => setServerDialog({ server: selected })}
                onLock={() => {
                  registry.lock(selected.id)
                  setNotice(
                    'Server locked. Its API token has been cleared from the active connection.',
                  )
                }}
                onNotice={setNotice}
              />
            ) : (
              <>
                <header className="page-heading">
                  <div>
                    <div className="eyebrow">SERVER OVERVIEW</div>
                    <h1>{selected.name}</h1>
                    <p>{selected.url}</p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => setServerDialog({ server: selected })}
                  >
                    Connection settings
                  </Button>
                </header>
                <section className="welcome-panel locked-panel">
                  <span className="welcome-icon">
                    <LockKeyhole size={35} />
                  </span>
                  <div className="eyebrow">SESSION LOCKED</div>
                  <h2>Let’s reconnect.</h2>
                  <p>
                    Enter this server’s API token to view and manage its peers.
                    <br />
                    Your credentials are never saved in browser storage.
                  </p>
                  <Button onClick={() => setServerDialog({ server: selected })}>
                    <LockKeyhole />
                    Unlock server
                  </Button>
                  <div className="welcome-meta">
                    <ShieldCheck size={16} />
                    Connection details saved · Token required each session
                  </div>
                </section>
              </>
            )
          ) : (
            <>
              <header className="page-heading">
                <div>
                  <div className="eyebrow">YOUR NETWORK, SIMPLIFIED</div>
                  <h1>A home for your connections.</h1>
                  <p>
                    Manage your WireGuard servers from one quiet corner of the
                    web.
                  </p>
                </div>
                <span className="workspace-badge">
                  <span className="status-dot" />
                  Ready to connect
                </span>
              </header>
              <section className="welcome-panel">
                <div className="network-illustration" aria-hidden="true">
                  <span className="orbit-node node-one">
                    <Server size={20} />
                  </span>
                  <span className="orbit-node node-two">
                    <FileIcon />
                  </span>
                  <span className="orbit-node node-three">
                    <Globe2 size={20} />
                  </span>
                  <span className="welcome-icon">
                    <Network size={39} strokeWidth={1.5} />
                  </span>
                </div>
                <div className="eyebrow">START WITH A SERVER</div>
                <h2>
                  Your network.
                  <br />A clearer view.
                </h2>
                <p>
                  Add a WireGuard API connection to see your peers,
                  <br />
                  create configurations and keep everything in reach.
                </p>
                <Button onClick={() => setServerDialog({})}>
                  <Plus />
                  Add your first server
                  <ArrowRight />
                </Button>
                <div className="welcome-meta">
                  <LockKeyhole size={15} />
                  Session-only tokens <span>·</span>
                  <Server size={15} />
                  Multiple servers
                </div>
              </section>
              <section className="getting-started">
                <div>
                  <span>01</span>
                  <strong>Connect a server</strong>
                  <p>Give it a name, API URL and token.</p>
                </div>
                <div>
                  <span>02</span>
                  <strong>Add your devices</strong>
                  <p>Create a peer with one simple action.</p>
                </div>
                <div>
                  <span>03</span>
                  <strong>Take your config</strong>
                  <p>Download a file or scan its QR code.</p>
                </div>
              </section>
              <div className="overview-footnote">
                <span>
                  <ShieldCheck size={14} />
                  Built for your infrastructure. Powered by WireGuard.
                </span>
                <a
                  href="https://github.com/ragnarok22/wireguard-api"
                  target="_blank"
                  rel="noreferrer"
                >
                  Meet the API
                  <ExternalLink size={13} />
                </a>
              </div>
            </>
          )}
        </main>
      </div>
      {serverDialog && (
        <ServerForm
          server={serverDialog.server}
          servers={registry.servers}
          onSave={(server) => {
            registry.save(server)
            setNotice(`Connected to ${server.name}.`)
          }}
          onRemove={(id) => {
            registry.remove(id)
            setNotice('Server connection removed from this workspace.')
          }}
          onClose={() => setServerDialog(null)}
        />
      )}
    </div>
  )
}

function FileIcon() {
  return <ShieldCheck size={20} />
}
