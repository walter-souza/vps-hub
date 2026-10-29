import { useState } from 'react'
import { settle, useDialogs, type DialogRequest } from '../lib/dialogs'
import { Button, Input, Modal } from './ui'

export function DialogHost() {
  const req = useDialogs((s) => s.queue[0])
  if (!req) return null
  return req.kind === 'confirm' ? <ConfirmDialog key={queueKey(req)} req={req} /> : <PromptDialog key={queueKey(req)} req={req} />
}

const keys = new WeakMap<DialogRequest, number>()
let seq = 0
const queueKey = (req: DialogRequest) => {
  if (!keys.has(req)) keys.set(req, ++seq)
  return keys.get(req)
}

function ConfirmDialog({ req }: { req: Extract<DialogRequest, { kind: 'confirm' }> }) {
  return (
    <Modal
      title={req.title}
      onClose={() => settle(req, false)}
      footer={
        <>
          <Button onClick={() => settle(req, false)}>Cancelar</Button>
          <Button variant={req.danger ? 'danger' : 'primary'} onClick={() => settle(req, true)} autoFocus>
            {req.confirmLabel ?? 'Confirmar'}
          </Button>
        </>
      }
    >
      {req.message && <p className="text-muted">{req.message}</p>}
      {req.detail && req.detail.length > 0 && (
        <ul className="mt-3 max-h-40 overflow-auto rounded-md border border-line bg-bg p-2 font-mono text-xs">
          {req.detail.map((d) => (
            <li key={d} className="truncate">
              {d}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}

function PromptDialog({ req }: { req: Extract<DialogRequest, { kind: 'prompt' }> }) {
  const [value, setValue] = useState(req.initial ?? '')
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    const err = req.validate?.(value) ?? null
    if (err) return setError(err)
    settle(req, value)
  }

  return (
    <Modal
      title={req.title}
      onClose={() => settle(req, null)}
      footer={
        <>
          <Button onClick={() => settle(req, null)}>Cancelar</Button>
          <Button variant="primary" onClick={submit}>
            {req.confirmLabel ?? 'OK'}
          </Button>
        </>
      }
    >
      {req.message && <p className="mb-3 text-muted">{req.message}</p>}
      {req.label && <span className="mb-1 block text-xs font-medium text-muted">{req.label}</span>}
      <Input
        type={req.password ? 'password' : 'text'}
        value={value}
        autoFocus
        spellCheck={false}
        onFocus={(e) => {
          if (!req.selectStem) return e.currentTarget.select()
          const dot = e.currentTarget.value.lastIndexOf('.')
          e.currentTarget.setSelectionRange(0, dot > 0 ? dot : e.currentTarget.value.length)
        }}
        onChange={(e) => {
          setValue(e.target.value)
          setError(null)
        }}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </Modal>
  )
}
