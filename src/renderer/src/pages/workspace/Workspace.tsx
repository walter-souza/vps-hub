import { ArrowLeft, ArrowLeftRight, ChevronDown, FolderOpen, Plus, SquareTerminal, WifiOff, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { baseName } from '../../../../shared/paths'
import { Button } from '../../components/ui'
import { api, errCode, errMsg } from '../../lib/api'
import { connectVps } from '../../lib/connect'
import { confirm } from '../../lib/dialogs'
import { disposeModel } from '../../lib/monaco'
import { toast, useApp } from '../../lib/store'
import { EditorView, type OpenFile } from './EditorView'
import { Explorer } from './Explorer'
import { TerminalView } from './TerminalView'
import { Transfers } from './Transfers'

interface TermTab {
  id: string
  title: string
  cwd: string
}

const EXPLORER = 'explorer'
const TRANSFERS = 'transfers'

export function Workspace({ id, hidden }: { id: string; hidden: boolean }) {
  const session = useApp((s) => s.sessions[id])
  const vps = useApp((s) => s.connections.find((c) => c.id === id))
  const goHub = useApp((s) => s.goHub)
  const setDirty = useApp((s) => s.setDirty)
  const running = useApp((s) => s.transfers.some((t) => t.vpsId === id && t.status === 'running'))

  const [files, setFiles] = useState<OpenFile[]>([])
  const filesRef = useRef(files)
  filesRef.current = files
  const [tab, setTab] = useState(EXPLORER)
  const [terms, setTerms] = useState<TermTab[]>([])
  const termSeq = useRef(0)
  const [panel, setPanel] = useState({ open: false, tab: TRANSFERS })
  const [panelHeight, setPanelHeight] = useState(280)
  const [reconnecting, setReconnecting] = useState(false)

  useEffect(() => setDirty(id, files.filter((f) => f.content !== f.saved).length), [files, id, setDirty])

  // Abre o painel de transferências quando uma começa.
  useEffect(() => {
    if (running) setPanel((p) => (p.open ? p : { open: true, tab: TRANSFERS }))
  }, [running])

  const patchFile = (path: string, patch: Partial<OpenFile>) =>
    setFiles((fs) => fs.map((f) => (f.path === path ? { ...f, ...patch } : f)))

  const openFile = useCallback(
    async (path: string, line?: number) => {
      // seq muda a cada pedido, para rolar de novo mesmo que a linha seja a mesma.
      const reveal = line ? { line, seq: Date.now() } : undefined
      if (filesRef.current.some((f) => f.path === path)) {
        if (reveal) setFiles((fs) => fs.map((f) => (f.path === path ? { ...f, reveal } : f)))
        return setTab(path)
      }
      try {
        const { content, mtime } = await api.fs.read(id, path)
        setFiles((fs) => (fs.some((f) => f.path === path) ? fs : [...fs, { path, content, saved: content, mtime, saving: false, reveal }]))
        setTab(path)
      } catch (e) {
        toast('error', errMsg(e))
      }
    },
    [id]
  )

  const saveFile = async (path: string, force = false): Promise<void> => {
    const file = filesRef.current.find((f) => f.path === path)
    if (!file || file.saving) return
    const content = file.content
    patchFile(path, { saving: true })
    try {
      const mtime = await api.fs.write(id, path, content, force ? null : file.mtime)
      patchFile(path, { saved: content, mtime, saving: false })
    } catch (e) {
      patchFile(path, { saving: false })
      if (errCode(e) !== 'CONFLICT') return toast('error', `Falha ao salvar ${baseName(path)}: ${errMsg(e)}`)
      const overwrite = await confirm({
        title: 'Arquivo alterado no servidor',
        message: `"${baseName(path)}" foi modificado na VPS depois que você o abriu. Salvar vai sobrescrever essas mudanças.`,
        confirmLabel: 'Sobrescrever',
        danger: true
      })
      if (overwrite) return saveFile(path, true)
    }
  }

  const reloadFile = async (path: string) => {
    const file = filesRef.current.find((f) => f.path === path)
    if (!file) return
    if (file.content !== file.saved && !(await confirm({ title: 'Descartar alterações?', message: 'O arquivo será recarregado do servidor e suas alterações serão perdidas.', confirmLabel: 'Recarregar', danger: true }))) return
    try {
      const { content, mtime } = await api.fs.read(id, path)
      patchFile(path, { content, saved: content, mtime })
    } catch (e) {
      toast('error', errMsg(e))
    }
  }

  const closeFile = async (path: string) => {
    const file = filesRef.current.find((f) => f.path === path)
    if (!file) return
    if (file.content !== file.saved && !(await confirm({ title: `Fechar "${baseName(path)}"?`, message: 'As alterações não salvas serão perdidas.', confirmLabel: 'Fechar sem salvar', danger: true }))) return
    const rest = filesRef.current.filter((f) => f.path !== path)
    setFiles(rest)
    disposeModel(id, path)
    if (tab === path) setTab(rest.at(-1)?.path ?? EXPLORER)
  }

  const openTerminal = useCallback((cwd: string) => {
    const t = { id: crypto.randomUUID(), title: `Terminal ${++termSeq.current}`, cwd }
    setTerms((ts) => [...ts, t])
    setPanel({ open: true, tab: t.id })
  }, [])

  const closeTerminal = (termId: string) => {
    const rest = terms.filter((t) => t.id !== termId)
    setTerms(rest)
    if (panel.tab === termId) setPanel((p) => ({ ...p, tab: rest.at(-1)?.id ?? TRANSFERS }))
  }

  const reconnect = async () => {
    if (!vps) return
    setReconnecting(true)
    await connectVps(vps)
    setReconnecting(false)
  }

  const startResize = (e: ReactPointerEvent) => {
    const startY = e.clientY
    const startH = panelHeight
    const move = (ev: PointerEvent) => setPanelHeight(Math.max(120, Math.min(window.innerHeight * 0.75, startH + startY - ev.clientY)))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  if (!session || !vps) return null
  const panelTabClass = (active: boolean) =>
    `flex h-full items-center gap-1.5 border-b-2 px-3 text-xs ${active ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'}`

  return (
    <div className={`flex min-h-0 flex-1 flex-col ${hidden ? 'hidden' : ''}`}>
      {/* Barra de título com abas */}
      <header className="drag flex h-10 shrink-0 items-center gap-2 border-b border-line pr-[150px] pl-2">
        <Button variant="ghost" size="sm" onClick={goHub} title="Voltar ao Hub (a conexão continua aberta)">
          <ArrowLeft size={14} /> Hub
        </Button>
        <div className="flex min-w-0 shrink-0 items-center gap-2 pr-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: vps.color }} />
          <span className="font-semibold">{vps.name}</span>
          <span className="hidden font-mono text-xs text-muted lg:inline">
            {session.info.user}@{vps.host}
          </span>
        </div>
        <div className="no-drag flex h-full min-w-0 items-end gap-0.5 overflow-x-auto" role="tablist">
          <Tab active={tab === EXPLORER} onClick={() => setTab(EXPLORER)} icon={<FolderOpen size={13} />} label="Arquivos" />
          {files.map((f) => (
            <Tab
              key={f.path}
              active={tab === f.path}
              onClick={() => setTab(f.path)}
              label={baseName(f.path)}
              title={f.path}
              dirty={f.content !== f.saved}
              onClose={() => closeFile(f.path)}
            />
          ))}
        </div>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => (terms.length === 0 ? openTerminal('') : setPanel((p) => ({ ...p, open: !p.open })))}
          title="Terminal"
        >
          <SquareTerminal size={14} /> Terminal
        </Button>
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${session.closed ? 'bg-danger' : 'bg-ok'}`}
          title={session.closed ? 'Desconectado' : `Conectado · ${session.info.os}`}
        />
      </header>

      {session.closed && (
        <div className="flex shrink-0 items-center gap-3 border-b border-amber-900 bg-amber-950/50 px-4 py-2 text-amber-200" role="alert">
          <WifiOff size={15} />
          <span className="flex-1">A conexão com a VPS caiu. Os arquivos abertos continuam aqui; reconecte para salvar.</span>
          <Button size="sm" variant="primary" onClick={reconnect} disabled={reconnecting}>
            {reconnecting ? 'Reconectando…' : 'Reconectar'}
          </Button>
        </div>
      )}

      <main className="relative min-h-0 flex-1">
        <Explorer
          vps={vps}
          info={session.info}
          closed={session.closed}
          hidden={tab !== EXPLORER}
          onOpenFile={openFile}
          onOpenTerminal={openTerminal}
        />
        {files
          .filter((f) => f.path === tab)
          .map((f) => (
            <EditorView
              key={f.path}
              vpsId={id}
              file={f}
              onChange={(content) => patchFile(f.path, { content })}
              onSave={() => saveFile(f.path)}
              onReload={() => reloadFile(f.path)}
              onRevealed={() => patchFile(f.path, { reveal: undefined })}
            />
          ))}
      </main>

      {/* Painel inferior: mantido montado para não derrubar os terminais ao recolher */}
      <section className={`flex shrink-0 flex-col border-t border-line bg-panel ${panel.open ? '' : 'hidden'}`} style={{ height: panelHeight }}>
        <div className="h-1 shrink-0 cursor-row-resize hover:bg-accent/50" onPointerDown={startResize} aria-hidden />
        <div className="flex h-8 shrink-0 items-stretch border-b border-line px-1" role="tablist">
          <button role="tab" aria-selected={panel.tab === TRANSFERS} className={panelTabClass(panel.tab === TRANSFERS)} onClick={() => setPanel((p) => ({ ...p, tab: TRANSFERS }))}>
            <ArrowLeftRight size={13} /> Transferências
            {running && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />}
          </button>
          {terms.map((t) => (
            <div key={t.id} className={panelTabClass(panel.tab === t.id)}>
              <button role="tab" aria-selected={panel.tab === t.id} className="flex items-center gap-1.5" onClick={() => setPanel((p) => ({ ...p, tab: t.id }))} title={t.cwd || session.info.home}>
                <SquareTerminal size={13} /> {t.title}
              </button>
              <button aria-label={`Fechar ${t.title}`} className="rounded p-0.5 hover:bg-hover" onClick={() => closeTerminal(t.id)}>
                <X size={12} />
              </button>
            </div>
          ))}
          <button aria-label="Novo terminal" title="Novo terminal" className="px-2 text-muted hover:text-fg" onClick={() => openTerminal('')} disabled={session.closed}>
            <Plus size={14} />
          </button>
          <div className="flex-1" />
          <button aria-label="Recolher painel" title="Recolher painel" className="px-2 text-muted hover:text-fg" onClick={() => setPanel((p) => ({ ...p, open: false }))}>
            <ChevronDown size={15} />
          </button>
        </div>
        <div className="relative min-h-0 flex-1">
          {terms.map((t) => (
            <TerminalView key={t.id} termId={t.id} vpsId={id} cwd={t.cwd} hidden={panel.tab !== t.id} />
          ))}
          {panel.tab === TRANSFERS && <Transfers vpsId={id} />}
        </div>
      </section>
    </div>
  )
}

interface TabProps {
  active: boolean
  onClick: () => void
  label: string
  title?: string
  icon?: ReactNode
  dirty?: boolean
  onClose?: () => void
}

function Tab({ active, onClick, label, title, icon, dirty, onClose }: TabProps) {
  return (
    <div
      role="tab"
      aria-selected={active}
      title={title}
      onClick={onClick}
      onAuxClick={(e) => e.button === 1 && onClose?.()}
      className={`group flex h-8 max-w-48 shrink-0 cursor-default items-center gap-1.5 rounded-t-md px-3 text-xs ${
        active ? 'bg-panel text-fg' : 'text-muted hover:bg-panel/60 hover:text-fg'
      }`}
    >
      {icon}
      <span className="truncate">{label}</span>
      {onClose && (
        <button
          aria-label={`Fechar ${label}`}
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          className="flex h-4 w-4 items-center justify-center rounded hover:bg-hover"
        >
          {dirty ? <span className="h-2 w-2 rounded-full bg-fg group-hover:hidden" /> : null}
          <X size={12} className={dirty ? 'hidden group-hover:block' : ''} />
        </button>
      )}
    </div>
  )
}
