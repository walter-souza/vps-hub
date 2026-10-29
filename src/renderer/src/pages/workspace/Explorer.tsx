import {
  ArrowLeft,
  ClipboardPaste,
  Copy,
  Scissors,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ClipboardCopy,
  Download,
  FileArchive,
  FolderInput,
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
  ShieldCheck,
  SquareTerminal,
  Trash2,
  Upload
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { archiveInfo, baseName, joinPath, normalizePath, parentPath, validateName } from '../../../../shared/paths'
import type { ExtractMode, FileEntry, PasteMode, SessionInfo, VpsConnection } from '../../../../shared/types'
import { ContextMenu, type MenuEntry, type MenuState } from '../../components/ContextMenu'
import { FileIcon } from '../../components/FileIcon'
import { api, errCode, errMsg } from '../../lib/api'
import { confirm, prompt } from '../../lib/dialogs'
import { formatDate, formatSize } from '../../lib/format'
import { toast, useApp } from '../../lib/store'
import { SearchView } from './SearchView'
import { CompressDialog } from './CompressDialog'
import { PermissionsDialog } from './PermissionsDialog'
import { ROW_HEIGHT, useListSelection, useMarquee, useTypeAhead } from './selection'
import { TrashView } from './TrashView'

type SortKey = 'name' | 'size' | 'mtime'

interface Props {
  vps: VpsConnection
  info: SessionInfo
  closed: boolean
  hidden: boolean
  onOpenFile: (path: string, line?: number) => void
  onOpenTerminal: (cwd: string) => void
}

/** Tipo próprio nos dados do arraste, para distinguir itens do app de arquivos vindos do Windows. */
const DRAG_MIME = 'application/x-vpshub-items'
type DropTarget = { dir: string } | 'trash'
type DropAction = { op: 'move' | 'copy' | 'upload' | 'trash'; dir: string; text: string }
type ItemRef = Pick<FileEntry, 'path' | 'name' | 'isDir'>

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
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'name', asc: true })
  const [showHidden, setShowHidden] = useState(true)
  const [filter, setFilter] = useState('')
  const [editingPath, setEditingPath] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  // O painel central mostra a pasta atual, a lixeira ou os resultados de uma busca.
  const [view, setView] = useState<'files' | 'trash' | 'search'>('files')
  const [search, setSearch] = useState({ term: '', key: 0 })
  const [permsFor, setPermsFor] = useState<FileEntry[] | null>(null)
  const [compressFor, setCompressFor] = useState<FileEntry[] | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const loadSeq = useRef(0)
  const closeMenu = useCallback(() => setMenu(null), [])

  /** Carrega uma pasta; só troca de pasta se a listagem der certo. */
  const load = useCallback(
    // Sem select, mantém a seleção atual (ex.: F5); itens que sumiram saem sozinhos.
    async (path: string, select?: string[]) => {
      const seq = ++loadSeq.current
      setLoading(true)
      try {
        const list = await api.fs.list(id, path)
        if (seq !== loadSeq.current) return false
        setEntries(list)
        setCwd(path)
        if (select) selectOnly(select)
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

  const navigate = async (path: string, select: string[] = []) => {
    setView('files')
    const from = cwdRef.current
    if (path === from) return refresh(select)
    if (await load(path, select)) {
      setHist((h) => ({ back: [...h.back, from], fwd: [] }))
      setFilter('')
    }
  }
  const back = async () => {
    setView('files')
    const prev = hist.back.at(-1)
    if (prev && (await load(prev))) setHist((h) => ({ back: h.back.slice(0, -1), fwd: [cwdRef.current, ...h.fwd] }))
  }
  const forward = async () => {
    setView('files')
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

  const visiblePaths = useMemo(() => visible.map((e) => e.path), [visible])
  const visibleNames = useMemo(() => visible.map((e) => e.name), [visible])
  const { selected, setSelected, selectOnly, focus, focusIndex, click, moveTo, toggleFocused } = useListSelection(visiblePaths)
  // Clique no espaço em branco: seleciona a linha sob o cursor (ou limpa, abaixo da última).
  const marquee = useMarquee(listRef, visiblePaths, selected, setSelected, (path, mods) =>
    path ? click(path, mods) : !mods.ctrlKey && !mods.shiftKey && setSelected(new Set())
  )
  const focusRow = (path: string | null) =>
    path && listRef.current?.querySelector(`[data-path="${CSS.escape(path)}"]`)?.scrollIntoView({ block: 'nearest' })
  const typeAhead = useTypeAhead(visibleNames, focusIndex, (i) => focusRow(moveTo(i, { ctrlKey: false, shiftKey: false })))
  const selection = visible.filter((e) => selected.has(e.path))

  // ---------- Ações ----------

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch (e) {
      toast('error', errMsg(e))
    }
  }

  // O termo passa do filtro para a busca; o filtro é limpo para não esconder itens ao voltar à pasta.
  const openSearch = (term: string) => {
    setSearch((s) => ({ term, key: s.key + 1 }))
    setFilter('')
    setView('search')
  }

  // Ctrl+F vale para a janela toda enquanto o explorador está visível (exceto em campos de texto e no terminal).
  const openSearchRef = useRef(openSearch)
  openSearchRef.current = openSearch
  useEffect(() => {
    if (hidden) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (!e.ctrlKey || e.key.toLowerCase() !== 'f' || tag === 'INPUT' || tag === 'TEXTAREA') return
      e.preventDefault()
      openSearchRef.current('')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hidden])

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
  const remove = async (list: ItemRef[], permanent = false, ask = true) => {
    if (list.length === 0) return
    const hard = permanent || isTrashPath(cwdRef.current)
    const what = list.length === 1 ? `"${list[0].name}"` : `${list.length} itens`
    // Mover para a lixeira sem perguntar só quando pedido (arrastar); apagar de vez sempre pergunta.
    const ok = (!hard && !ask) || await confirm(
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

  const upload = async (localPaths: string[], dir = cwdRef.current) => {
    if (localPaths.length === 0) return
    const existing = new Set((dir === cwdRef.current ? entries : await listOrEmpty(dir)).map((e) => e.name))
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
        await refresh(cwdRef.current === dir ? localPaths.map((p) => joinPath(dir, p.split(/[\\/]/).pop() ?? p)) : undefined)
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

  const clipboard = useApp((s) => s.clipboard)
  const setClipboard = useApp((s) => s.setClipboard)
  const isCut = (path: string) => clipboard?.mode === 'cut' && clipboard.vpsId === id && clipboard.paths.includes(path)

  const toClipboard = (list: FileEntry[], mode: PasteMode) =>
    list.length > 0 && setClipboard({ vpsId: id, paths: list.map((e) => e.path), mode })

  const listOrEmpty = (dir: string) => api.fs.list(id, dir).catch(() => [] as FileEntry[])

  /**
   * Copia ou move itens (de qualquer VPS conectada) para destDir. Na mesma pasta, copiar cria
   * "nome - cópia" e mover não faz nada; em outra pasta, nomes repetidos pedem confirmação e os itens
   * atuais vão para a lixeira. Retorna os caminhos finais, ou null se nada foi feito.
   */
  const transfer = async (srcId: string, paths: string[], destDir: string, mode: PasteMode): Promise<string[] | null> => {
    const sameDir = srcId === id && paths.every((p) => parentPath(p) === destDir)
    if (sameDir && mode === 'cut') return null
    let replace = false
    if (!sameDir) {
      const existing = destDir === cwdRef.current ? entries : await listOrEmpty(destDir)
      const names = new Set(existing.map((e) => e.name))
      const clashes = paths.map(baseName).filter((n) => names.has(n))
      if (clashes.length > 0) {
        const ok = await confirm({
          title: 'Substituir itens existentes?',
          message: `Estes itens já existem em ${destDir}. Os atuais serão movidos para a lixeira.`,
          detail: clashes,
          confirmLabel: 'Substituir',
          danger: true
        })
        if (!ok) return null
        replace = true
      }
    }
    setLoading(true)
    let done: string[] | null = null
    try {
      done = await api.fs.paste(srcId, paths, id, destDir, mode, replace)
    } catch (e) {
      toast('error', errMsg(e))
    } finally {
      await refresh(destDir === cwdRef.current && done ? done : undefined)
    }
    return done
  }

  const paste = async (destDir: string) => {
    const clip = useApp.getState().clipboard
    if (!clip) return
    const done = await transfer(clip.vpsId, clip.paths, destDir, clip.mode)
    if (done && clip.mode === 'cut') setClipboard(null)
  }

  /** Extrai um arquivo; em "aqui", conflitos pedem confirmação e os itens atuais vão para a lixeira. */
  const extract = async (archive: FileEntry, mode: ExtractMode) => {
    setLoading(true)
    let created: string[] = []
    try {
      try {
        created = await api.fs.extract(id, archive.path, mode, false)
      } catch (e) {
        if (errCode(e) !== 'EXISTS') throw e
        const ok = await confirm({
          title: 'Substituir itens existentes?',
          message: `${errMsg(e)}. Os atuais serão movidos para a lixeira.`,
          confirmLabel: 'Substituir',
          danger: true
        })
        if (!ok) return
        created = await api.fs.extract(id, archive.path, mode, true)
      }
      toast('success', `${archive.name} extraído.`)
    } catch (e) {
      toast('error', errMsg(e))
    } finally {
      await refresh(created)
    }
  }

  const copyPath = (path: string) => navigator.clipboard.writeText(path).then(() => toast('info', 'Caminho copiado.'))

  // ---------- Seleção e eventos ----------

  // Clique simples num item que já faz parte de uma seleção múltipla só reduz a seleção ao soltar,
  // para permitir arrastar todos os selecionados.
  const keepsSelection = (e: MouseEvent, entry: FileEntry) => !e.ctrlKey && !e.shiftKey && selected.has(entry.path) && selected.size > 1
  const pressRow = (e: MouseEvent, entry: FileEntry) => {
    if (e.button === 0 && !keepsSelection(e, entry)) click(entry.path, e)
  }
  const releaseRow = (e: MouseEvent, entry: FileEntry) => {
    if (keepsSelection(e, entry)) click(entry.path, e)
  }

  const rowMenu = (e: MouseEvent, entry: FileEntry) => {
    e.preventDefault()
    e.stopPropagation()
    const list = selected.has(entry.path) ? selection : [entry]
    if (!selected.has(entry.path)) click(entry.path, { ctrlKey: false, shiftKey: false })
    const single = list.length === 1
    const items: MenuEntry[] = []
    if (single) {
      items.push(
        entry.isDir
          ? { label: 'Abrir', icon: FolderOpen, shortcut: 'Enter', onClick: () => open(entry) }
          : { label: 'Editar', icon: FileText, shortcut: 'Enter', onClick: () => open(entry) }
      )
    }
    items.push(
      { label: list.length > 1 ? `Baixar ${list.length} itens` : 'Baixar', icon: Download, onClick: () => download(list) },
      'sep',
      { label: 'Recortar', icon: Scissors, shortcut: 'Ctrl+X', onClick: () => toClipboard(list, 'cut') },
      { label: 'Copiar', icon: Copy, shortcut: 'Ctrl+C', onClick: () => toClipboard(list, 'copy') }
    )
    if (single && entry.isDir && clipboard) items.push({ label: 'Colar nesta pasta', icon: ClipboardPaste, onClick: () => paste(entry.path) })
    items.push('sep')
    if (single) {
      items.push(
        { label: 'Renomear', icon: Pencil, shortcut: 'F2', onClick: () => rename(entry) },
        { label: 'Copiar caminho', icon: ClipboardCopy, onClick: () => copyPath(entry.path) }
      )
      if (entry.isDir) items.push({ label: 'Abrir terminal aqui', icon: SquareTerminal, onClick: () => onOpenTerminal(entry.path) })
    }
    items.push({ label: 'Permissões e dono…', icon: ShieldCheck, shortcut: 'Alt+Enter', onClick: () => setPermsFor(list) })
    items.push({ label: 'Compactar…', icon: FileArchive, onClick: () => setCompressFor(list) })
    const archive = single && !entry.isDir ? archiveInfo(entry.name) : null
    if (archive) {
      items.push(
        { label: `Extrair para "${archive.stem}/"`, icon: FolderInput, onClick: () => extract(entry, 'folder') },
        { label: 'Extrair aqui', icon: FolderInput, onClick: () => extract(entry, 'here') }
      )
    }
    items.push('sep')
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
        { label: 'Colar', icon: ClipboardPaste, shortcut: 'Ctrl+V', disabled: !clipboard, onClick: () => paste(cwd) },
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

  const pageSize = () => Math.max(1, Math.floor((listRef.current?.clientHeight ?? ROW_HEIGHT * 10) / ROW_HEIGHT) - 1)
  const NAV_KEYS: Record<string, (i: number) => number> = {
    ArrowDown: (i) => i + 1,
    ArrowUp: (i) => Math.max(0, i - 1),
    Home: () => 0,
    End: () => visible.length - 1,
    PageDown: (i) => i + pageSize(),
    PageUp: (i) => Math.max(0, i - pageSize())
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
    if (e.ctrlKey && k.toLowerCase() === 'c') return handled(), toClipboard(selection, 'copy')
    if (e.ctrlKey && k.toLowerCase() === 'x') return handled(), toClipboard(selection, 'cut')
    if (e.ctrlKey && k.toLowerCase() === 'v') return handled(), paste(cwd)
    if (e.ctrlKey && k.toLowerCase() === 'a') return handled(), setSelected(new Set(visible.map((x) => x.path)))
    if (NAV_KEYS[k] && !e.altKey) return handled(), focusRow(moveTo(NAV_KEYS[k](focusIndex), e))
    if (e.ctrlKey && k === ' ') return handled(), toggleFocused()
    if (k === 'Escape') return setSelected(new Set())
    if (k === 'Enter' && !e.altKey && selection.length === 1) return handled(), open(selection[0])
    if (e.altKey && k === 'Enter' && selection.length > 0) return handled(), setPermsFor(selection)
    if (k === 'F2' && selection.length === 1) return handled(), rename(selection[0])
    if (k === 'Delete' && selection.length > 0) return handled(), remove(selection, e.shiftKey)
    if (k.length === 1 && k !== ' ' && !e.ctrlKey && !e.altKey && !e.metaKey) return handled(), typeAhead(k)
  }

  // ---------- Arrastar e soltar ----------
  // Itens arrastados dentro do app ficam num ref: durante o arraste o navegador não deixa ler os dados.
  const dragPaths = useRef<string[] | null>(null)
  const [dragging, setDragging] = useState<Set<string>>(new Set())
  const [dropHint, setDropHint] = useState<{ key: string; text: string; sub?: string; x: number; y: number } | null>(null)
  const spring = useRef<{ key: string; timer: ReturnType<typeof setTimeout> } | null>(null)
  /**
   * Sessão de arraste: guarda a pasta de origem e se o app já entrou em outra pasta durante o arraste.
   * Soltar num alvo válido termina ficando onde está; cancelar (Esc, soltar fora) volta à origem.
   */
  const session = useRef<{ origin: string; navigated: boolean } | null>(null)
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate

  const disarmSpring = () => {
    if (spring.current) clearTimeout(spring.current.timer)
    spring.current = null
  }
  const finishDrag = useCallback((cancelled: boolean) => {
    const s = session.current
    const paths = dragPaths.current ?? []
    session.current = null
    dragPaths.current = null
    setDragging(new Set())
    setDropHint(null)
    disarmSpring()
    if (cancelled && s?.navigated && cwdRef.current !== s.origin) navigateRef.current(s.origin, paths)
  }, [])
  useEffect(() => {
    // dragend sem efeito = cancelado. Se a linha de origem sumiu (o app entrou numa pasta durante o
    // arraste), o dragend não chega até aqui; aí o primeiro movimento de mouse sem botão pressionado
    // (o arraste já acabou) avisa.
    const onEnd = (e: globalThis.DragEvent) => finishDrag(e.dataTransfer?.dropEffect === 'none')
    const onMove = (e: globalThis.MouseEvent) => e.buttons === 0 && (session.current || dragPaths.current) && finishDrag(true)
    window.addEventListener('dragend', onEnd)
    window.addEventListener('mousemove', onMove)
    return () => {
      window.removeEventListener('dragend', onEnd)
      window.removeEventListener('mousemove', onMove)
    }
  }, [finishDrag])

  /** Abre a pasta se o cursor ficar ~1 s parado sobre o alvo (inicia a sessão para poder voltar). */
  const armSpring = (key: string, go: () => void) => {
    if (spring.current?.key === key) return
    disarmSpring()
    spring.current = {
      key,
      timer: setTimeout(() => {
        spring.current = null
        const s = (session.current ??= { origin: cwdRef.current, navigated: false })
        s.navigated = true
        go()
      }, 900)
    }
  }
  const isDragging = (e: DragEvent) => !!dragPaths.current || e.dataTransfer.types.includes('Files')
  /** Linha extra do balão depois que o arraste já entrou em outra pasta. */
  const originHint = () => {
    const s = session.current
    return s?.navigated && s.origin !== cwdRef.current ? `de ${s.origin} · Esc cancela e volta` : undefined
  }
  const leaveTarget = (key: string) => (e: DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setDropHint((h) => (h?.key === key ? null : h))
    if (spring.current?.key === key) disarmSpring()
  }

  const startItemDrag = (e: DragEvent, entry: FileEntry) => {
    const list = selected.has(entry.path) ? selection : [entry]
    if (!selected.has(entry.path)) click(entry.path, { ctrlKey: false, shiftKey: false })
    const paths = list.map((x) => x.path)
    dragPaths.current = paths
    session.current = { origin: cwdRef.current, navigated: false }
    setDragging(new Set(paths))
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ vpsId: id, paths }))
    e.dataTransfer.effectAllowed = 'copyMove'
    const ghost = document.createElement('div')
    ghost.textContent = list.length === 1 ? list[0].name : `${list.length} itens`
    ghost.className = 'fixed -top-20 left-0 rounded-md bg-accent px-2 py-1 text-xs font-medium text-white'
    document.body.appendChild(ghost)
    e.dataTransfer.setDragImage(ghost, -12, -8)
    setTimeout(() => ghost.remove())
  }

  const dirLabel = (dir: string) => (dir === '/' ? '/' : baseName(dir))
  /** O que acontece ao soltar sobre o alvo, ou null se não pode soltar ali. */
  const resolveDrop = (e: DragEvent, target: DropTarget): DropAction | null => {
    const paths = dragPaths.current
    if (!paths) {
      if (target === 'trash' || !e.dataTransfer.types.includes('Files')) return null
      return { op: 'upload', dir: target.dir, text: `Enviar para ${dirLabel(target.dir)}` }
    }
    if (target === 'trash') return isTrashPath(cwdRef.current) ? null : { op: 'trash', dir: '', text: 'Mover para a Lixeira' }
    const dir = target.dir
    if (paths.some((p) => dir === p || dir.startsWith(`${p}/`))) return null // pasta dentro dela mesma
    const copy = e.ctrlKey
    if (!copy && paths.every((p) => parentPath(p) === dir)) return null // já está lá
    return { op: copy ? 'copy' : 'move', dir, text: `${copy ? 'Copiar' : 'Mover'} para ${dirLabel(dir)}` }
  }

  const performDrop = async (action: DropAction, paths: string[], files: string[]) => {
    if (action.op === 'upload') return upload(files, action.dir)
    if (action.op === 'trash') {
      const items = paths.map((p) => entries.find((x) => x.path === p) ?? { path: p, name: baseName(p), isDir: false })
      return remove(items, false, false)
    }
    const move = action.op === 'move'
    const from = parentPath(paths[0])
    const done = await transfer(id, paths, action.dir, move ? 'cut' : 'copy')
    if (!done) return
    toast('success', `${done.length} item(ns) ${move ? 'movido(s)' : 'copiado(s)'} para ${dirLabel(action.dir)}.`, {
      label: 'Desfazer',
      run: () =>
        run(async () => {
          // Desfazer mover = mover de volta; desfazer copiar = mandar as cópias para a lixeira.
          if (move) await api.fs.paste(id, done, id, from, 'cut', false)
          else await api.fs.remove(id, done, false)
          await refresh(move && from === cwdRef.current ? paths : undefined)
        })
    })
  }

  /**
   * Props de um alvo de soltar. springOpen = pasta que abre se o cursor ficar parado sobre o alvo; vale
   * mesmo onde não dá para soltar (ex.: o trecho do caminho da própria pasta de origem).
   */
  const dropProps = (target: DropTarget, springOpen?: string) => {
    const key = target === 'trash' ? 'trash' : target.dir
    const over = (e: DragEvent) => {
      e.stopPropagation() // o alvo mais interno decide (pasta da linha > pasta atual)
      const action = resolveDrop(e, target)
      const canSpring =
        !!springOpen &&
        isDragging(e) &&
        springOpen !== cwdRef.current &&
        !(dragPaths.current ?? []).some((p) => springOpen === p || springOpen.startsWith(`${p}/`))
      let text: string | null = null
      if (action) {
        e.preventDefault()
        e.dataTransfer.dropEffect = action.op === 'copy' || action.op === 'upload' ? 'copy' : 'move'
        text = `→ ${action.text}`
      } else {
        e.dataTransfer.dropEffect = 'none'
        if (canSpring) text = `Abrir ${dirLabel(springOpen)}`
      }
      setDropHint(text ? { key, text, sub: originHint(), x: e.clientX, y: e.clientY } : null)
      if (canSpring) armSpring(key, () => navigate(springOpen))
      else if (spring.current?.key === key) disarmSpring()
    }
    return {
      onDragEnter: over,
      onDragOver: over,
      onDragLeave: leaveTarget(key),
      onDrop: (e: DragEvent) => {
        e.stopPropagation()
        const action = resolveDrop(e, target)
        const paths = dragPaths.current ?? []
        finishDrag(!action)
        if (!action) return
        e.preventDefault()
        const files = action.op === 'upload' ? [...e.dataTransfer.files].map((f) => api.fs.pathForFile(f)).filter(Boolean) : []
        performDrop(action, paths, files)
      }
    }
  }

  /** Botões de navegação (Voltar, Pasta acima): só navegam ao parar em cima durante um arraste. */
  const navSpringProps = (key: string, label: string | null, go: () => void) => {
    const over = (e: DragEvent) => {
      if (!label || !isDragging(e)) return
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'none'
      setDropHint({ key, text: label, sub: originHint(), x: e.clientX, y: e.clientY })
      armSpring(key, go)
    }
    return { onDragEnter: over, onDragOver: over, onDragLeave: leaveTarget(key) }
  }

  /** Rola a lista ao arrastar perto das bordas. */
  const autoScrollOnDrag = (e: DragEvent) => {
    const list = listRef.current
    if (!list) return
    const box = list.getBoundingClientRect()
    if (e.clientY < box.top + 30) list.scrollTop -= 14
    else if (e.clientY > box.bottom - 30) list.scrollTop += 14
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
        <NavButton
          label="Voltar (Alt+←)"
          onClick={back}
          disabled={hist.back.length === 0}
          icon={ArrowLeft}
          active={dropHint?.key === 'nav:back'}
          drop={navSpringProps('nav:back', hist.back.length ? `← Voltar para ${dirLabel(hist.back[hist.back.length - 1])}` : null, back)}
        />
        <NavButton label="Avançar (Alt+→)" onClick={forward} disabled={hist.fwd.length === 0} icon={ArrowRight} />
        <NavButton
          label="Pasta acima (Alt+↑)"
          onClick={up}
          disabled={cwd === '/'}
          icon={ArrowUp}
          active={dropHint?.key === 'nav:up'}
          drop={navSpringProps('nav:up', cwd === '/' ? null : `↑ Subir para ${dirLabel(parentPath(cwd))}`, up)}
        />
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
              <Crumb label="/" onClick={() => navigate('/')} active={dropHint?.key === '/'} drop={dropProps({ dir: '/' }, '/')} />
              {segments.map((seg, i) => (
                <span key={i} className="flex min-w-0 items-center">
                  {i > 0 && <ChevronRight size={12} className="shrink-0 text-muted" />}
                  <Crumb
                    label={seg}
                    onClick={() => navigate('/' + segments.slice(0, i + 1).join('/'))}
                    active={dropHint?.key === '/' + segments.slice(0, i + 1).join('/')}
                    drop={dropProps({ dir: '/' + segments.slice(0, i + 1).join('/') }, '/' + segments.slice(0, i + 1).join('/'))}
                  />
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
            onKeyDown={(e) => {
              if (e.key === 'Escape') setFilter('')
              else if (e.key === 'Enter' && filter.trim()) openSearch(filter)
            }}
            placeholder="Filtrar nesta pasta"
            title="Enter busca também nas subpastas"
            aria-label="Filtrar nesta pasta"
            className="h-7 w-full rounded-md border border-line bg-bg pr-2 pl-7 text-xs outline-none focus:border-accent"
          />
        </div>
        <NavButton label="Buscar em subpastas (Ctrl+F)" onClick={() => openSearch(filter)} icon={Search} />
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
              {...dropProps({ dir: p.path }, p.path)}
              className={`flex h-7 w-full items-center gap-2 px-3 text-left ${dropHint?.key === p.path ? 'bg-accent/40 text-fg ring-1 ring-accent ring-inset' : view === 'files' && cwd === p.path ? 'bg-hover text-fg' : 'text-muted hover:bg-hover hover:text-fg'}`}
            >
              <p.icon size={14} className="shrink-0" />
              <span className="truncate">{p.label}</span>
            </button>
          ))}
          <div className="mx-3 my-2 h-px bg-line" />
          <button
            onClick={() => setView('trash')}
            {...dropProps('trash')}
            title={trashRoot}
            className={`flex h-7 w-full items-center gap-2 px-3 text-left ${dropHint?.key === 'trash' ? 'bg-accent/40 text-fg ring-1 ring-accent' : view === 'trash' ? 'bg-hover text-fg' : 'text-muted hover:bg-hover hover:text-fg'}`}
          >
            <Trash2 size={14} className="shrink-0" />
            <span className="truncate">Lixeira</span>
          </button>
        </nav>

        {view === 'trash' && <TrashView vpsId={id} onRestored={() => refresh()} />}
        {view === 'search' && (
          <SearchView
            key={search.key}
            vpsId={id}
            dir={cwd}
            initialTerm={search.term}
            onOpenFile={onOpenFile}
            onNavigate={(dir, select) => navigate(dir, select ? [select] : [])}
            onClose={() => setView('files')}
          />
        )}

        {/* Lista de arquivos */}
        <div
          className={`relative flex min-w-0 flex-1 flex-col ${dropHint?.key === cwd ? 'ring-2 ring-accent ring-inset' : ''} ${view !== 'files' ? 'hidden' : ''}`}
          {...dropProps({ dir: cwd })}
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
            className="relative min-h-0 flex-1 overflow-auto outline-none"
            onMouseDown={(e) => !(e.target as HTMLElement).closest('[data-name-cell]') && marquee.start(e)}
            onContextMenu={backgroundMenu}
            onDragOverCapture={autoScrollOnDrag}
          >
            {visible.map((e) => {
              const isSel = selected.has(e.path)
              return (
                <div
                  key={e.path}
                  data-path={e.path}
                  role="option"
                  aria-selected={isSel}
                  onClick={(ev) => releaseRow(ev, e)}
                  {...(e.isDir ? dropProps({ dir: e.path }, e.path) : {})}
                  onDoubleClick={() => open(e)}
                  onContextMenu={(ev) => rowMenu(ev, e)}
                  className={`${COLS} h-7 cursor-default items-center text-[13px] ${isSel ? 'bg-accent/25' : 'hover:bg-hover'} ${isCut(e.path) || dragging.has(e.path) ? 'opacity-50' : ''} ${dropHint?.key === e.path ? 'bg-accent/40 ring-1 ring-accent ring-inset' : ''} ${focus === e.path ? 'outline outline-1 -outline-offset-1 outline-accent/70' : ''}`}
                >
                  <div className="flex min-w-0 px-2">
                    {/* Só o ícone + nome "pegam" o item; o resto da linha inicia o retângulo de seleção. */}
                    <div
                      data-name-cell
                      draggable
                      className="flex min-w-0 items-center gap-2 pr-1"
                      onMouseDown={(ev) => pressRow(ev, e)}
                      onDragStart={(ev) => startItemDrag(ev, e)}
                    >
                      <FileIcon entry={e} />
                      <span className={`truncate ${e.name.startsWith('.') ? 'opacity-70' : ''}`}>{e.name}</span>
                    </div>
                  </div>
                  <div className="px-2 text-right text-xs text-muted">{e.isDir ? '' : formatSize(e.size)}</div>
                  <div className="px-2 text-xs text-muted">{formatDate(e.mtime)}</div>
                  <div className="px-2 font-mono text-[11px] text-muted">{e.perms}</div>
                  <div className="truncate px-2 text-xs text-muted">{e.owner}</div>
                </div>
              )
            })}
            {marquee.rect && <div className="pointer-events-none absolute border border-accent bg-accent/15" style={marquee.rect} />}
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
            {clipboard && (
              <span className="ml-auto">
                {clipboard.paths.length} item(ns) {clipboard.mode === 'cut' ? 'recortado(s)' : 'copiado(s)'}
                {clipboard.vpsId !== id && ' de outra VPS'} · Ctrl+V para colar
              </span>
            )}
          </div>
        </div>
      </div>

      {menu && <ContextMenu {...menu} onClose={closeMenu} />}
      {dropHint && (
        <div
          role="status"
          className="pointer-events-none fixed z-[70] rounded-md border border-line bg-panel-2 px-2 py-1 text-xs shadow-lg"
          style={{ left: dropHint.x + 16, top: dropHint.y + 18 }}
        >
          {dropHint.text}
          {dropHint.sub && <div className="mt-0.5 text-[11px] text-muted">{dropHint.sub}</div>}
        </div>
      )}
      {compressFor && (
        <CompressDialog
          vpsId={id}
          entries={compressFor}
          onClose={() => setCompressFor(null)}
          onDone={(path) => {
            toast('success', `${baseName(path)} criado.`)
            refresh([path])
          }}
        />
      )}
      {permsFor && (
        <PermissionsDialog vpsId={id} entries={permsFor} onClose={() => setPermsFor(null)} onApplied={() => refresh(permsFor.map((e) => e.path))} />
      )}
    </div>
  )
}

interface NavButtonProps {
  label: string
  onClick: () => void
  disabled?: boolean
  icon: typeof Home
  spin?: boolean
  active?: boolean
  drop?: object
}

function NavButton({ label, onClick, disabled, icon: Icon, spin, active, drop }: NavButtonProps) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      {...drop}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-fg disabled:opacity-30 ${active ? 'bg-accent/40 text-fg ring-1 ring-accent' : ''}`}
    >
      <Icon size={15} className={spin ? 'animate-spin' : ''} />
    </button>
  )
}

function Crumb({ label, onClick, active, drop }: { label: string; onClick: () => void; active: boolean; drop: object }) {
  return (
    <button onClick={onClick} {...drop} className={`shrink truncate rounded px-1.5 py-0.5 font-mono text-xs hover:bg-hover ${active ? 'bg-accent/40 ring-1 ring-accent' : ''}`}>
      {label}
    </button>
  )
}
