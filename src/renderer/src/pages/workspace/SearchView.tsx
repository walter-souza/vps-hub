import { ClipboardCopy, FileText, FolderOpen, Loader2, Search, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import type { SearchQuery, SearchResult } from '../../../../shared/types'
import { ContextMenu, type MenuState } from '../../components/ContextMenu'
import { FileIcon } from '../../components/FileIcon'
import { Button } from '../../components/ui'
import { api, errMsg } from '../../lib/api'
import { formatSize } from '../../lib/format'
import { toast } from '../../lib/store'

interface Props {
  vpsId: string
  dir: string
  initialTerm: string
  onOpenFile: (path: string, line?: number) => void
  /** Abre uma pasta no explorador, opcionalmente selecionando um item. */
  onNavigate: (dir: string, select?: string) => void
  onClose: () => void
}

type Status = { state: 'idle' } | { state: 'running'; searchId: string } | { state: 'done'; truncated: boolean; canceled: boolean }

/** Destaca o termo no trecho, respeitando maiúsculas/minúsculas conforme a busca. */
function Highlight({ text, term, caseSensitive }: { text: string; term: string; caseSensitive: boolean }) {
  const hay = caseSensitive ? text : text.toLowerCase()
  const needle = caseSensitive ? term : term.toLowerCase()
  const i = needle ? hay.indexOf(needle) : -1
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-warn/30 text-fg">{text.slice(i, i + term.length)}</mark>
      {text.slice(i + term.length)}
    </>
  )
}

