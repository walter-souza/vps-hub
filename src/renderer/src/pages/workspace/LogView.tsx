import { Pause, Play, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { TailContent } from '../../../../shared/types'
import { Button } from '../../components/ui'
import { api, errMsg } from '../../lib/api'
import { formatSize } from '../../lib/format'

const REFRESH_MS = 2000
/** Distância do fim (px) até a qual a leitura continua "grudada" nas linhas novas. */
const STICKY_PX = 40

/** Final de um arquivo grande (log): somente leitura, com "seguir" (como tail -f) e filtro por texto. */
export function LogView({ vpsId, path }: { vpsId: string; path: string }) {
  const [tail, setTail] = useState<TailContent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [follow, setFollow] = useState(true)
  const [filter, setFilter] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  const load = useCallback(async () => {
    try {
      setTail(await api.fs.readTail(vpsId, path))
      setError(null)
    } catch (e) {
      setError(errMsg(e))
    }
  }, [vpsId, path])

  useEffect(() => {
    load()
  }, [load])
  useEffect(() => {
    if (!follow) return
    const timer = setInterval(load, REFRESH_MS)
    return () => clearInterval(timer)
  }, [follow, load])

  const lines = useMemo(() => {
    const all = (tail?.content ?? '').split('\n')
    if (all.at(-1) === '') all.pop()
    const term = filter.trim().toLowerCase()
    return term ? all.filter((l) => l.toLowerCase().includes(term)) : all
  }, [tail, filter])

  // Se a pessoa estava no fim, acompanha as linhas novas; se subiu para ler, não puxa de volta.
  useLayoutEffect(() => {
    const el = box.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [lines])

  return (
    <div className="absolute inset-0 flex flex-col bg-bg">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3 text-xs">
        <span className="truncate font-mono text-muted" title={path}>
          {path}
        </span>
        {tail && (
          <span className="shrink-0 text-muted">
            {tail.truncated ? `últimos ${formatSize(tail.content.length)} de ${formatSize(tail.size)}` : formatSize(tail.size)} · somente leitura
          </span>
        )}
        <div className="flex-1" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrar linhas"
          aria-label="Filtrar linhas"
          className="h-7 w-44 rounded-md border border-line bg-bg px-2 outline-none focus:border-accent"
        />
        <Button size="sm" variant="ghost" onClick={() => setFollow((f) => !f)} aria-pressed={follow} title="Atualiza a cada 2 s, como tail -f">
          {follow ? <Pause size={13} /> : <Play size={13} />} Seguir
        </Button>
        <Button size="sm" variant="ghost" onClick={load} aria-label="Atualizar" title="Atualizar agora">
          <RefreshCw size={13} />
        </Button>
      </div>
      {error ? (
        <div className="m-auto text-danger" role="alert">
          {error}
        </div>
      ) : (
        <div
          ref={box}
          onScroll={(e) => {
            const el = e.currentTarget
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICKY_PX
          }}
          className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-xs leading-5 whitespace-pre"
          role="log"
          aria-label="Conteúdo do arquivo"
        >
          {tail?.truncated && !filter && <div className="mb-1 text-muted">… o começo do arquivo ficou de fora (use Baixar para ele inteiro) …</div>}
          {lines.join('\n')}
        </div>
      )}
      <div className="flex h-7 shrink-0 items-center gap-4 border-t border-line px-3 text-xs text-muted">
        <span>{filter ? `${lines.length} linha(s) com "${filter}"` : `${lines.length} linha(s)`}</span>
        <span>{follow ? 'Seguindo o arquivo' : 'Atualização pausada'}</span>
      </div>
    </div>
  )
}
