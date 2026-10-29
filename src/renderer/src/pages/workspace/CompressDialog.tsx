import { useState } from 'react'
import { baseName, parentPath, validateName } from '../../../../shared/paths'
import type { ArchiveFormat, FileEntry, ToolInstallInfo } from '../../../../shared/types'
import { Button, Field, Input, Modal } from '../../components/ui'
import { api, errCode, errMsg } from '../../lib/api'
import { toast } from '../../lib/store'

interface Props {
  vpsId: string
  entries: FileEntry[]
  onClose: () => void
  onDone: (archivePath: string) => void
}

const FORMATS: { value: ArchiveFormat; label: string; hint: string }[] = [
  { value: 'zip', label: '.zip', hint: 'abre direto no Windows; precisa do "zip" na VPS' },
  { value: 'tar.gz', label: '.tar.gz', hint: 'padrão no Linux; funciona em qualquer VPS' }
]

/** Nome sugerido: o próprio item (sem extensão, se for arquivo) ou a pasta atual, para vários itens. */
function suggestedStem(entries: FileEntry[]): string {
  if (entries.length > 1) return baseName(parentPath(entries[0].path)) || 'arquivos'
  const e = entries[0]
  const dot = e.isDir ? -1 : e.name.lastIndexOf('.')
  return dot > 0 ? e.name.slice(0, dot) : e.name
}

export function CompressDialog({ vpsId, entries, onClose, onDone }: Props) {
  const [format, setFormat] = useState<ArchiveFormat>('zip')
  const [name, setName] = useState(`${suggestedStem(entries)}.zip`)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Preenchido quando falta o "zip" na VPS: comando de instalação e se dá para rodar daqui.
  const [missing, setMissing] = useState<ToolInstallInfo | null>(null)
  const [installing, setInstalling] = useState(false)

  // Trocar o formato troca a extensão do nome.
  const pickFormat = (f: ArchiveFormat) => {
    setMissing(null)
    setError(null)
    setName((n) => n.replace(/\.(zip|tar\.gz)$/i, '') + `.${f}`)
    setFormat(f)
  }

  const submit = async () => {
    const invalid = validateName(name)
    if (invalid) return setError(invalid)
    setBusy(true)
    setError(null)
    try {
      const path = await api.fs.compress(vpsId, entries.map((e) => e.path), format, name.trim())
      onDone(path)
      onClose()
    } catch (e) {
      if (errCode(e) === 'MISSING_TOOL') {
        setMissing(await api.fs.toolInstallInfo(vpsId, 'zip').catch(() => ({ command: null, canInstall: false })))
      }
      setError(errMsg(e))
      setBusy(false)
    }
  }

  /** Instala o zip na VPS e, dando certo, compacta em seguida. */
  const install = async () => {
    setInstalling(true)
    setError(null)
    try {
      await api.fs.installTool(vpsId, 'zip')
      toast('success', '"zip" instalado na VPS.')
      setMissing(null)
      await submit()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setInstalling(false)
    }
  }

  return (
    <Modal
      title="Compactar"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={submit} disabled={busy || installing}>
            {busy ? 'Compactando…' : 'Compactar'}
          </Button>
        </>
      }
    >
      <p className="mb-3 truncate text-muted">{entries.length === 1 ? entries[0].name : `${entries.length} itens`}</p>
      <div className="mb-3 inline-flex rounded-md border border-line bg-bg p-0.5" role="radiogroup" aria-label="Formato">
        {FORMATS.map((f) => (
          <button
            key={f.value}
            type="button"
            role="radio"
            aria-checked={format === f.value}
            title={f.hint}
            onClick={() => pickFormat(f.value)}
            className={`h-7 rounded px-3 text-xs font-medium ${format === f.value ? 'bg-accent text-white' : 'text-muted hover:text-fg'}`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <Field label="Nome do arquivo" hint={FORMATS.find((f) => f.value === format)?.hint}>
        <Input
          value={name}
          autoFocus
          spellCheck={false}
          onChange={(e) => {
            setName(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </Field>
      {error && <p className="mt-2 text-xs whitespace-pre-line text-danger">{error}</p>}
      {missing && (
        <div className="mt-3 rounded-md border border-line bg-bg p-3 text-xs" role="region" aria-label="Instalar zip">
          {missing.command && (
            <>
              <span className="text-muted">Comando de instalação:</span>
              <code className="mt-1 block rounded bg-panel-2 px-2 py-1.5 font-mono text-[12px] select-text">{missing.command}</code>
            </>
          )}
          {missing.reason && <p className="mt-2 text-muted">{missing.reason}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {missing.canInstall && (
              <Button size="sm" variant="primary" onClick={install} disabled={installing}>
                {installing ? 'Instalando…' : 'Instalar agora'}
              </Button>
            )}
            <Button size="sm" onClick={() => pickFormat('tar.gz')} disabled={installing}>
              Usar .tar.gz
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
