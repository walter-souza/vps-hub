import { useEffect, useMemo, useState } from 'react'
import type { Accounts, FileEntry, PermChange } from '../../../../shared/types'
import { Button, Field, Input, Modal } from '../../components/ui'
import { api, errMsg } from '../../lib/api'
import { toast } from '../../lib/store'

/** 9 bits na ordem rwx do dono, grupo e outros; null = diferente entre os itens selecionados. */
type Bits = (boolean | null)[]

const WHO = ['Dono', 'Grupo', 'Outros']
const WHAT = ['Ler', 'Escrever', 'Executar']
const PRESETS = [
  { mode: '755', hint: 'pastas e scripts' },
  { mode: '644', hint: 'arquivos comuns' },
  { mode: '600', hint: 'privado (ex.: .env, chaves)' }
]

/** "drwxr-xr-x" -> 9 booleanos. */
const parsePerms = (perms: string) => [...perms.slice(1, 10)].map((c) => c !== '-')
const bitValue = (i: number) => 1 << (8 - i)

function common<T>(values: T[]): T | null {
  return values.every((v) => v === values[0]) ? values[0] : null
}

interface Props {
  vpsId: string
  entries: FileEntry[]
  onClose: () => void
  onApplied: () => void
}

export function PermissionsDialog({ vpsId, entries, onClose, onApplied }: Props) {
  const initial = useMemo<Bits>(() => {
    const all = entries.map((e) => parsePerms(e.perms))
    return Array.from({ length: 9 }, (_, i) => common(all.map((b) => b[i])))
  }, [entries])
  const initialOwner = common(entries.map((e) => e.owner)) ?? ''
  const initialGroup = common(entries.map((e) => e.group)) ?? ''

  const [bits, setBits] = useState<Bits>(initial)
  const [octal, setOctal] = useState('')
  // Valor numérico digitado/atalho = permissão absoluta para todos os itens; clique numa caixa = só aquele bit.
  const [absolute, setAbsolute] = useState(false)
  const [owner, setOwner] = useState(initialOwner)
  const [group, setGroup] = useState(initialGroup)
  const [recursive, setRecursive] = useState(false)
  const [applyTo, setApplyTo] = useState<PermChange['applyTo']>('all')
  const [accounts, setAccounts] = useState<Accounts | null>(null)
  const [saving, setSaving] = useState(false)
  const hasDir = entries.some((e) => e.isDir)

  useEffect(() => {
    api.fs.accounts(vpsId).then(setAccounts, () => setAccounts({ users: [], groups: [], isRoot: false }))
  }, [vpsId])

  // Campo numérico acompanha as caixas (vazio quando há bits mistos).
  useEffect(() => {
    if (bits.some((b) => b === null)) return setOctal('')
    const n = bits.reduce((acc, b, i) => acc | (b ? bitValue(i) : 0), 0)
    setOctal(n.toString(8).padStart(3, '0'))
  }, [bits])

  const applyOctal = (value: string) => {
    setOctal(value)
    if (/^[0-7]{3}$/.test(value)) {
      const n = parseInt(value, 8)
      setAbsolute(true)
      setBits(Array.from({ length: 9 }, (_, i) => (n & bitValue(i)) !== 0))
    }
  }

  // Só entram no comando os bits que o usuário mudou.
  const change = useMemo(() => {
    let set = 0
    let clear = 0
    bits.forEach((b, i) => {
      if (b === null || (!absolute && b === initial[i])) return
      if (b) set |= bitValue(i)
      else clear |= bitValue(i)
    })
    const ownerChanged = owner.trim() !== '' && owner.trim() !== initialOwner
    const groupChanged = group.trim() !== '' && group.trim() !== initialGroup
    return { set, clear, owner: ownerChanged ? owner.trim() : undefined, group: groupChanged ? group.trim() : undefined }
  }, [bits, initial, absolute, owner, group, initialOwner, initialGroup])
  const nothingChanged = !change.set && !change.clear && !change.owner && !change.group

  const submit = async () => {
    setSaving(true)
    try {
      await api.fs.setPermissions(
        vpsId,
        entries.map((e) => e.path),
        { ...change, recursive: hasDir && recursive, applyTo: recursive ? applyTo : 'all' }
      )
      toast('success', 'Permissões alteradas.')
      onApplied()
      onClose()
    } catch (e) {
      toast('error', errMsg(e))
      onApplied() // parte pode ter sido aplicada
      setSaving(false)
    }
  }

  const title = entries.length === 1 ? entries[0].name : `${entries.length} itens`
  return (
    <Modal
      title="Permissões e dono"
      onClose={onClose}
      width="max-w-lg"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={submit} disabled={saving || nothingChanged}>
            {saving ? 'Aplicando…' : 'Aplicar'}
          </Button>
        </>
      }
    >
      <p className="mb-3 truncate text-muted" title={entries.map((e) => e.path).join('\n')}>
        {title}
        {entries.length > 1 && ' · valores diferentes entre os itens aparecem como "misto" e só mudam se você clicar'}
      </p>

      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-xs text-muted">
            <th />
            {WHAT.map((w) => (
              <th key={w} className="pb-1 font-medium">
                {w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {WHO.map((who, row) => (
            <tr key={who}>
              <td className="py-1 pr-3 text-muted">{who}</td>
              {WHAT.map((what, col) => {
                const i = row * 3 + col
                return (
                  <td key={what} className="text-center">
                    <input
                      type="checkbox"
                      aria-label={`${who}: ${what}`}
                      className="h-4 w-4 accent-accent"
                      checked={bits[i] === true}
                      ref={(el) => {
                        if (el) el.indeterminate = bits[i] === null
                      }}
                      onChange={(e) => setBits((b) => b.map((v, j) => (j === i ? e.target.checked : v)))}
                    />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <Field label="Numérico" className="w-24">
          <Input
            value={octal}
            maxLength={3}
            inputMode="numeric"
            placeholder="misto"
            aria-label="Permissão numérica"
            className="font-mono"
            onChange={(e) => applyOctal(e.target.value.replace(/[^0-7]/g, ''))}
          />
        </Field>
        <div className="flex flex-wrap gap-1.5 pb-0.5">
          {PRESETS.map((p) => (
            <Button key={p.mode} size="sm" onClick={() => applyOctal(p.mode)} title={p.hint}>
              {p.mode}
            </Button>
          ))}
        </div>
      </div>

      <datalist id="vpshub-users">
        {accounts?.users.map((u) => <option key={u} value={u} />)}
      </datalist>
      <datalist id="vpshub-groups">
        {accounts?.groups.map((g) => <option key={g} value={g} />)}
      </datalist>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Field label="Dono" hint={accounts && !accounts.isRoot ? 'Só root pode trocar o dono.' : undefined}>
          <Input
            list="vpshub-users"
            value={owner}
            placeholder={initialOwner ? '' : 'misto'}
            spellCheck={false}
            disabled={!!accounts && !accounts.isRoot}
            onChange={(e) => setOwner(e.target.value)}
          />
        </Field>
        <Field label="Grupo">
          <Input list="vpshub-groups" value={group} placeholder={initialGroup ? '' : 'misto'} spellCheck={false} onChange={(e) => setGroup(e.target.value)} />
        </Field>
      </div>

      {hasDir && (
        <div className="mt-4 rounded-md border border-line bg-bg p-3">
          <label className="flex items-center gap-2">
            <input type="checkbox" className="accent-accent" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} />
            Aplicar também a tudo dentro das pastas
          </label>
          {recursive && (
            <div className="mt-2 pl-6 text-xs text-muted">
              <div className="flex gap-4" role="radiogroup" aria-label="Aplicar permissões a">
                {(
                  [
                    ['all', 'Tudo'],
                    ['dirs', 'Só pastas'],
                    ['files', 'Só arquivos']
                  ] as const
                ).map(([value, label]) => (
                  <label key={value} className="flex items-center gap-1.5 text-fg">
                    <input type="radio" name="applyTo" className="accent-accent" checked={applyTo === value} onChange={() => setApplyTo(value)} />
                    {label}
                  </label>
                ))}
              </div>
              <p className="mt-2">
                Dica: para um site, use 755 em "Só pastas" e depois 644 em "Só arquivos". O dono e o grupo valem para tudo.
              </p>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