export function SearchView({ vpsId, dir: initialDir, initialTerm, onOpenFile, onNavigate, onClose }: Props) {
  const [query, setQuery] = useState<SearchQuery>({ dir: initialDir, term: initialTerm, mode: 'name', caseSensitive: false, skipHeavy: true })
  const [ran, setRan] = useState<SearchQuery | null>(null)
  const [results, setResults] = useState<SearchResult[]>([])
  const [status, setStatus] = useState<Status>({ state: 'idle' })
  const [selected, setSelected] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const runningId = useRef<string | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

  const cancel = () => runningId.current && api.fs.cancelSearch(runningId.current)

  const run = async (q: SearchQuery = query) => {
    if (!q.term.trim()) return
    if (runningId.current) await api.fs.cancelSearch(runningId.current)
    const searchId = crypto.randomUUID()
    runningId.current = searchId
    setStatus({ state: 'running', searchId })
    setResults([])
    setSelected(null)
    setRan(q)
    try {
      const r = await api.fs.search(vpsId, searchId, q)
      if (runningId.current !== searchId) return
      setResults(r.results)
      setStatus({ state: 'done', truncated: r.truncated, canceled: r.canceled })
    } catch (e) {
      if (runningId.current === searchId) {
        toast('error', errMsg(e))
        setStatus({ state: 'idle' })
      }
    } finally {
      if (runningId.current === searchId) runningId.current = null
    }
  }

  // Busca inicial (vinda do filtro) e cancelamento ao sair da tela.
  useEffect(() => {
    if (initialTerm.trim()) run()
    return () => {
      if (runningId.current) api.fs.cancelSearch(runningId.current)
    }
  }, []) // executa só ao abrir

  const open = (r: SearchResult) => (r.isDir ? onNavigate(r.path) : onOpenFile(r.path, r.line))

  const rowMenu = (e: MouseEvent, r: SearchResult) => {
    e.preventDefault()
    setSelected(r.path)
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        r.isDir
          ? { label: 'Abrir', icon: FolderOpen, onClick: () => open(r) }
          : { label: r.line ? `Editar na linha ${r.line}` : 'Editar', icon: FileText, onClick: () => open(r) },
        { label: 'Abrir pasta que contém', icon: FolderOpen, onClick: () => onNavigate(r.parent, r.path) },
        { label: 'Copiar caminho', icon: ClipboardCopy, onClick: () => navigator.clipboard.writeText(r.path) }
      ]
    })
  }

  const set = <K extends keyof SearchQuery>(key: K, value: SearchQuery[K]) => setQuery((q) => ({ ...q, [key]: value }))
  const running = status.state === 'running'

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <form
        className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2"
        onSubmit={(e) => {
          e.preventDefault()
          run()
        }}
      >
        <div className="relative min-w-60 flex-1">
          <Search size={13} className="absolute top-1/2 left-2 -translate-y-1/2 text-muted" />
          <input
            autoFocus
            value={query.term}
            onChange={(e) => set('term', e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && (running ? cancel() : onClose())}
            placeholder={query.mode === 'name' ? 'Parte do nome do arquivo ou pasta' : 'Texto dentro dos arquivos'}
            aria-label="Termo de busca"
            className="h-8 w-full rounded-md border border-line bg-bg pr-2 pl-7 outline-none focus:border-accent"
          />
        </div>
        <div className="inline-flex rounded-md border border-line bg-bg p-0.5" role="radiogroup" aria-label="Buscar por">
          {(['name', 'content'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={query.mode === m}
              onClick={() => set('mode', m)}
              className={`h-7 rounded px-3 text-xs font-medium ${query.mode === m ? 'bg-accent text-white' : 'text-muted hover:text-fg'}`}
            >
              {m === 'name' ? 'Nome' : 'Conteúdo'}
            </button>
          ))}
        </div>
        {running ? (
          <Button onClick={cancel}>
            <X size={13} /> Cancelar
          </Button>
        ) : (
          <Button variant="primary" type="submit" disabled={!query.term.trim()}>
            Buscar
          </Button>
        )}
        <Button variant="ghost" size="icon" aria-label="Fechar busca" title="Fechar busca (Esc)" onClick={onClose}>
          <X size={15} />
        </Button>
        <div className="flex w-full items-center gap-4 text-xs text-muted">
          <span className="truncate">
            Em <span className="font-mono">{query.dir}</span> e subpastas
          </span>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" className="accent-accent" checked={query.caseSensitive} onChange={(e) => set('caseSensitive', e.target.checked)} />
            Diferenciar maiúsculas
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" className="accent-accent" checked={query.skipHeavy} onChange={(e) => set('skipHeavy', e.target.checked)} />
            Ignorar node_modules e .git
          </label>
        </div>
      </form>

      <div role="listbox" aria-label="Resultados da busca" className="min-h-0 flex-1 overflow-auto">
        {running && (
          <div className="flex items-center justify-center gap-2 py-16 text-muted">
            <Loader2 size={14} className="animate-spin" /> Buscando…
          </div>
        )}
        {status.state === 'done' && results.length === 0 && (
          <div className="py-16 text-center text-muted">{status.canceled ? 'Busca cancelada.' : 'Nenhum resultado.'}</div>
        )}
        {results.map((r) => (
          <div
            key={r.path}
            role="option"
            aria-selected={selected === r.path}
            onMouseDown={(e) => e.button === 0 && setSelected(r.path)}
            onDoubleClick={() => open(r)}
            onContextMenu={(e) => rowMenu(e, r)}
            className={`flex cursor-default items-center gap-3 px-3 py-1 ${selected === r.path ? 'bg-accent/25' : 'hover:bg-hover'}`}
          >
            <FileIcon entry={{ ...r, type: r.isDir ? 'dir' : 'file', perms: '', owner: '' }} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate">
                  {ran?.mode === 'name' ? <Highlight text={r.name} term={ran.term} caseSensitive={ran.caseSensitive} /> : r.name}
                </span>
                <span className="truncate font-mono text-[11px] text-muted">{r.parent}</span>
              </div>
              {r.preview !== undefined && ran && (
                <div className="truncate font-mono text-xs text-muted">
                  <span className="mr-2 text-accent">{r.line}</span>
                  <Highlight text={r.preview} term={ran.term} caseSensitive={ran.caseSensitive} />
                </div>
              )}
            </div>
            <span className="shrink-0 text-xs text-muted">{r.isDir ? '' : formatSize(r.size)}</span>
          </div>
        ))}
      </div>

      <div className="flex h-6 shrink-0 items-center gap-3 border-t border-line px-3 text-[11px] text-muted">
        {status.state === 'done' && (
          <span>
            {results.length} resultado(s)
            {status.truncated && ' · limite atingido, refine a busca'}
            {status.canceled && results.length > 0 && ' · busca cancelada (resultados parciais)'}
          </span>
        )}
        {ran?.mode === 'content' && <span className="ml-auto">Arquivos acima de 5 MB e binários são ignorados</span>}
      </div>

      {menu && <ContextMenu {...menu} onClose={closeMenu} />}
    </div>
  )
}
