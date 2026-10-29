import { StringDecoder } from 'node:string_decoder'
import type { ClientChannel } from 'ssh2'
import { AppError, toAppError } from './errors'
import { emit } from './events'
import { getSession, onSessionEnd, shellQuote } from './sessions'

const terms = new Map<string, { vpsId: string; stream: ClientChannel }>()

const clampSize = (n: unknown, fallback: number) =>
  Number.isInteger(n) && (n as number) > 0 && (n as number) < 1000 ? (n as number) : fallback

export async function openTerminal(termId: string, vpsId: string, cwd: string, cols: number, rows: number): Promise<void> {
  if (typeof termId !== 'string' || terms.has(termId)) throw new AppError('Terminal inválido.')
  const { client } = getSession(vpsId)
  const pty = { term: 'xterm-256color', cols: clampSize(cols, 80), rows: clampSize(rows, 24) }
  // Entra na pasta e substitui o processo pelo shell de login do usuário.
  const cd = typeof cwd === 'string' && cwd.startsWith('/') ? `cd -- ${shellQuote(cwd)} 2>/dev/null; ` : ''
  const stream = await new Promise<ClientChannel>((resolve, reject) =>
    client.exec(`${cd}exec "\${SHELL:-/bin/sh}" -l`, { pty }, (e, s) => (e ? reject(toAppError(e)) : resolve(s)))
  )
  terms.set(termId, { vpsId, stream })
  const out = new StringDecoder('utf8')
  const errOut = new StringDecoder('utf8')
  stream.on('data', (d: Buffer) => emit('terminal:data', termId, out.write(d)))
  stream.stderr.on('data', (d: Buffer) => emit('terminal:data', termId, errOut.write(d)))
  stream.on('close', () => {
    if (terms.delete(termId)) emit('terminal:exit', termId)
  })
}

export function writeTerminal(termId: string, data: string): void {
  if (typeof data === 'string') terms.get(termId)?.stream.write(data)
}

export function resizeTerminal(termId: string, cols: number, rows: number): void {
  terms.get(termId)?.stream.setWindow(clampSize(rows, 24), clampSize(cols, 80), 0, 0)
}

export function closeTerminal(termId: string): void {
  const t = terms.get(termId)
  if (!t) return
  terms.delete(termId)
  t.stream.close()
}

onSessionEnd((vpsId) => {
  for (const [termId, t] of terms) {
    if (t.vpsId !== vpsId) continue
    terms.delete(termId)
    emit('terminal:exit', termId)
  }
})
