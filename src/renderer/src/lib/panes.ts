/**
 * Coordena os explorers abertos da mesma VPS (modo "dois painéis"): avisa quando um muda arquivos para
 * os outros recarregarem, e diz qual é a pasta do painel vizinho (destino de "copiar/mover para o outro painel").
 */

export interface Pane {
  vpsId: string
  /** Pasta aberta no painel, ou null se ele não está visível. */
  cwd: () => string | null
  reload: () => void
}

const panes = new Set<Pane>()

export function registerPane(pane: Pane): () => void {
  panes.add(pane)
  return () => void panes.delete(pane)
}

/** Recarrega os outros painéis da VPS (só a listagem; não propaga de volta). */
export function notifyFsChange(vpsId: string, origin: Pane | null): void {
  for (const p of panes) if (p !== origin && p.vpsId === vpsId) p.reload()
}

/** Pasta do outro painel visível da mesma VPS, se houver. */
export function peerCwd(vpsId: string, self: Pane): string | null {
  for (const p of panes) {
    if (p === self || p.vpsId !== vpsId) continue
    const dir = p.cwd()
    if (dir) return dir
  }
  return null
}

/** Itens arrastados dentro do app, compartilhados entre painéis (o navegador não deixa ler os dados durante o arraste). */
export const dragPaths: { current: string[] | null } = { current: null }
