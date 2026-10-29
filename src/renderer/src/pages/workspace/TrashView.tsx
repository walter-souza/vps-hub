import { Loader2, RotateCcw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { TrashItem } from '../../../../shared/types'
import { FileIcon } from '../../components/FileIcon'
import { Button } from '../../components/ui'
import { api, errMsg } from '../../lib/api'
import { confirm } from '../../lib/dialogs'
import { formatSize } from '../../lib/format'
import { toast } from '../../lib/store'

const COLS = 'grid grid-cols-[minmax(180px,1fr)_minmax(200px,1.4fr)_130px_90px]'
const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

export function TrashView({ vpsId, onRestored }: { vpsId: string; onRestored: () => void }) {
  const [items, setItems] = useState<TrashItem[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setItems(await api.trash.list(vpsId))
      setSelected(new Set())
    } catch (e) {
      toast('error', errMsg(e))
      setItems([])
    }
  }, [vpsId])

  useEffect(() => {
    load()
  }, [load])

  const chosen = (items ?? []).filter((i) => selected.has(i.id))

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toast('error', errMsg(e))
    } finally {
      await load()
      setBusy(false)
    }
  }

  const restore = () =>
    act(async () => {
      await api.trash.restore(vpsId, chosen.map((i) => i.id))
      toast('success', `${chosen.length} item(ns) restaurado(s).`)
      onRestored()
    })

  const purge = async (all: boolean) => {
    const list = all ? (items ?? []) : chosen
    const ok = await confirm({
      title: all ? 'Esvaziar a lixeira?' : `Excluir ${list.length} item(ns) permanentemente?`,
      message: 'Os itens serão apagados da VPS. Não há como desfazer.',
      detail: list.map((i) => i.originalPath || i.name),
      confirmLabel: all ? 'Esvaziar lixeira' : 'Excluir permanentemente',
      danger: true
    })
    if (ok) await act(() => api.trash.purge(vpsId, all ? undefined : list.map((i) => i.id)))
  }

  const toggle = (id: string, additive: boolean) =>
    setSelected((s) => {
      const next = new Set(additive ? s : [])
      if (additive && s.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
        <Trash2 size={15} className="text-muted" />
        <span className="font-semibold">Lixeira</span>
        <span className="text-xs text-muted">Itens excluídos desta VPS ficam em ~/.vpshub-trash até você esvaziar.</span>
        <div className="flex-1" />
        <Button size="sm" onClick={restore} disabled={busy || chosen.length === 0}>
          <RotateCcw size={13} /> Restaurar
        </Button>
        <Button size="sm" onClick={() => purge(false)} disabled={busy || chosen.length === 0}>
          Excluir permanentemente
        </Button>
        <Button size="sm" variant="danger" onClick={() => purge(true)} disabled={busy || !items?.length}>
          Esvaziar lixeira
        </Button>
      </div>
      <div className={`${COLS} h-7 shrink-0 items-center border-b border-line px-2 text-[11px] font-medium text-muted`}>
        <span className="px-2">Nome</span>
        <span className="px-2">Local original</span>
        <span className="px-2">Excluído em</span>
        <span className="px-2 text-right">Tamanho</span>
      </div>
      <div role="listbox" aria-multiselectable="true" aria-label="Itens na lixeira" className="min-h-0 flex-1 overflow-auto">
        {items === null && (
          <div className="flex items-center justify-center gap-2 py-16 text-muted">
            <Loader2 size={14} className="animate-spin" /> Carregando…
          </div>
        )}
        {items?.length === 0 && <div className="py-16 text-center text-muted">A lixeira está vazia.</div>}
        {items?.map((i) => (
          <div
            key={i.id}
            role="option"
            aria-selected={selected.has(i.id)}
            onMouseDown={(e) => e.button === 0 && toggle(i.id, e.ctrlKey)}
            className={`${COLS} h-7 cursor-default items-center px-2 ${selected.has(i.id) ? 'bg-accent/25' : 'hover:bg-hover'}`}
          >
            <div className="flex min-w-0 items-center gap-2 px-2">
              <FileIcon entry={{ name: i.name, path: '', type: i.isDir ? 'dir' : 'file', isDir: i.isDir, size: i.size, mtime: 0, perms: '', owner: '' }} />
              <span className="truncate">{i.name}</span>
            </div>
            <span className="truncate px-2 font-mono text-xs text-muted" title={i.originalPath}>
              {i.originalPath || 'desconhecido'}
            </span>
            <span className="px-2 text-xs text-muted">{dateFmt.format(i.deletedAt)}</span>
            <span className="px-2 text-right text-xs text-muted">{i.isDir ? '' : formatSize(i.size)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
