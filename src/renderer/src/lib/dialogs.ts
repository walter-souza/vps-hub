import { create } from 'zustand'

export interface ConfirmOptions {
  title: string
  message?: string
  /** Lista curta exibida abaixo da mensagem (ex.: itens a excluir). */
  detail?: string[]
  confirmLabel?: string
  danger?: boolean
}

export interface PromptOptions {
  title: string
  message?: string
  label?: string
  initial?: string
  password?: boolean
  confirmLabel?: string
  validate?: (value: string) => string | null
  /** Seleciona o nome sem a extensão ao abrir (como o F2 do Windows). */
  selectStem?: boolean
}

export type DialogRequest =
  | (ConfirmOptions & { kind: 'confirm'; resolve: (v: boolean) => void })
  | (PromptOptions & { kind: 'prompt'; resolve: (v: string | null) => void })

export const useDialogs = create<{ queue: DialogRequest[] }>(() => ({ queue: [] }))

const push = (req: DialogRequest) => useDialogs.setState((s) => ({ queue: [...s.queue, req] }))

export const confirm = (opts: ConfirmOptions) =>
  new Promise<boolean>((resolve) => push({ ...opts, kind: 'confirm', resolve }))

export const prompt = (opts: PromptOptions) =>
  new Promise<string | null>((resolve) => push({ ...opts, kind: 'prompt', resolve }))

export function settle(req: DialogRequest, value: boolean | string | null): void {
  useDialogs.setState((s) => ({ queue: s.queue.filter((q) => q !== req) }))
  if (req.kind === 'confirm') req.resolve(value === true)
  else req.resolve(typeof value === 'string' ? value : null)
}
