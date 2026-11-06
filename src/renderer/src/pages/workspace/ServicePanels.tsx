import { FileText, Play, RefreshCw, RotateCw, ScrollText, Square, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ContainerInfo, LogSource, ServiceUnit } from '../../../../shared/types'
import { Button } from '../../components/ui'
import { api, errMsg } from '../../lib/api'
import { confirm } from '../../lib/dialogs'
import { toast } from '../../lib/store'

const REFRESH_MS = 5000

/** Carrega uma lista e a atualiza a cada 5 s enquanto `active`; devolve também um "recarregar agora". */
function useList<T>(load: () => Promise<T[]>, active: boolean) {
  const [items, setItems] = useState<T[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loadRef = useRef(load)
  loadRef.current = load
  const reload = useCallback(async () => {
    try {
      setItems(await loadRef.current())
      setError(null)
    } catch (e) {
      setError(errMsg(e))
    }
  }, [])
  useEffect(() => {
    if (!active) return
    reload()
    const timer = setInterval(reload, REFRESH_MS)
    return () => clearInterval(timer)
  }, [active, reload])
  return { items, error, reload }
}

const GOOD = new Set(['active', 'running', 'up'])
const BAD = new Set(['failed', 'dead', 'exited', 'restarting'])

export function Badge({ state, text }: { state: string; text?: string }) {
  const tone = GOOD.has(state) ? 'bg-ok/20 text-ok' : state === 'failed' ? 'bg-danger/20 text-danger' : BAD.has(state) ? 'bg-warn/20 text-warn' : 'bg-panel-2 text-muted'
  return <span className={`inline-block rounded px-1.5 py-0.5 text-xs ${tone}`}>{text ?? state}</span>
}

export function IconButton({ label, icon: Icon, onClick, disabled, danger }: { label: string; icon: typeof Play; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`rounded p-1 hover:bg-hover disabled:opacity-30 ${danger ? 'text-danger' : 'text-muted hover:text-fg'}`}
    >
      <Icon size={14} />
    </button>
  )
}

export function Toolbar({ children, onRefresh, count }: { children?: ReactNode; onRefresh: () => void; count: string }) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
      {children}
      <div className="flex-1" />
      <span className="text-xs text-muted">{count}</span>
      <Button size="sm" variant="ghost" onClick={onRefresh} aria-label="Atualizar lista" title="Atualizar agora">
        <RefreshCw size={13} />
      </Button>
    </div>
  )
}

export function Message({ children, danger }: { children: ReactNode; danger?: boolean }) {
  return (
    <div className={`flex h-full items-center justify-center px-6 text-center whitespace-pre-line ${danger ? 'text-danger' : 'text-muted'}`} role={danger ? 'alert' : undefined}>
      {children}
    </div>
  )
}

export const inputClass = 'h-7 rounded-md border border-line bg-bg px-2 text-xs outline-none focus:border-accent'

// ---------- systemd ----------

type UnitFilter = 'all' | 'active' | 'failed' | 'inactive'

