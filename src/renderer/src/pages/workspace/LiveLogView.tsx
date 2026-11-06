import { Eraser, Pause, Play, RotateCw } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { LogSource } from '../../../../shared/types'
import { Button } from '../../components/ui'
import { api, errMsg } from '../../lib/api'

/** Quanto texto fica na memória (o começo é descartado, sempre numa quebra de linha). */
const MAX_CHARS = 2_000_000
/** Distância do fim (px) até a qual a leitura continua "grudada" nas linhas novas. */
const STICKY_PX = 40

export const logTitle = (s: LogSource) => (s.kind === 'journal' ? (s.unit ?? 'journal') : s.kind === 'docker' ? s.container : s.path.split('/').pop() || s.path)
const logDetail = (s: LogSource) => (s.kind === 'journal' ? `journalctl -f${s.unit ? ` -u ${s.unit}` : ''}` : s.kind === 'docker' ? `docker logs -f ${s.container}` : `tail -F ${s.path}`)

/** Log ao vivo: a saída de `journalctl -f`, `docker logs -f` ou `tail -F` chega do servidor em tempo real. */
export function LiveLogView({ vpsId, source, hidden }: { vpsId: string; source: LogSource; hidden: boolean }) {
  const [text, setText] = useState('')
  const [status, setStatus] = useState<'starting' | 'running' | 'ended'>('starting')
  const [error, setError] = useState<string | null>(null)
  const [paused, setPaused] = useState(false)
  const [filter, setFilter] = useState('')
  const [run, setRun] = useState(0)
  const buffer = useRef('')
  const frame = useRef(0)
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const pausedRef = useRef(false)
  pausedRef.current = paused

  const flush = useCallback(() => {
    frame.current = 0
    if (!pausedRef.current) setText(buffer.current)
  }, [])

  useEffect(() => {
    const streamId = crypto.randomUUID()
    let cancelled = false
    setStatus('starting')
    setError(null)
    const offData = api.logs.onData((id, chunk) => {
      if (id !== streamId) return
      let next = buffer.current + chunk
      if (next.length > MAX_CHARS) {
        const cut = next.indexOf('\n', next.length - MAX_CHARS)
        next = next.slice(cut < 0 ? next.length - MAX_CHARS : cut + 1)
      }
      buffer.current = next
      // Agrupa rajadas de linhas em uma só atualização de tela.
      if (!frame.current) frame.current = requestAnimationFrame(flush)
    })
    const offEnd = api.logs.onEnd((id) => id === streamId && setStatus('ended'))
    api.logs.start(streamId, vpsId, source).then(
      () => {
        if (cancelled) api.logs.stop(streamId)
        else setStatus((s) => (s === 'ended' ? s : 'running'))
      },
      (e) => {
        if (cancelled) return
        setError(errMsg(e))
        setStatus('ended')
      }
    )
    return () => {
      cancelled = true
      offData()
      offEnd()
      api.logs.stop(streamId)
      if (frame.current) cancelAnimationFrame(frame.current)
      frame.current = 0
    }
  }, [vpsId, source, run, flush])

  const lines = useMemo(() => {
    const all = text.split('\n')
    if (all.at(-1) === '') all.pop()
    const term = filter.trim().toLowerCase()
    return term ? all.filter((l) => l.toLowerCase().includes(term)) : all
  }, [text, filter])

  // Se a pessoa estava no fim, acompanha as linhas novas; se subiu para ler, não puxa de volta.
  useLayoutEffect(() => {
    const el = box.current
    if (el && stick.current && !hidden) el.scrollTop = el.scrollHeight
  }, [lines, hidden])

  const restart = () => {
    buffer.current = ''
    setText('')
    setPaused(false)
    setRun((r) => r + 1)
  }

  return (
    <div className={`absolute inset-0 flex flex-col bg-bg ${hidden ? 'hidden' : ''}`}>
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3 text-xs">
        <span className="truncate font-mono text-muted" title={logDetail(source)}>
          {logDetail(source)}
        </span>
        <div className="flex-1" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrar linhas"
          aria-label="Filtrar linhas"
          className="h-7 w-44 rounded-md border border-line bg-bg px-2 outline-none focus:border-accent"
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            if (paused) setText(buffer.current)
            setPaused(!paused)
          }}
          aria-pressed={paused}
          title="Congela a tela; as linhas novas continuam chegando"
        >
          {paused ? <Play size={13} /> : <Pause size={13} />} {paused ? 'Retomar' : 'Pausar'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            buffer.current = ''
            setText('')
          }}
          aria-label="Limpar"
          title="Limpar a tela"
        >
          <Eraser size={13} />
        </Button>
      </div>
      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICKY_PX
        }}
        className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-xs leading-5 whitespace-pre"
        role="log"
        aria-label="Saída do log"
      >
        {lines.join('\n')}
      </div>
      <div className="flex h-7 shrink-0 items-center gap-4 border-t border-line px-3 text-xs text-muted">
        <span>{filter ? `${lines.length} linha(s) com "${filter}"` : `${lines.length} linha(s)`}</span>
        <span>{status === 'starting' ? 'Conectando…' : status === 'running' ? (paused ? 'Pausado' : 'Ao vivo') : 'Encerrado'}</span>
        {error && (
          <span className="text-danger" role="alert">
            {error}
          </span>
        )}
        <div className="flex-1" />
        {status === 'ended' && (
          <Button size="sm" variant="ghost" onClick={restart}>
            <RotateCw size={13} /> Reiniciar
          </Button>
        )}
      </div>
    </div>
  )
}
