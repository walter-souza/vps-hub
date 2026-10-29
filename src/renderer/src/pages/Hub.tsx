import { Copy, KeyRound, Lock, MoreVertical, Pencil, Plug, Plus, Search, Server, Trash2, Unplug } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react'
import type { VpsConnection } from '../../../shared/types'
import { ContextMenu, type MenuState } from '../components/ContextMenu'
import { Button } from '../components/ui'
import { api, errMsg } from '../lib/api'
import { connectVps } from '../lib/connect'
import { confirm } from '../lib/dialogs'
import { relativeTime } from '../lib/format'
import { toast, useApp } from '../lib/store'
import { ConnectionForm } from './ConnectionForm'

type Latency = number | null | undefined // undefined = medindo

export function Hub() {
  const connections = useApp((s) => s.connections)
  const sessions = useApp((s) => s.sessions)
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [form, setForm] = useState<{ conn?: VpsConnection; duplicate?: boolean } | null>(null)
  const [latency, setLatency] = useState<Record<string, Latency>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

  const ids = connections.map((c) => c.id).join(',')
  useEffect(() => {
    const probeAll = () =>
      ids.split(',').filter(Boolean).forEach((id) =>
        api.connections.probe(id).then((ms) => setLatency((l) => ({ ...l, [id]: ms })), () => {})
      )
    probeAll()
    const timer = setInterval(probeAll, 30_000)
    return () => clearInterval(timer)
  }, [ids])

  const tags = useMemo(() => [...new Set(connections.flatMap((c) => c.tags))].sort(), [connections])
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return connections
      .filter((c) => !tag || c.tags.includes(tag))
      .filter((c) => !q || [c.name, c.host, c.username, ...c.tags].some((v) => v.toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  }, [connections, query, tag])

  const connect = async (c: VpsConnection) => {
    if (busy) return
    setBusy(c.id)
    await connectVps(c)
    setBusy(null)
  }

  const confirmUnsaved = async (c: VpsConnection) => {
    const dirty = useApp.getState().dirty[c.id] ?? 0
    return (
      dirty === 0 ||
      confirm({
        title: 'Alterações não salvas',
        message: `${dirty} arquivo(s) de "${c.name}" têm alterações não salvas, que serão perdidas.`,
        confirmLabel: 'Descartar e continuar',
        danger: true
      })
    )
  }

  const disconnect = async (c: VpsConnection) => {
    if (!(await confirmUnsaved(c))) return
    await api.session.disconnect(c.id).catch(() => {})
    useApp.getState().sessionRemoved(c.id)
  }

  const remove = async (c: VpsConnection) => {
    const ok = await confirm({
      title: `Excluir "${c.name}"?`,
      message: 'A conexão e a senha salva serão removidas do VPS Hub. Nada é apagado na VPS.',
      confirmLabel: 'Excluir',
      danger: true
    })
    if (!ok || !(await confirmUnsaved(c))) return
    try {
      await api.connections.remove(c.id)
      useApp.getState().sessionRemoved(c.id)
      useApp.getState().removeConnection(c.id)
    } catch (e) {
      toast('error', errMsg(e))
    }
  }

  const openMenu = (e: MouseEvent, c: VpsConnection) => {
    e.preventDefault()
    e.stopPropagation()
    const connected = !!sessions[c.id]
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: connected ? 'Abrir' : 'Conectar', icon: Plug, onClick: () => connect(c) },
        ...(connected ? [{ label: 'Desconectar', icon: Unplug, onClick: () => disconnect(c) }] : []),
        'sep',
        { label: 'Editar', icon: Pencil, onClick: () => setForm({ conn: c }) },
        { label: 'Duplicar', icon: Copy, onClick: () => setForm({ conn: c, duplicate: true }) },
        'sep',
        { label: 'Excluir', icon: Trash2, danger: true, onClick: () => remove(c) }
      ]
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="drag flex h-10 shrink-0 items-center gap-3 border-b border-line pr-[150px] pl-4">
        <Server size={16} className="text-accent" />
        <span className="font-semibold">VPS Hub</span>
        <div className="no-drag relative ml-6 w-72">
          <Search size={14} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nome, host ou tag…"
            className="h-7 w-full rounded-md border border-line bg-panel pr-2 pl-8 text-xs outline-none focus:border-accent"
          />
        </div>
        <div className="flex-1" />
        <Button variant="primary" size="sm" onClick={() => setForm({})}>
          <Plus size={14} /> Nova VPS
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="w-48 shrink-0 border-r border-line p-2 text-[13px]" aria-label="Filtros">
          <FilterItem active={!tag} onClick={() => setTag(null)} label="Todas" count={connections.length} />
          {tags.length > 0 && <div className="mt-4 mb-1 px-2 text-[11px] font-semibold tracking-wide text-muted uppercase">Tags</div>}
          {tags.map((t) => (
            <FilterItem
              key={t}
              active={tag === t}
              onClick={() => setTag(t)}
              label={t}
              count={connections.filter((c) => c.tags.includes(t)).length}
            />
          ))}
        </nav>

        <main className="min-w-0 flex-1 overflow-auto p-6">
          {connections.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <Server size={40} className="text-muted" />
              <div className="text-base font-semibold">Nenhuma VPS cadastrada</div>
              <p className="max-w-sm text-muted">Adicione uma conexão SSH para navegar e editar os arquivos da sua VPS como no Explorer.</p>
              <Button variant="primary" onClick={() => setForm({})}>
                <Plus size={14} /> Adicionar VPS
              </Button>
            </div>
          ) : visible.length === 0 ? (
            <p className="text-muted">Nenhuma VPS corresponde ao filtro.</p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
              {visible.map((c) => (
                <Card
                  key={c.id}
                  conn={c}
                  connected={!!sessions[c.id] && !sessions[c.id].closed}
                  latency={latency[c.id]}
                  busy={busy === c.id}
                  onConnect={() => connect(c)}
                  onMenu={(e) => openMenu(e, c)}
                />
              ))}
            </div>
          )}
        </main>
      </div>

      {form && <ConnectionForm conn={form.conn} duplicate={form.duplicate} onClose={() => setForm(null)} />}
      {menu && <ContextMenu {...menu} onClose={closeMenu} />}
    </div>
  )
}

