import { CheckCircle2, FolderOpen, Loader2, XCircle } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { AuthMethod, VpsConnection, VpsInput } from '../../../shared/types'
import { Button, Field, Input, Modal } from '../components/ui'
import { api, errMsg } from '../lib/api'
import { useApp } from '../lib/store'

export const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#ec4899', '#14b8a6', '#64748b']

interface Props {
  conn?: VpsConnection
  duplicate?: boolean
  onClose: () => void
}

export function ConnectionForm({ conn, duplicate, onClose }: Props) {
  const upsert = useApp((s) => s.upsertConnection)
  const editId = conn && !duplicate ? conn.id : undefined
  const [f, setF] = useState(() => ({
    name: conn ? (duplicate ? `${conn.name} (cópia)` : conn.name) : '',
    host: conn?.host ?? '',
    port: String(conn?.port ?? 22),
    username: conn?.username ?? 'root',
    auth: (conn?.auth ?? 'password') as AuthMethod,
    keyPath: conn?.keyPath ?? '',
    initialPath: conn?.initialPath ?? '',
    color: conn?.color ?? COLORS[0],
    tags: conn?.tags.join(', ') ?? '',
    secret: '',
    rememberSecret: true
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [test, setTest] = useState<{ state: 'running' } | { state: 'ok' | 'fail'; text: string } | null>(null)

  const set = <K extends keyof typeof f>(key: K, value: (typeof f)[K]) => {
    setF((prev) => ({ ...prev, [key]: value }))
    setTest(null)
  }

  const hasSavedSecret = !!editId && !!conn?.hasSecret && conn.auth === f.auth
  const toInput = (): VpsInput => ({
    ...f,
    port: Number(f.port),
    tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean)
  })

  const runTest = async () => {
    setTest({ state: 'running' })
    try {
      const r = await api.connections.test(toInput(), editId)
      setTest({ state: 'ok', text: `Conectado: ${r.os} (${r.latencyMs} ms)` })
    } catch (e) {
      setTest({ state: 'fail', text: errMsg(e) })
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      upsert(await api.connections.save(toInput(), editId))
      onClose()
    } catch (err) {
      setError(errMsg(err))
      setSaving(false)
    }
  }

  const browseKey = async () => {
    const path = await api.connections.pickKeyFile()
    if (path) set('keyPath', path)
  }

  const secretLabel = f.auth === 'password' ? 'Senha' : 'Passphrase da chave'
  return (
    <Modal title={editId ? 'Editar conexão' : 'Nova conexão'} onClose={onClose} width="max-w-xl">
      <form id="conn-form" onSubmit={submit} className="grid grid-cols-6 gap-3 pb-1">
        <Field label="Nome" className="col-span-6">
          <Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Produção API" autoFocus />
        </Field>
        <Field label="Host ou IP" className="col-span-4">
          <Input value={f.host} onChange={(e) => set('host', e.target.value)} placeholder="203.0.113.10" spellCheck={false} />
        </Field>
        <Field label="Porta" className="col-span-2">
          <Input value={f.port} onChange={(e) => set('port', e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
        </Field>
        <Field label="Usuário" className="col-span-6">
          <Input value={f.username} onChange={(e) => set('username', e.target.value)} spellCheck={false} />
        </Field>

        <div className="col-span-6">
          <span className="mb-1 block text-xs font-medium text-muted">Autenticação</span>
          <div className="inline-flex rounded-md border border-line bg-bg p-0.5" role="radiogroup">
            {(['password', 'key'] as const).map((a) => (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={f.auth === a}
                onClick={() => set('auth', a)}
                className={`h-7 rounded px-3 text-xs font-medium ${f.auth === a ? 'bg-accent text-white' : 'text-muted hover:text-fg'}`}
              >
                {a === 'password' ? 'Senha' : 'Chave SSH'}
              </button>
            ))}
          </div>
        </div>

        {f.auth === 'key' && (
          <Field label="Arquivo da chave privada" className="col-span-6" hint="OpenSSH (id_ed25519, id_rsa…) ou PuTTY (.ppk).">
            <div className="flex gap-2">
              <Input
                value={f.keyPath}
                onChange={(e) => set('keyPath', e.target.value)}
                placeholder="C:\Users\voce\.ssh\id_ed25519"
                spellCheck={false}
              />
              <Button onClick={browseKey}>
                <FolderOpen size={14} /> Procurar
              </Button>
            </div>
          </Field>
        )}

        <Field
          label={f.auth === 'key' ? `${secretLabel} (se houver)` : secretLabel}
          className="col-span-6"
          hint={hasSavedSecret ? 'Deixe em branco para manter a que está salva.' : undefined}
        >
          <Input
            type="password"
            value={f.secret}
            onChange={(e) => set('secret', e.target.value)}
            placeholder={hasSavedSecret ? '•••••••• (salva)' : ''}
          />
        </Field>
        <label className="col-span-6 -mt-1 flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={f.rememberSecret}
            onChange={(e) => set('rememberSecret', e.target.checked)}
            className="accent-accent"
          />
          Lembrar {f.auth === 'password' ? 'a senha' : 'a passphrase'} (criptografada pelo Windows)
        </label>

        <Field label="Pasta inicial" className="col-span-3" hint="Vazio = home do usuário.">
          <Input value={f.initialPath} onChange={(e) => set('initialPath', e.target.value)} placeholder="/var/www" spellCheck={false} />
        </Field>
        <Field label="Tags" className="col-span-3" hint="Separadas por vírgula.">
          <Input value={f.tags} onChange={(e) => set('tags', e.target.value)} placeholder="prod, cliente-x" />
        </Field>

        <div className="col-span-6">
          <span className="mb-1 block text-xs font-medium text-muted">Cor</span>
          <div className="flex gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Cor ${c}`}
                onClick={() => set('color', c)}
                className={`h-6 w-6 rounded-full ring-offset-2 ring-offset-panel ${f.color === c ? 'ring-2 ring-fg' : ''}`}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>

        {test && (
          <div
            className={`col-span-6 flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${
              test.state === 'fail' ? 'border-red-900 bg-red-950/40 text-red-300' : 'border-line bg-bg'
            }`}
          >
            {test.state === 'running' && <Loader2 size={14} className="animate-spin" />}
            {test.state === 'ok' && <CheckCircle2 size={14} className="text-ok" />}
            {test.state === 'fail' && <XCircle size={14} />}
            {test.state === 'running' ? 'Testando conexão…' : test.text}
          </div>
        )}
        {error && <p className="col-span-6 text-xs text-danger">{error}</p>}
      </form>

      <div className="flex items-center gap-2 py-4">
        <Button onClick={runTest} disabled={test?.state === 'running'}>
          Testar conexão
        </Button>
        <div className="flex-1" />
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="primary" type="submit" form="conn-form" disabled={saving}>
          {saving ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    </Modal>
  )
}
