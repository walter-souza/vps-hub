import { Code, Maximize, RefreshCw, ZoomIn, ZoomOut } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { baseName } from '../../../../shared/paths'
import { Button } from '../../components/ui'
import { api, errMsg } from '../../lib/api'
import { formatSize } from '../../lib/format'

interface Props {
  vpsId: string
  path: string
  onViewAsText: () => void
}

interface Loaded {
  url: string
  size: number
  mime: string
}

const MIN_ZOOM = 0.05
const MAX_ZOOM = 16

export function ImageView({ vpsId, path, onViewAsText }: Props) {
  const [img, setImg] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** null = ajustar à janela. */
  const [zoom, setZoom] = useState<number | null>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const area = useRef<HTMLDivElement>(null)
  const imgEl = useRef<HTMLImageElement>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const { data, mime } = await api.fs.readImage(vpsId, path)
      // A imagem vira blob: URL (nunca HTML), então um SVG com script não executa.
      const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }))
      setImg((old) => {
        if (old) URL.revokeObjectURL(old.url)
        return { url, size: data.byteLength, mime }
      })
      setNatural(null)
      setZoom(null)
    } catch (e) {
      setError(errMsg(e))
    }
  }, [vpsId, path])

  useEffect(() => {
    load()
  }, [load])
  useEffect(() => () => setImg((old) => (old && URL.revokeObjectURL(old.url), null)), [])

  /** Escala efetiva (para o botão de zoom partir do tamanho que está na tela). */
  const current = () => {
    const el = imgEl.current
    return zoom ?? (el && natural ? el.getBoundingClientRect().width / natural.w : 1)
  }
  const zoomBy = (factor: number) => setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current() * factor)))
  const zoomRef = useRef(zoomBy)
  zoomRef.current = zoomBy

  useEffect(() => {
    const el = area.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      zoomRef.current(e.deltaY < 0 ? 1.15 : 1 / 1.15)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [img])

  // Arrastar a imagem rola a área quando ela é maior que a janela.
  const pan = (e: ReactPointerEvent) => {
    const el = area.current
    if (!el || e.button !== 0) return
    const start = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }
    const move = (ev: PointerEvent) => {
      el.scrollLeft = start.left - (ev.clientX - start.x)
      el.scrollTop = start.top - (ev.clientY - start.y)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const isSvg = img?.mime === 'image/svg+xml'
  const pct = Math.round(current() * 100)

  return (
    <div className="absolute inset-0 flex flex-col bg-bg">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-3">
        <span className="mr-2 truncate font-mono text-xs text-muted" title={path}>
          {path}
        </span>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => zoomBy(1 / 1.25)} aria-label="Diminuir zoom" title="Diminuir zoom">
          <ZoomOut size={14} />
        </Button>
        <span className="w-12 text-center text-xs text-muted" aria-label="Zoom">
          {zoom === null ? 'Ajustar' : `${pct}%`}
        </span>
        <Button size="sm" variant="ghost" onClick={() => zoomBy(1.25)} aria-label="Aumentar zoom" title="Aumentar zoom">
          <ZoomIn size={14} />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setZoom(1)} title="Tamanho real (100%)">
          100%
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setZoom(null)} aria-label="Ajustar à janela" title="Ajustar à janela">
          <Maximize size={14} />
        </Button>
        <Button size="sm" variant="ghost" onClick={load} aria-label="Recarregar" title="Recarregar do servidor">
          <RefreshCw size={14} />
        </Button>
        {isSvg && (
          <Button size="sm" variant="ghost" onClick={onViewAsText} title="Abrir o código no editor">
            <Code size={14} /> Ver código
          </Button>
        )}
      </div>

      <div ref={area} className="checkered flex min-h-0 flex-1 overflow-auto">
        {error ? (
          <div className="m-auto text-danger" role="alert">
            {error}
          </div>
        ) : !img ? (
          <div className="m-auto text-muted">Carregando…</div>
        ) : (
          <img
            ref={imgEl}
            src={img.url}
            alt={baseName(path)}
            draggable={false}
            onPointerDown={pan}
            onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth || 300, h: e.currentTarget.naturalHeight || 150 })}
            className="m-auto cursor-grab"
            style={
              zoom === null || !natural
                ? { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }
                : { width: natural.w * zoom, height: natural.h * zoom, maxWidth: 'none', imageRendering: zoom >= 4 ? 'pixelated' : 'auto' }
            }
          />
        )}
      </div>

      <div className="flex h-7 shrink-0 items-center gap-4 border-t border-line px-3 text-xs text-muted">
        {natural && (
          <span>
            {natural.w} × {natural.h} px
          </span>
        )}
        {img && <span>{formatSize(img.size)}</span>}
        {img && <span>{img.mime}</span>}
      </div>
    </div>
  )
}
