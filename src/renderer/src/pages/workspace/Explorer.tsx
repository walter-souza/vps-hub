import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ClipboardCopy,
  Download,
  Eye,
  EyeOff,
  FilePlus,
  FileText,
  FolderOpen,
  FolderPlus,
  Home,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
  SquareTerminal,
  Trash2,
  Upload
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { joinPath, normalizePath, parentPath, validateName } from '../../../../shared/paths'
import type { FileEntry, SessionInfo, VpsConnection } from '../../../../shared/types'
import { ContextMenu, type MenuEntry, type MenuState } from '../../components/ContextMenu'
import { FileIcon } from '../../components/FileIcon'
import { api, errMsg } from '../../lib/api'
import { confirm, prompt } from '../../lib/dialogs'
import { formatDate, formatSize } from '../../lib/format'
import { toast } from '../../lib/store'
import { TrashView } from './TrashView'

type SortKey = 'name' | 'size' | 'mtime'

interface Props {
  vps: VpsConnection
  info: SessionInfo
  closed: boolean
  hidden: boolean
  onOpenFile: (path: string) => void
  onOpenTerminal: (cwd: string) => void
}

const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' })
const COLS = 'grid grid-cols-[minmax(220px,1fr)_90px_130px_96px_90px]'

export function Explorer({ vps, info, closed, hidden, onOpenFile, onOpenTerminal }: Props) {
  const id = vps.id
  const resolve = useCallback(
    (input: string, base: string) => {
      const v = input.trim()
      if (v === '~' || v.startsWith('~/')) return normalizePath(info.home + v.slice(1))
      return v.startsWith('/') ? normalizePath(v) : joinPath(base, v)
    },
    [info.home]
  )
  const startPath = vps.initialPath ? resolve(vps.initialPath, info.home) : info.home
  const trashRoot = joinPath(info.home, '.vpshub-trash')
  const isTrashPath = (p: string) => p === trashRoot || p.startsWith(`${trashRoot}/`)

  const [cwd, setCwd] = useState(startPath)
  const cwdRef = useRef(cwd)
  cwdRef.current = cwd
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [hist, setHist] = useState<{ back: string[]; fwd: string[] }>({ back: [], fwd: [] })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'name', asc: true })
  const [showHidden, setShowHidden] = useState(true)
  const [filter, setFilter] = useState('')
  const [editingPath, setEditingPath] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [dropActive, setDropActive] = useState(false)
  const [showTrash, setShowTrash] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const loadSeq = useRef(0)
  const closeMenu = useCallback(() => setMenu(null), [])

  /** Carrega uma pasta; só troca de pasta se a listagem der certo. */
  const load = useCallback(
    async (path: string, select: string[] = []) => {
      const seq = ++loadSeq.current
      setLoading(true)
      try {
        const list = await api.fs.list(id, path)
        if (seq !== loadSeq.current) return false
        setEntries(list)
        setCwd(path)
        setSelected(new Set(select))
        return true
      } catch (e) {
        if (seq === loadSeq.current) toast('error', `${path}: ${errMsg(e)}`)
        return false
      } finally {
        if (seq === loadSeq.current) setLoading(false)
      }
    },
    [id]
  )

  const refresh = useCallback((select?: string[]) => load(cwdRef.current, select), [load])

  // Carga inicial e recarga após reconectar. Se a pasta inicial não existir, cai na home.
  const firstLoad = useRef(true)
  useEffect(() => {
    if (closed) return
    if (!firstLoad.current) {
      refresh()
      return
    }
    firstLoad.current = false
    load(startPath).then((ok) => !ok && startPath !== info.home && load(info.home))
  }, [closed]) // só reage à conexão; as demais dependências são estáveis por sessão

  const navigate = async (path: string) => {
    setShowTrash(false)
    const from = cwdRef.current
    if (path === from) return refresh()
    if (await load(path)) {
      setHist((h) => ({ back: [...h.back, from], fwd: [] }))
      setFilter('')
    }
  }
  const back = async () => {
    setShowTrash(false)
    const prev = hist.back.at(-1)
    if (prev && (await load(prev))) setHist((h) => ({ back: h.back.slice(0, -1), fwd: [cwdRef.current, ...h.fwd] }))
  }
  const forward = async () => {
    setShowTrash(false)
    const next = hist.fwd[0]
    if (next && (await load(next))) setHist((h) => ({ back: [...h.back, cwdRef.current], fwd: h.fwd.slice(1) }))
  }
  const up = () => cwd !== '/' && navigate(parentPath(cwd))

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const dir = sort.asc ? 1 : -1
    return entries
      .filter((e) => (showHidden || !e.name.startsWith('.')) && (!q || e.name.toLowerCase().includes(q)))
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
        const diff =
          sort.key === 'size' ? a.size - b.size : sort.key === 'mtime' ? a.mtime - b.mtime : collator.compare(a.name, b.name)
        return (diff || collator.compare(a.name, b.name)) * dir
      })
  }, [entries, filter, showHidden, sort])

  const selection = visible.filter((e) => selected.has(e.path))

  // ---------- Ações ----------

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch (e) {
      toast('error', errMsg(e))
    }
  }

  const open = (e: FileEntry) => (e.isDir ? navigate(e.path) : onOpenFile(e.path))

  const newItem = async (kind: 'file' | 'dir') => {
    const name = await prompt({
      title: kind === 'dir' ? 'Nova pasta' : 'Novo arquivo',
      label: 'Nome',
      initial: kind === 'dir' ? 'nova-pasta' : 'novo-arquivo.txt',
      validate: validateName,
      selectStem: true,
      confirmLabel: 'Criar'
    })
    if (name == null) return
    const path = joinPath(cwdRef.current, name)
    await run(async () => {
      await (kind === 'dir' ? api.fs.mkdir(id, path) : api.fs.createFile(id, path))
      await refresh([path])
    })
  }

  const rename = async (e: FileEntry) => {
    const name = await prompt({ title: 'Renomear', label: 'Novo nome', initial: e.name, validate: validateName, selectStem: !e.isDir, confirmLabel: 'Renomear' })
    if (name == null || name === e.name) return
    const to = joinPath(parentPath(e.path), name)
    await run(async () => {
      await api.fs.rename(id, e.path, to)
      await refresh([to])
    })
  }

  /** Del manda para a lixeira; Shift+Del (ou itens já dentro da lixeira) apaga de vez. */
  const remove = async (list: FileEntry[], permanent = false) => {
    if (list.length === 0) return
    const hard = permanent || isTrashPath(cwdRef.current)
    const what = list.length === 1 ? `"${list[0].name}"` : `${list.length} itens`
    const ok = await confirm(
      hard
        ? {
            title: `Excluir ${what} permanentemente?`,
            message: 'Os itens serão apagados da VPS sem passar pela lixeira. Pastas são excluídas com todo o conteúdo. Não há como desfazer.',
            detail: list.map((e) => e.name + (e.isDir ? '/' : '')),
            confirmLabel: 'Excluir permanentemente',
            danger: true
          }
        : {
            title: `Mover ${what} para a lixeira?`,
            message: 'Você pode restaurá-los depois pela Lixeira, no Acesso rápido.',
            detail: list.map((e) => e.name + (e.isDir ? '/' : '')),
            confirmLabel: 'Mover para a lixeira'
          }
    )
    if (!ok) return
    await run(async () => {
      try {
        const trashIds = await api.fs.remove(id, list.map((e) => e.path), hard)
        if (trashIds.length > 0) {
          toast('success', `${what} movido(s) para a lixeira.`, {
            label: 'Desfazer',
            run: () =>
              run(async () => {
                await api.trash.restore(id, trashIds)
                await refresh(list.map((e) => e.path))
              })
          })
        }
      } finally {
        await refresh()
      }
    })
  }

  const upload = async (localPaths: string[]) => {
    if (localPaths.length === 0) return
    const dir = cwdRef.current
    const existing = new Set(entries.map((e) => e.name))
    const clashes = localPaths.map((p) => p.split(/[\\/]/).pop() ?? p).filter((n) => existing.has(n))
    if (
      clashes.length > 0 &&
      !(await confirm({
        title: 'Substituir itens existentes?',
        message: `Estes itens já existem em ${dir} e serão substituídos (pastas são mescladas):`,
        detail: clashes,
        confirmLabel: 'Substituir',
        danger: true
      }))
    )
      return
    await run(async () => {
      try {
        await api.fs.upload(id, localPaths, dir)
        toast('success', `Envio para ${dir} concluído.`)
      } finally {
        if (cwdRef.current === dir) await refresh(localPaths.map((p) => joinPath(dir, p.split(/[\\/]/).pop() ?? p)))
      }
    })
  }

  const download = (list: FileEntry[]) =>
    run(async () => {
      const dir = await api.fs.download(
        id,
        list.map((e) => e.path)
      )
      if (dir) toast('success', 'Download concluído.', { label: 'Abrir pasta', run: () => api.fs.revealLocal(dir) })
    })

  const copyPath = (path: string) => navigator.clipboard.writeText(path).then(() => toast('info', 'Caminho copiado.'))

  // ---------- Seleção e eventos ----------

  const clickRow = (e: MouseEvent, entry: FileEntry) => {
    if (e.shiftKey && anchor) {
      const a = visible.findIndex((x) => x.path === anchor)
      const b = visible.findIndex((x) => x.path === entry.path)
      const [from, to] = a < b ? [a, b] : [b, a]
      setSelected(new Set(visible.slice(from, to + 1).map((x) => x.path)))
      return
    }
    if (e.ctrlKey) {
      setSelected((s) => {
        const next = new Set(s)
        if (next.has(entry.path)) next.delete(entry.path)
        else next.add(entry.path)
        return next
      })
    } else {
      setSelected(new Set([entry.path]))
    }
    setAnchor(entry.path)
  }

  const rowMenu = (e: MouseEvent, entry: FileEntry) => {
    e.preventDefault()
    e.stopPropagation()
    const list = selected.has(entry.path) ? selection : [entry]
    if (!selected.has(entry.path)) {
      setSelected(new Set([entry.path]))
      setAnchor(entry.path)
    }
    const single = list.length === 1
    const items: MenuEntry[] = []
    if (single) {
      items.push(
        entry.isDir
          ? { label: 'Abrir', icon: FolderOpen, shortcut: 'Enter', onClick: () => open(entry) }
          : { label: 'Editar', icon: FileText, shortcut: 'Enter', onClick: () => open(entry) }
      )
    }
    items.push({ label: list.length > 1 ? `Baixar ${list.length} itens` : 'Baixar', icon: Download, onClick: () => download(list) }, 'sep')
    if (single) {
      items.push(
        { label: 'Renomear', icon: Pencil, shortcut: 'F2', onClick: () => rename(entry) },
        { label: 'Copiar caminho', icon: ClipboardCopy, onClick: () => copyPath(entry.path) }
      )
      if (entry.isDir) items.push({ label: 'Abrir terminal aqui', icon: SquareTerminal, onClick: () => onOpenTerminal(entry.path) })
      items.push('sep')
    }
    if (!isTrashPath(cwd)) items.push({ label: 'Mover para a lixeira', icon: Trash2, shortcut: 'Del', onClick: () => remove(list) })
    items.push({ label: 'Excluir permanentemente', icon: Trash2, shortcut: 'Shift+Del', danger: true, onClick: () => remove(list, true) })
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  const backgroundMenu = (e: MouseEvent) => {
    e.preventDefault()
    setSelected(new Set())
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Novo arquivo', icon: FilePlus, onClick: () => newItem('file') },
        { label: 'Nova pasta', icon: FolderPlus, shortcut: 'Ctrl+Shift+N', onClick: () => newItem('dir') },
        'sep',
        { label: 'Enviar arquivos…', icon: Upload, onClick: async () => upload(await api.fs.pickUpload()) },
        { label: 'Atualizar', icon: RefreshCw, shortcut: 'F5', onClick: () => refresh() },
        'sep',
        { label: 'Abrir terminal aqui', icon: SquareTerminal, onClick: () => onOpenTerminal(cwd) },
        { label: 'Copiar caminho da pasta', icon: ClipboardCopy, onClick: () => copyPath(cwd) },
        { label: showHidden ? 'Ocultar arquivos ocultos' : 'Mostrar arquivos ocultos', icon: showHidden ? EyeOff : Eye, onClick: () => setShowHidden((v) => !v) }
      ]
    })
  }

  const moveSelection = (delta: number, extend: boolean) => {
    if (visible.length === 0) return
    const current = visible.findIndex((x) => x.path === (anchor ?? ''))
    const next = visible[Math.max(0, Math.min(visible.length - 1, current < 0 ? 0 : current + delta))]
    if (extend && anchor) setSelected((s) => new Set([...s, next.path]))
    else setSelected(new Set([next.path]))
    setAnchor(next.path)
    listRef.current?.querySelector(`[data-path="${CSS.escape(next.path)}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return
    const k = e.key
    const handled = () => e.preventDefault()
    if (k === 'F5') return handled(), refresh()
    if (e.ctrlKey && e.shiftKey && k.toLowerCase() === 'n') return handled(), newItem('dir')
    if (e.ctrlKey && k.toLowerCase() === 'l') return handled(), setEditingPath(cwd)
    if (e.altKey && k === 'ArrowLeft') return handled(), back()
    if (e.altKey && k === 'ArrowRight') return handled(), forward()
    if ((e.altKey && k === 'ArrowUp') || k === 'Backspace') return handled(), up()
    if (e.ctrlKey && k.toLowerCase() === 'a') return handled(), setSelected(new Set(visible.map((x) => x.path)))
    if (k === 'ArrowDown') return handled(), moveSelection(1, e.shiftKey)
    if (k === 'ArrowUp') return handled(), moveSelection(-1, e.shiftKey)
    if (k === 'Escape') return setSelected(new Set())
    if (k === 'Enter' && selection.length === 1) return handled(), open(selection[0])
    if (k === 'F2' && selection.length === 1) return handled(), rename(selection[0])
    if (k === 'Delete' && selection.length > 0) return handled(), remove(selection, e.shiftKey)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDropActive(false)
    const paths = [...e.dataTransfer.files].map((f) => api.fs.pathForFile(f)).filter(Boolean)
    upload(paths)
  }

  // ---------- Render ----------

  const segments = cwd === '/' ? [] : cwd.slice(1).split('/')
  const places = useMemo(() => {
    const list = [
      { label: 'Home', path: info.home, icon: Home },
      ...(vps.initialPath ? [{ label: 'Pasta inicial', path: startPath, icon: FolderOpen }] : []),
      { label: 'Raiz  /', path: '/', icon: FolderOpen },
      { label: '/var/www', path: '/var/www', icon: FolderOpen },
      { label: '/etc', path: '/etc', icon: FolderOpen },
      { label: '/var/log', path: '/var/log', icon: FolderOpen },
      { label: '/tmp', path: '/tmp', icon: FolderOpen }
    ]
    return list.filter((p, i) => list.findIndex((q) => q.path === p.path) === i)
  }, [info.home, startPath, vps.initialPath])

  const selectedSize = selection.filter((e) => !e.isDir).reduce((sum, e) => sum + e.size, 0)
  const SortIcon = sort.asc ? ChevronUp : ChevronDown
  const header = (key: SortKey | null, label: string, align = '') => (
    <button
      disabled={!key}
      onClick={() => key && setSort((s) => ({ key, asc: s.key === key ? !s.asc : true }))}
      className={`flex items-center gap-1 px-2 text-left ${align} ${key ? 'hover:text-fg' : ''}`}
    >
      {label}
      {key && sort.key === key && <SortIcon size={12} />}
    </button>
  )

  return (
    <div className={`absolute inset-0 flex flex-col ${hidden ? 'hidden' : ''}`} onKeyDown={onKeyDown}>
      {/* Barra de navegação */}
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line bg-panel px-2">
        <NavButton label="Voltar (Alt+←)" onClick={back} disabled={hist.back.length === 0} icon={ArrowLeft} />
        <NavButton label="Avançar (Alt+→)" onClick={forward} disabled={hist.fwd.length === 0} icon={ArrowRight} />
        <NavButton label="Pasta acima (Alt+↑)" onClick={up} disabled={cwd === '/'} icon={ArrowUp} />
        <NavButton label="Atualizar (F5)" onClick={() => refresh()} icon={loading ? Loader2 : RefreshCw} spin={loading} />

        <div className="mx-1 flex h-7 min-w-0 flex-1 items-center rounded-md border border-line bg-bg">
          {editingPath != null ? (
            <input
              autoFocus
              value={editingPath}
              spellCheck={false}
              aria-label="Caminho"
              onChange={(e) => setEditingPath(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={() => setEditingPath(null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  navigate(resolve(editingPath, cwd))
                  setEditingPath(null)
                } else if (e.key === 'Escape') setEditingPath(null)
              }}
              className="h-full w-full bg-transparent px-2 font-mono text-xs outline-none"
            />
          ) : (
            <div
              className="flex h-full min-w-0 flex-1 cursor-text items-center overflow-hidden px-1"
              onClick={(e) => e.target === e.currentTarget && setEditingPath(cwd)}
              title="Clique para digitar um caminho (Ctrl+L)"
            >
              <Crumb label="/" onClick={() => navigate('/')} />
              {segments.map((seg, i) => (
                <span key={i} className="flex min-w-0 items-center">
                  {i > 0 && <ChevronRight size={12} className="shrink-0 text-muted" />}
                  <Crumb label={seg} onClick={() => navigate('/' + segments.slice(0, i + 1).join('/'))} />
                </span>
              ))}
              <div className="h-full min-w-8 flex-1" onClick={() => setEditingPath(cwd)} />
            </div>
          )}
        </div>

        <div className="relative w-52">
          <Search size={13} className="absolute top-1/2 left-2 -translate-y-1/2 text-muted" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setFilter('')}
            placeholder="Filtrar nesta pasta"
            aria-label="Filtrar nesta pasta"
            className="h-7 w-full rounded-md border border-line bg-bg pr-2 pl-7 text-xs outline-none focus:border-accent"
          />
        </div>
        <NavButton label="Novo arquivo" onClick={() => newItem('file')} icon={FilePlus} />
        <NavButton label="Nova pasta (Ctrl+Shift+N)" onClick={() => newItem('dir')} icon={FolderPlus} />
        <NavButton label="Enviar arquivos" onClick={async () => upload(await api.fs.pickUpload())} icon={Upload} />
        <NavButton label={showHidden ? 'Ocultar arquivos ocultos' : 'Mostrar arquivos ocultos'} onClick={() => setShowHidden((v) => !v)} icon={showHidden ? Eye : EyeOff} />
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Acesso rápido */}
        <nav className="w-44 shrink-0 overflow-auto border-r border-line bg-panel py-2" aria-label="Acesso rápido">
          <div className="mb-1 px-3 text-[11px] font-semibold tracking-wide text-muted uppercase">Acesso rápido</div>
          {places.map((p) => (
            <button
              key={p.path}
              onClick={() => navigate(p.path)}
              title={p.path}
              className={`flex h-7 w-full items-center gap-2 px-3 text-left ${!showTrash && cwd === p.path ? 'bg-hover text-fg' : 'text-muted hover:bg-hover hover:text-fg'}`}
            >
              <p.icon size={14} className="shrink-0" />
              <span className="truncate">{p.label}</span>
            </button>
          ))}
          <div className="mx-3 my-2 h-px bg-line" />
          <button
            onClick={() => setShowTrash(true)}
            title={trashRoot}
            className={`flex h-7 w-full items-center gap-2 px-3 text-left ${showTrash ? 'bg-hover text-fg' : 'text-muted hover:bg-hover hover:text-fg'}`}
          >
            <Trash2 size={14} className="shrink-0" />
            <span className="truncate">Lixeira</span>
          </button>
        </nav>

        {showTrash && <TrashView vpsId={id} onRestored={() => refresh()} />}

        {/* Lista de arquivos */}
        <div
          className={`relative flex min-w-0 flex-1 flex-col ${dropActive ? 'ring-2 ring-accent ring-inset' : ''} ${showTrash ? 'hidden' : ''}`}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes('Files')) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
            setDropActive(true)
          }}
          onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDropActive(false)}
          onDrop={onDrop}
        >
          <div className={`${COLS} h-7 shrink-0 items-center border-b border-line text-[11px] font-medium text-muted`}>
            {header('name', 'Nome')}
            {header('size', 'Tamanho', 'justify-end')}
            {header('mtime', 'Modificado')}
            {header(null, 'Permissões')}
            {header(null, 'Dono')}
          </div>
          <div
            ref={listRef}
            tabIndex={0}
            role="listbox"
            aria-multiselectable="true"
            aria-label={`Arquivos em ${cwd}`}
            className="min-h-0 flex-1 overflow-auto outline-none"
            onMouseDown={(e) => e.target === e.currentTarget && setSelected(new Set())}
            onContextMenu={backgroundMenu}
          >
            {visible.map((e) => {
              const isSel = selected.has(e.path)
              return (
                <div
                  key={e.path}
                  data-path={e.path}
                  role="option"
                  aria-selected={isSel}
                  onMouseDown={(ev) => ev.button === 0 && clickRow(ev, e)}
                  onDoubleClick={() => open(e)}
                  onContextMenu={(ev) => rowMenu(ev, e)}
                  className={`${COLS} h-7 cursor-default items-center text-[13px] ${isSel ? 'bg-accent/25' : 'hover:bg-hover'}`}
                >
                  <div className="flex min-w-0 items-center gap-2 px-2">
                    <FileIcon entry={e} />
                    <span className={`truncate ${e.name.startsWith('.') ? 'opacity-70' : ''}`}>{e.name}</span>
                  </div>
                  <div className="px-2 text-right text-xs text-muted">{e.isDir ? '' : formatSize(e.size)}</div>
                  <div className="px-2 text-xs text-muted">{formatDate(e.mtime)}</div>
                  <div className="px-2 font-mono text-[11px] text-muted">{e.perms}</div>
                  <div className="truncate px-2 text-xs text-muted">{e.owner}</div>
                </div>
              )
            })}
            {!loading && visible.length === 0 && (
              <div className="pointer-events-none py-16 text-center text-muted">
                {filter ? 'Nenhum item corresponde ao filtro.' : 'Pasta vazia. Arraste arquivos aqui para enviar.'}
              </div>
            )}
          </div>
          <div className="flex h-6 shrink-0 items-center gap-3 border-t border-line px-3 text-[11px] text-muted">
            <span>{visible.length} itens</span>
            {selection.length > 0 && (
              <span>
                {selection.length} selecionado(s){selectedSize > 0 && ` · ${formatSize(selectedSize)}`}
              </span>
            )}
          </div>
        </div>
      </div>

      {menu && <ContextMenu {...menu} onClose={closeMenu} />}
    </div>
  )
}

function NavButton({ label, onClick, disabled, icon: Icon, spin }: { label: string; onClick: () => void; disabled?: boolean; icon: typeof Home; spin?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-fg disabled:opacity-30"
    >
      <Icon size={15} className={spin ? 'animate-spin' : ''} />
    </button>
  )
}

function Crumb({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="shrink truncate rounded px-1.5 py-0.5 font-mono text-xs hover:bg-hover">
      {label}
    </button>
  )
}