export function SystemdView({ vpsId, active, onOpenLive }: { vpsId: string; active: boolean; onOpenLive: (source: LogSource) => void }) {
  const { items, error, reload } = useList(useCallback(() => api.services.listUnits(vpsId), [vpsId]), active)
  const [filter, setFilter] = useState('')
  const [state, setState] = useState<UnitFilter>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [details, setDetails] = useState<{ name: string; text: string } | null>(null)

  const shown = useMemo(() => {
    const term = filter.trim().toLowerCase()
    return (items ?? []).filter(
      (u) => (state === 'all' || (state === 'inactive' ? u.active === 'inactive' : u.active === state)) && (!term || u.name.toLowerCase().includes(term) || u.description.toLowerCase().includes(term))
    )
  }, [items, filter, state])

  const act = async (u: ServiceUnit, action: Parameters<typeof api.services.unitAction>[2], label: string) => {
    if (
      (action === 'stop' || action === 'disable') &&
      !(await confirm({ title: `${label} ${u.name}?`, message: 'Se este serviço mantém o acesso ao servidor (como o sshd), você pode perder a conexão.', confirmLabel: label, danger: true }))
    )
      return
    setBusy(u.name)
    try {
      await api.services.unitAction(vpsId, u.name, action)
      toast('success', `${u.name}: ${label.toLowerCase()} concluído.`)
    } catch (e) {
      toast('error', errMsg(e))
    } finally {
      setBusy(null)
      reload()
    }
  }

  const showDetails = async (u: ServiceUnit) => {
    if (details?.name === u.name) return setDetails(null)
    setDetails({ name: u.name, text: 'Carregando…' })
    try {
      setDetails({ name: u.name, text: await api.services.unitStatus(vpsId, u.name) })
    } catch (e) {
      setDetails({ name: u.name, text: errMsg(e) })
    }
  }

  if (error && !items) return <Message danger>{error}</Message>
  if (!items) return <Message>Lendo serviços…</Message>
  const detailUnit = details ? items.find((u) => u.name === details.name) : undefined
  return (
    <div className="flex h-full flex-col">
      <Toolbar onRefresh={reload} count={`${shown.length} de ${items.length} serviços`}>
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar serviços" aria-label="Filtrar serviços" className={`${inputClass} w-56`} />
        <select value={state} onChange={(e) => setState(e.target.value as UnitFilter)} aria-label="Estado" className={inputClass}>
          <option value="all">Todos</option>
          <option value="active">Ativos</option>
          <option value="failed">Com falha</option>
          <option value="inactive">Inativos</option>
        </select>
        <Button size="sm" variant="ghost" onClick={() => onOpenLive({ kind: 'journal' })} title="Acompanha o journal do sistema inteiro">
          <ScrollText size={13} /> Journal ao vivo
        </Button>
      </Toolbar>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-panel text-muted">
            <tr>
              <th className="px-3 py-1.5 font-medium">Serviço</th>
              <th className="px-3 py-1.5 font-medium">Estado</th>
              <th className="px-3 py-1.5 font-medium">No boot</th>
              <th className="px-3 py-1.5 font-medium">Descrição</th>
              <th className="w-44 px-3 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {shown.map((u) => (
              <tr key={u.name} className="border-b border-line/60 hover:bg-hover/40" data-unit={u.name}>
                <td className="px-3 py-1.5 font-mono">{u.name}</td>
                <td className="px-3 py-1.5">
                  <Badge state={u.active} text={`${u.active} (${u.sub})`} />
                </td>
                <td className="px-3 py-1.5 text-muted">{u.enabled || '—'}</td>
                <td className="max-w-xs truncate px-3 py-1.5 text-muted" title={u.description}>
                  {u.description}
                </td>
                <td className="px-3 py-1.5">
                  <div className="flex justify-end gap-0.5">
                    <IconButton label={`Iniciar ${u.name}`} icon={Play} disabled={busy === u.name || u.active === 'active'} onClick={() => act(u, 'start', 'Iniciar')} />
                    <IconButton label={`Reiniciar ${u.name}`} icon={RotateCw} disabled={busy === u.name} onClick={() => act(u, 'restart', 'Reiniciar')} />
                    <IconButton label={`Parar ${u.name}`} icon={Square} disabled={busy === u.name || u.active === 'inactive'} onClick={() => act(u, 'stop', 'Parar')} danger />
                    <IconButton label={`Detalhes de ${u.name}`} icon={FileText} onClick={() => showDetails(u)} />
                    <IconButton label={`Logs ao vivo de ${u.name}`} icon={ScrollText} onClick={() => onOpenLive({ kind: 'journal', unit: u.name })} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <div className="p-6 text-center text-muted">Nenhum serviço encontrado.</div>}
      </div>
      {details && (
        <div className="max-h-[40%] shrink-0 overflow-auto border-t border-line bg-panel p-3" aria-label={`Detalhes de ${details.name}`} role="region">
          <div className="mb-1 flex items-center gap-2 text-xs">
            <span className="font-mono font-semibold">{details.name}</span>
            {detailUnit && (
              <Button size="sm" variant="ghost" onClick={() => act(detailUnit, detailUnit.enabled === 'enabled' ? 'disable' : 'enable', detailUnit.enabled === 'enabled' ? 'Desabilitar' : 'Habilitar')}>
                {detailUnit.enabled === 'enabled' ? 'Desabilitar no boot' : 'Habilitar no boot'}
              </Button>
            )}
            <div className="flex-1" />
            <Button size="sm" variant="ghost" onClick={() => setDetails(null)}>
              Fechar
            </Button>
          </div>
          <pre className="font-mono text-xs leading-5 whitespace-pre-wrap">{details.text}</pre>
        </div>
      )}
    </div>
  )
}

