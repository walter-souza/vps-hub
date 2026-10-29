import { useEffect } from 'react'
import { DialogHost } from './components/DialogHost'
import { Toasts } from './components/Toasts'
import { api, errMsg } from './lib/api'
import { toast, useApp } from './lib/store'
import { Hub } from './pages/Hub'
import { Workspace } from './pages/workspace/Workspace'

export function App() {
  const view = useApp((s) => s.view)
  const activeId = useApp((s) => s.activeId)
  const sessionIds = useApp((s) => Object.keys(s.sessions).join(','))

  useEffect(() => {
    const app = useApp.getState()
    api.connections.list().then(app.setConnections, (e) => toast('error', errMsg(e)))
    const offClosed = api.session.onClosed((id) => useApp.getState().sessionClosed(id))
    const offProgress = api.transfers.onProgress((e) => useApp.getState().upsertTransfer(e))

    // Bloqueia o fechamento da janela com arquivos não salvos (o processo principal pergunta).
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (Object.values(useApp.getState().dirty).some((n) => n > 0)) e.preventDefault()
    }
    // Soltar arquivos fora da área de upload não deve abrir o arquivo na janela.
    const blockDrop = (e: DragEvent) => e.preventDefault()
    window.addEventListener('beforeunload', beforeUnload)
    window.addEventListener('dragover', blockDrop)
    window.addEventListener('drop', blockDrop)
    return () => {
      offClosed()
      offProgress()
      window.removeEventListener('beforeunload', beforeUnload)
      window.removeEventListener('dragover', blockDrop)
      window.removeEventListener('drop', blockDrop)
    }
  }, [])

  return (
    <div className="flex h-full flex-col">
      {view === 'hub' && <Hub />}
      {/* Um workspace por sessão, todos montados: trocar de VPS preserva abas, terminais e edições. */}
      {sessionIds
        .split(',')
        .filter(Boolean)
        .map((id) => (
          <Workspace key={id} id={id} hidden={view !== 'workspace' || activeId !== id} />
        ))}
      <DialogHost />
      <Toasts />
    </div>
  )
}
