import { ClipboardCopy, Play, Square, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { TunnelStatus } from '../../../../shared/types'
import { Button } from '../../components/ui'
import { api, errMsg } from '../../lib/api'
import { toast, useApp } from '../../lib/store'
import { Badge, IconButton, inputClass } from './ServicePanels'

const REFRESH_MS = 2000
const STOPPED: TunnelStatus = { running: false, active: 0, total: 0 }

/** Túneis de porta: abre uma porta no seu computador (127.0.0.1) que leva até um host:porta alcançado pela VPS. */
export function TunnelsView({ vpsId, active }: { vpsId: string; active: boolean }) {
  const tunnels = useApp((s) => s.connections.find((c) => c.id === vpsId)?.tunnels ?? [])
  const upsert = useApp((s) => s.upsertConnection)
  const [status, setStatus] = useState<Record<string, TunnelStatus>>({})
  const [form, setForm] = useState({ localPort: '', remoteHost: 'localhost', remotePort: '' })

  const reload = useCallback(async () => {
    try {
      setStatus(await api.tunnels.status(vpsId))
    } catch {
      // sem conexão: os túneis aparecem parados
    }
  }, [vpsId])
  useEffect(() => {
    if (!active) return
    reload()
    const timer = setInterval(reload, REFRESH_MS)
    return () => clearInterval(timer)
  }, [active, reload])

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch (e) {
      toast('error', errMsg(e))
    }
    reload()
  }

  const add = (e: FormEvent) => {
    e.preventDefault()
    return run(async () => {
      upsert(await api.tunnels.add(vpsId, { localPort: Number(form.localPort), remoteHost: form.remoteHost, remotePort: Number(form.remotePort) }))
      setForm((f) => ({ ...f, localPort: '', remotePort: '' }))
    })
  }

  return (
    <div className="flex h-full flex-col">
      <form onSubmit={add} className="flex shrink-0 flex-wrap items-end gap-2 border-b border-line px-3 py-2 text-xs">
        <label className="flex flex-col gap-1 text-muted">
          Porta local
          <input value={form.localPort} onChange={(e) => setForm({ ...form, localPort: e.target.value })} inputMode="numeric" placeholder="5433" aria-label="Porta local" className={`${inputClass} w-24`} />
        </label>
        <label className="flex flex-col gap-1 text-muted">
          Host de destino (visto pela VPS)
          <input value={form.remoteHost} onChange={(e) => setForm({ ...form, remoteHost: e.target.value })} placeholder="localhost" aria-label="Host de destino" spellCheck={false} className={`${inputClass} w-56`} />
        </label>
        <label className="flex flex-col gap-1 text-muted">
          Porta de destino
          <input value={form.remotePort} onChange={(e) => setForm({ ...form, remotePort: e.target.value })} inputMode="numeric" placeholder="5432" aria-label="Porta de destino" className={`${inputClass} w-24`} />
        </label>
        <Button type="submit" size="sm" variant="primary">
          Adicionar túnel
        </Button>
        <span className="basis-full text-muted">Só este computador enxerga a porta local (127.0.0.1). Os túneis valem enquanto a conexão estiver aberta.</span>
      </form>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-panel text-muted">
            <tr>
              <th className="px-3 py-1.5 font-medium">Endereço local</th>
              <th className="px-3 py-1.5 font-medium">Destino</th>
              <th className="px-3 py-1.5 font-medium">Estado</th>
              <th className="w-28 px-3 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {tunnels.map((t) => {
              const st = status[t.id] ?? STOPPED
              const address = `127.0.0.1:${t.localPort}`
              return (
                <tr key={t.id} className="border-b border-line/60 hover:bg-hover/40" data-tunnel={t.localPort}>
                  <td className="px-3 py-1.5 font-mono">{address}</td>
                  <td className="px-3 py-1.5 font-mono">
                    {t.remoteHost}:{t.remotePort}
                  </td>
                  <td className="px-3 py-1.5">
                    <Badge state={st.running ? 'running' : 'stopped'} text={st.running ? `ativo · ${st.active} conexão(ões) · ${st.total} no total` : 'parado'} />
                    {st.error && <div className="mt-0.5 text-warn">Último erro: {st.error}</div>}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex justify-end gap-0.5">
                      {st.running ? (
                        <IconButton label={`Parar túnel ${t.localPort}`} icon={Square} onClick={() => run(() => api.tunnels.stop(vpsId, t.id))} />
                      ) : (
                        <IconButton label={`Iniciar túnel ${t.localPort}`} icon={Play} onClick={() => run(() => api.tunnels.start(vpsId, t.id))} />
                      )}
                      <IconButton label={`Copiar endereço ${t.localPort}`} icon={ClipboardCopy} onClick={() => navigator.clipboard.writeText(address).then(() => toast('info', 'Endereço copiado.'))} />
                      <IconButton label={`Remover túnel ${t.localPort}`} icon={Trash2} danger onClick={() => run(async () => upsert(await api.tunnels.remove(vpsId, t.id)))} />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {tunnels.length === 0 && <div className="p-6 text-center text-muted">Nenhum túnel. Exemplo: porta local 5433 → localhost:5432 para acessar um PostgreSQL da VPS.</div>}
      </div>
    </div>
  )
}
