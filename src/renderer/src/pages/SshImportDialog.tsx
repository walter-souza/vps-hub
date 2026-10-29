import { AlertTriangle, KeyRound, Loader2, Lock } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { SshConfigHost } from '../../../shared/types'
import { Button, Modal } from '../components/ui'
import { api, errMsg } from '../lib/api'
import { toast, useApp } from '../lib/store'
import { COLORS } from './ConnectionForm'

export function SshImportDialog({ onClose }: { onClose: () => void }) {
  const connections = useApp((s) => s.connections)
  const upsert = useApp((s) => s.upsertConnection)
  const [hosts, setHosts] = useState<SshConfigHost[] | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)

  const exists = (h: SshConfigHost) =>
    connections.some((c) => c.host === h.host && c.port === h.port && c.username === h.username)

  useEffect(() => {
    api.connections.readSshConfig().then(
      (list) => {
        setHosts(list)
        // Pré-seleciona só o que é novo e deve funcionar como está.
        setChecked(new Set(list.filter((h) => !h.warning && !exists(h)).map((h) => h.alias)))
      },
      (e) => {
        toast('error', errMsg(e))
        setHosts([])
      }
    )
  }, []) // lê o arquivo uma vez ao abrir

  const submit = async () => {
    setImporting(true)
    let count = 0
    for (const [i, h] of (hosts ?? []).filter((x) => checked.has(x.alias)).entries()) {
      try {
        upsert(
          await api.connections.save({
            name: h.alias,
            host: h.host,
            port: h.port,
            username: h.username,
            auth: h.auth,
            keyPath: h.keyPath,
            initialPath: '',
            color: COLORS[i % COLORS.length],
            tags: ['ssh-config'],
            rememberSecret: true
          })
        )
        count++
      } catch (e) {
        toast('error', `${h.alias}: ${errMsg(e)}`)
      }
    }
    if (count > 0) toast('success', `${count} conexão(ões) importada(s).`)
    onClose()
  }

  const toggle = (alias: string) =>
    setChecked((s) => {
      const next = new Set(s)
      if (next.has(alias)) next.delete(alias)
      else next.add(alias)
      return next
    })

  return (
    <Modal
      title="Importar do ~/.ssh/config"
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={submit} disabled={importing || checked.size === 0}>
            {importing ? 'Importando…' : `Importar ${checked.size || ''}`}
          </Button>
        </>
      }
    >
      {hosts === null ? (
        <div className="flex items-center gap-2 py-6 text-muted">
          <Loader2 size={14} className="animate-spin" /> Lendo o arquivo…
        </div>
      ) : hosts.length === 0 ? (
        <p className="py-4 text-muted">Nenhum host encontrado em ~/.ssh/config.</p>
      ) : (
        <>
          <p className="mb-3 text-muted">
            Selecione os hosts que deseja adicionar ao Hub. Hosts que usam senha vão pedi-la ao conectar.
          </p>
          <ul className="max-h-80 overflow-auto rounded-md border border-line">
            {hosts.map((h) => {
              const already = exists(h)
              return (
                <li key={h.alias} className="border-b border-line last:border-b-0">
                  <label className={`flex items-start gap-3 px-3 py-2 ${already ? 'opacity-50' : 'hover:bg-hover'}`}>
                    <input
                      type="checkbox"
                      className="mt-1 accent-accent"
                      checked={checked.has(h.alias)}
                      disabled={already}
                      onChange={() => toggle(h.alias)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{h.alias}</span>
                        {already && <span className="text-[11px] text-muted">já cadastrada</span>}
                      </div>
                      <div className="truncate font-mono text-xs text-muted">
                        {h.username}@{h.host}
                        {h.port !== 22 && `:${h.port}`}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted">
                        {h.auth === 'key' ? <KeyRound size={11} /> : <Lock size={11} />}
                        {h.auth === 'key' ? h.keyPath : 'Senha'}
                      </div>
                      {h.warning && (
                        <div className="mt-1 flex items-center gap-1 text-[11px] text-warn">
                          <AlertTriangle size={11} /> {h.warning}
                        </div>
                      )}
                    </div>
                  </label>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </Modal>
  )
}