function FilterItem({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      onClick={onClick}
      className={`flex h-7 w-full items-center rounded px-2 text-left ${active ? 'bg-hover text-fg' : 'text-muted hover:bg-hover hover:text-fg'}`}
    >
      <span className="flex-1 truncate">{label}</span>
      <span className="text-[11px]">{count}</span>
    </button>
  )
}

interface CardProps {
  conn: VpsConnection
  connected: boolean
  latency: Latency
  busy: boolean
  onConnect: () => void
  onMenu: (e: MouseEvent) => void
}

function Card({ conn: c, connected, latency, busy, onConnect, onMenu }: CardProps) {
  const status = connected
    ? { dot: 'bg-ok', text: 'Conectado' }
    : latency === undefined
      ? { dot: 'bg-muted', text: 'Verificando…' }
      : latency === null
        ? { dot: 'bg-danger', text: 'Inacessível' }
        : { dot: 'bg-ok/60', text: `Online · ${latency} ms` }
  return (
    <div
      onDoubleClick={onConnect}
      onContextMenu={onMenu}
      className="group flex flex-col overflow-hidden rounded-lg border border-line bg-panel transition-colors hover:border-[#3a4250]"
    >
      <div className="h-1" style={{ background: c.color }} />
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold">{c.name}</div>
            <div className="truncate font-mono text-xs text-muted">
              {c.username}@{c.host}
              {c.port !== 22 && `:${c.port}`}
            </div>
          </div>
          <button aria-label="Mais ações" onClick={onMenu} className="rounded p-1 text-muted hover:bg-hover hover:text-fg">
            <MoreVertical size={16} />
          </button>
        </div>

        <div className="mt-3 flex items-center gap-2 text-xs text-muted">
          <span className={`h-2 w-2 rounded-full ${status.dot}`} />
          <span>{status.text}</span>
          <span className="ml-auto flex items-center gap-1" title={c.auth === 'key' ? 'Chave SSH' : 'Senha'}>
            {c.auth === 'key' ? <KeyRound size={12} /> : <Lock size={12} />}
          </span>
        </div>

        {c.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {c.tags.map((t) => (
              <span key={t} className="rounded bg-panel-2 px-1.5 py-0.5 text-[11px] text-muted">
                {t}
              </span>
            ))}
          </div>
        )}

        <div className="mt-auto flex items-center gap-2 pt-4">
          <Button variant={connected ? 'default' : 'primary'} size="sm" onClick={onConnect} disabled={busy}>
            <Plug size={13} /> {busy ? 'Conectando…' : connected ? 'Abrir' : 'Conectar'}
          </Button>
          <span className="ml-auto text-[11px] text-muted">
            {c.lastConnectedAt ? `Último acesso ${relativeTime(c.lastConnectedAt)}` : 'Nunca acessada'}
          </span>
        </div>
      </div>
    </div>
  )
}
