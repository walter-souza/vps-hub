import { ArrowDown, ArrowUp, CheckCircle2, Copy, XCircle } from 'lucide-react'
import { Button } from '../../components/ui'
import { formatSize } from '../../lib/format'
import { useApp } from '../../lib/store'

export function Transfers({ vpsId }: { vpsId: string }) {
  const all = useApp((s) => s.transfers)
  const clear = useApp((s) => s.clearTransfers)
  const items = all.filter((t) => t.vpsId === vpsId)

  if (items.length === 0) {
    return <div className="flex h-full items-center justify-center text-muted">Nenhuma transferência ainda. Arraste arquivos do Windows para a lista para enviar.</div>
  }
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center justify-end px-2">
        <Button size="sm" variant="ghost" onClick={() => clear(vpsId)}>
          Limpar concluídas
        </Button>
      </div>
      <ul className="min-h-0 flex-1 overflow-auto px-3 pb-2">
        {items.map((t) => {
          const pct = t.total > 0 ? Math.min(100, (t.transferred / t.total) * 100) : 100
          return (
            <li key={t.id} className="flex items-center gap-3 border-b border-line/60 py-1.5">
              {t.direction === 'up' ? (
                <ArrowUp size={14} className="text-accent" />
              ) : t.direction === 'down' ? (
                <ArrowDown size={14} className="text-ok" />
              ) : (
                <Copy size={14} className="text-warn" />
              )}
              <span className="w-64 truncate" title={t.name}>
                {t.name}
              </span>
              <div className="h-1.5 flex-1 overflow-hidden rounded bg-panel-2">
                <div
                  className={`h-full ${t.status === 'error' ? 'bg-danger' : t.status === 'done' ? 'bg-ok' : 'bg-accent'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="w-36 text-right text-xs text-muted">
                {formatSize(t.transferred)} / {formatSize(t.total)}
              </span>
              <span className="w-5">
                {t.status === 'done' && <CheckCircle2 size={14} className="text-ok" />}
                {t.status === 'error' && (
                  <span title={t.error}>
                    <XCircle size={14} className="text-danger" />
                  </span>
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