// ---------- Docker ----------

export function DockerView({ vpsId, active, onOpenLive }: { vpsId: string; active: boolean; onOpenLive: (source: LogSource) => void }) {
  const { items, error, reload } = useList(useCallback(() => api.services.listContainers(vpsId), [vpsId]), active)
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const shown = useMemo(() => {
    const term = filter.trim().toLowerCase()
    return (items ?? []).filter((c) => !term || c.name.toLowerCase().includes(term) || c.image.toLowerCase().includes(term))
  }, [items, filter])

  const act = async (c: ContainerInfo, action: Parameters<typeof api.services.containerAction>[2], label: string) => {
    if (
      (action === 'stop' || action === 'remove') &&
      !(await confirm({
        title: `${label} "${c.name}"?`,
        message: action === 'remove' ? 'O contêiner será removido (os volumes não). Esta ação não pode ser desfeita.' : 'O contêiner será parado.',
        confirmLabel: label,
        danger: true
      }))
    )
      return
    setBusy(c.name)
    try {
      await api.services.containerAction(vpsId, c.name, action)
      toast('success', `${c.name}: ${label.toLowerCase()} concluído.`)
    } catch (e) {
      toast('error', errMsg(e))
    } finally {
      setBusy(null)
      reload()
    }
  }

  if (error && !items) return <Message danger>{error}</Message>
  if (!items) return <Message>Lendo contêineres…</Message>
  return (
    <div className="flex h-full flex-col">
      <Toolbar onRefresh={reload} count={`${shown.length} de ${items.length} contêineres`}>
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar contêineres" aria-label="Filtrar contêineres" className={`${inputClass} w-56`} />
      </Toolbar>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-panel text-muted">
            <tr>
              <th className="px-3 py-1.5 font-medium">Contêiner</th>
              <th className="px-3 py-1.5 font-medium">Imagem</th>
              <th className="px-3 py-1.5 font-medium">Estado</th>
              <th className="px-3 py-1.5 font-medium">Portas</th>
              <th className="w-44 px-3 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.id + c.name} className="border-b border-line/60 hover:bg-hover/40" data-container={c.name}>
                <td className="px-3 py-1.5">
                  <div className="font-mono">{c.name}</div>
                  <div className="font-mono text-[11px] text-muted">{c.id}</div>
                </td>
                <td className="max-w-[14rem] truncate px-3 py-1.5 font-mono" title={c.image}>
                  {c.image}
                </td>
                <td className="px-3 py-1.5">
                  <Badge state={c.state} text={c.status || c.state} />
                </td>
                <td className="max-w-[16rem] truncate px-3 py-1.5 font-mono text-muted" title={c.ports}>
                  {c.ports || '—'}
                </td>
                <td className="px-3 py-1.5">
                  <div className="flex justify-end gap-0.5">
                    <IconButton label={`Iniciar ${c.name}`} icon={Play} disabled={busy === c.name || c.state === 'running'} onClick={() => act(c, 'start', 'Iniciar')} />
                    <IconButton label={`Reiniciar ${c.name}`} icon={RotateCw} disabled={busy === c.name} onClick={() => act(c, 'restart', 'Reiniciar')} />
                    <IconButton label={`Parar ${c.name}`} icon={Square} disabled={busy === c.name || c.state !== 'running'} onClick={() => act(c, 'stop', 'Parar')} danger />
                    <IconButton label={`Logs ao vivo de ${c.name}`} icon={ScrollText} onClick={() => onOpenLive({ kind: 'docker', container: c.name })} />
                    <IconButton label={`Remover ${c.name}`} icon={Trash2} disabled={busy === c.name} onClick={() => act(c, 'remove', 'Remover')} danger />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <div className="p-6 text-center text-muted">Nenhum contêiner encontrado.</div>}
      </div>
    </div>
  )
}
