import { create } from 'zustand'
import type { PasteMode, SessionInfo, TransferEvent, VpsConnection } from '../../../shared/types'

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  text: string
  action?: { label: string; run: () => void }
}

/** Itens copiados/recortados; compartilhada entre as VPS para permitir colar em outra. */
export interface Clipboard {
  vpsId: string
  paths: string[]
  mode: PasteMode
}

export interface SessionState {
  info: SessionInfo
  /** A conexão caiu; o workspace continua aberto para reconectar sem perder edições. */
  closed: boolean
}

interface AppState {
  view: 'hub' | 'workspace'
  activeId: string | null
  connections: VpsConnection[]
  sessions: Record<string, SessionState>
  /** Quantidade de arquivos não salvos por VPS. */
  dirty: Record<string, number>
  transfers: TransferEvent[]
  toasts: Toast[]
  clipboard: Clipboard | null

  setConnections(list: VpsConnection[]): void
  upsertConnection(c: VpsConnection): void
  removeConnection(id: string): void
  sessionOpened(info: SessionInfo): void
  sessionClosed(id: string): void
  sessionRemoved(id: string): void
  open(id: string): void
  goHub(): void
  setDirty(id: string, count: number): void
  upsertTransfer(e: TransferEvent): void
  clearTransfers(vpsId: string): void
  setClipboard(c: Clipboard | null): void
  toast(kind: Toast['kind'], text: string, action?: Toast['action']): void
  dismissToast(id: number): void
}

let toastSeq = 0

export const useApp = create<AppState>((set, get) => ({
  view: 'hub',
  activeId: null,
  connections: [],
  sessions: {},
  dirty: {},
  transfers: [],
  toasts: [],
  clipboard: null,

  setConnections: (connections) => set({ connections }),
  upsertConnection: (c) =>
    set((s) => ({
      connections: s.connections.some((x) => x.id === c.id)
        ? s.connections.map((x) => (x.id === c.id ? c : x))
        : [...s.connections, c]
    })),
  removeConnection: (id) => set((s) => ({ connections: s.connections.filter((c) => c.id !== id) })),

  sessionOpened: (info) => set((s) => ({ sessions: { ...s.sessions, [info.id]: { info, closed: false } } })),
  sessionClosed: (id) =>
    set((s) => (s.sessions[id] ? { sessions: { ...s.sessions, [id]: { ...s.sessions[id], closed: true } } } : {})),
  sessionRemoved: (id) =>
    set((s) => {
      const { [id]: _removed, ...sessions } = s.sessions
      const { [id]: _dirty, ...dirty } = s.dirty
      const clipboard = s.clipboard?.vpsId === id ? null : s.clipboard
      return { sessions, dirty, clipboard, ...(s.activeId === id ? { activeId: null, view: 'hub' as const } : {}) }
    }),

  open: (id) => set({ activeId: id, view: 'workspace' }),
  goHub: () => set({ view: 'hub' }),

  setDirty: (id, count) => set((s) => (s.dirty[id] === count ? {} : { dirty: { ...s.dirty, [id]: count } })),

  upsertTransfer: (e) =>
    set((s) => ({
      transfers: s.transfers.some((t) => t.id === e.id)
        ? s.transfers.map((t) => (t.id === e.id ? e : t))
        : [e, ...s.transfers].slice(0, 200)
    })),
  clearTransfers: (vpsId) =>
    set((s) => ({ transfers: s.transfers.filter((t) => t.vpsId !== vpsId || t.status === 'running') })),

  setClipboard: (clipboard) => set({ clipboard }),
  toast: (kind, text, action) => {
    const id = ++toastSeq
    set((s) => ({ toasts: [...s.toasts, { id, kind, text, action }] }))
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 8000 : 5000)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))

export const toast = (kind: Toast['kind'], text: string, action?: Toast['action']) =>
  useApp.getState().toast(kind, text, action)
