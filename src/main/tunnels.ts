import { randomUUID } from 'node:crypto'
import { createServer, type Server, type Socket } from 'node:net'
import type { TunnelDef, TunnelStatus, VpsConnection } from '../shared/types'
import { AppError } from './errors'
import { getSession, onSessionEnd } from './sessions'
import { store } from './store'

/**
 * Túneis locais (`ssh -L`): um servidor TCP em 127.0.0.1 (nunca em todas as interfaces) que, para cada
 * conexão recebida, abre um canal `forwardOut` pela VPS até o destino. Só existem enquanto a sessão está
 * conectada; as definições ficam salvas na conexão, o estado "rodando" não.
 */

interface Running {
  vpsId: string
  server: Server
  sockets: Set<Socket>
  total: number
  error?: string
}

const running = new Map<string, Running>()
const HOST_RE = /^[A-Za-z0-9._:-]{1,253}$/

const validPort = (p: unknown): p is number => Number.isInteger(p) && (p as number) >= 1 && (p as number) <= 65535

function find(vpsId: string, tunnelId: string): TunnelDef {
  const def = store.get(vpsId).tunnels?.find((t) => t.id === tunnelId)
  if (!def) throw new AppError('Túnel não encontrado.')
  return def
}

export async function addTunnel(vpsId: string, input: Omit<TunnelDef, 'id'>): Promise<VpsConnection> {
  const c = store.get(vpsId)
  const remoteHost = typeof input?.remoteHost === 'string' ? input.remoteHost.trim() : ''
  if (!validPort(input?.localPort)) throw new AppError('Porta local inválida.')
  if (!HOST_RE.test(remoteHost)) throw new AppError('Host de destino inválido.')
  if (!validPort(input.remotePort)) throw new AppError('Porta de destino inválida.')
  const tunnels = c.tunnels ?? []
  if (tunnels.some((t) => t.localPort === input.localPort)) throw new AppError(`A porta local ${input.localPort} já tem um túnel nesta VPS.`)
  return store.setTunnels(vpsId, [...tunnels, { id: randomUUID(), localPort: input.localPort, remoteHost, remotePort: input.remotePort }])
}

export async function removeTunnel(vpsId: string, tunnelId: string): Promise<VpsConnection> {
  const c = store.get(vpsId)
  stop(tunnelId)
  return store.setTunnels(vpsId, (c.tunnels ?? []).filter((t) => t.id !== tunnelId))
}

export async function tunnelStatus(vpsId: string): Promise<Record<string, TunnelStatus>> {
  const out: Record<string, TunnelStatus> = {}
  for (const t of store.get(vpsId).tunnels ?? []) {
    const r = running.get(t.id)
    out[t.id] = r ? { running: true, active: r.sockets.size, total: r.total, error: r.error } : { running: false, active: 0, total: 0 }
  }
  return out
}

export async function startTunnel(vpsId: string, tunnelId: string): Promise<void> {
  const def = find(vpsId, tunnelId)
  if (running.has(tunnelId)) return
  const s = getSession(vpsId)
  const state: Running = { vpsId, server: createServer(), sockets: new Set(), total: 0 }
  state.server.on('connection', (sock) => {
    state.total++
    state.sockets.add(sock)
    sock.on('close', () => state.sockets.delete(sock))
    sock.on('error', () => sock.destroy())
    s.client.forwardOut(sock.remoteAddress ?? '127.0.0.1', sock.remotePort ?? 0, def.remoteHost, def.remotePort, (err, channel) => {
      if (err) {
        state.error = `${def.remoteHost}:${def.remotePort}: ${err.message}`
        return sock.destroy()
      }
      state.error = undefined
      channel.on('error', () => sock.destroy())
      sock.pipe(channel).pipe(sock)
      sock.on('close', () => channel.destroy())
    })
  })
  await new Promise<void>((resolve, reject) => {
    state.server.once('error', (e: NodeJS.ErrnoException) =>
      reject(new AppError(e.code === 'EADDRINUSE' ? `A porta ${def.localPort} já está em uso neste computador.` : `Não foi possível abrir a porta ${def.localPort}: ${e.message}`))
    )
    state.server.listen(def.localPort, '127.0.0.1', resolve)
  })
  state.server.on('error', () => {})
  running.set(tunnelId, state)
}

function stop(tunnelId: string): void {
  const r = running.get(tunnelId)
  if (!r) return
  running.delete(tunnelId)
  r.server.close()
  for (const sock of r.sockets) sock.destroy()
}

export async function stopTunnel(vpsId: string, tunnelId: string): Promise<void> {
  find(vpsId, tunnelId)
  stop(tunnelId)
}

onSessionEnd((vpsId) => {
  for (const [id, r] of running) if (r.vpsId === vpsId) stop(id)
})
