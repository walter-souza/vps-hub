import { StringDecoder } from 'node:string_decoder'
import type { ClientChannel } from 'ssh2'
import type { LogSource } from '../shared/types'
import { AppError, toAppError } from './errors'
import { emit } from './events'
import { remotePath } from './files'
import { CONTAINER_RE, UNIT_RE } from './services'
import { getSession, onSessionEnd, shellQuote, sudoPrefix } from './sessions'

/**
 * Logs ao vivo: `journalctl -f`, `docker logs -f` ou `tail -F` rodando no servidor, com a saída enviada
 * ao renderer em pedaços (`log:data`). Os comandos são montados aqui a partir de campos validados.
 */

const HISTORY_LINES = 200
const streams = new Map<string, { vpsId: string; channel: ClientChannel }>()

function commandFor(source: LogSource): string {
  switch (source?.kind) {
    case 'journal': {
      if (source.unit !== undefined && (typeof source.unit !== 'string' || !UNIT_RE.test(source.unit))) throw new AppError('Nome de serviço inválido.')
      return `journalctl -f -n ${HISTORY_LINES} --no-pager${source.unit ? ` -u ${shellQuote(source.unit)}` : ''} 2>&1`
    }
    case 'docker': {
      if (typeof source.container !== 'string' || !CONTAINER_RE.test(source.container)) throw new AppError('Nome de contêiner inválido.')
      return `docker logs -f --tail ${HISTORY_LINES} -- ${shellQuote(source.container)} 2>&1`
    }
    case 'file': {
      const path = shellQuote(remotePath(source.path))
      // -F segue o arquivo mesmo se ele for recriado (rotação).
      return `tail -n ${HISTORY_LINES} -F -- ${path} 2>&1`
    }
    default:
      throw new AppError('Fonte de log inválida.')
  }
}

/**
 * O comando roda em segundo plano e um vigia mata o processo quando a entrada padrão fecha (ou seja,
 * quando o canal é fechado): sem pty, um `tail -f` de arquivo parado nunca perceberia que ninguém mais lê.
 * Processos em segundo plano num sh não interativo perdem o stdin, por isso ele é guardado no fd 3.
 * O comando precisa ser simples (sem subshell) para que o `kill` atinja o processo certo.
 */
const watched = (cmd: string) => `exec 3<&0; ${cmd} 3<&- & p=$!; (cat <&3 >/dev/null 2>&1; kill $p 2>/dev/null) >/dev/null 2>&1 & wait $p`

export async function startLog(streamId: string, vpsId: string, source: LogSource): Promise<void> {
  if (typeof streamId !== 'string' || streams.has(streamId)) throw new AppError('Fluxo de log inválido.')
  const s = getSession(vpsId)
  const script = watched(commandFor(source))
  // Em modo sudo o comando roda como root; a senha vai pela entrada padrão, antes do vigia.
  const cmd = s.sudo ? `${sudoPrefix(s.sudo.password)} sh -c ${shellQuote(script)}` : `sh -c ${shellQuote(script)}`
  const channel = await new Promise<ClientChannel>((resolve, reject) => s.client.exec(cmd, (e, ch) => (e ? reject(toAppError(e)) : resolve(ch))))
  if (s.sudo?.password !== undefined) channel.write(`${s.sudo.password}\n`)
  streams.set(streamId, { vpsId, channel })
  const out = new StringDecoder('utf8')
  channel.on('data', (d: Buffer) => emit('log:data', streamId, out.write(d)))
  channel.stderr.on('data', (d: Buffer) => emit('log:data', streamId, out.write(d)))
  channel.on('close', () => {
    if (streams.delete(streamId)) emit('log:end', streamId)
  })
}

export function stopLog(streamId: string): void {
  const s = streams.get(streamId)
  if (!s) return
  streams.delete(streamId)
  s.channel.close()
}

onSessionEnd((vpsId) => {
  for (const [id, s] of streams) {
    if (s.vpsId !== vpsId) continue
    streams.delete(id)
    emit('log:end', id)
  }
})
