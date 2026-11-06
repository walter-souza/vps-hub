import { protocol } from 'electron'
import { Readable } from 'node:stream'
import type { Stats } from 'ssh2'
import { mediaInfo, normalizePath } from '../shared/paths'
import { call } from './files'
import { getSession } from './sessions'

/**
 * Áudio, vídeo e PDF são servidos ao renderer por um esquema próprio, `vpshub-media://<id da VPS>/<caminho>`,
 * em streaming a partir do SFTP e com suporte a Range (avançar no vídeo não baixa o arquivo todo).
 * Só responde a extensões de mídia conhecidas e a VPS conectadas; o resto é 403/404.
 */
export const MEDIA_SCHEME = 'vpshub-media'

/** Precisa rodar antes de app.whenReady(). */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])
}

const fail = (status: number, text: string) => new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })

/** "bytes=0-99", "bytes=100-" ou "bytes=-500" → intervalo inclusivo, ou null se inválido. */
function parseRange(header: string, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (m[1] === '' && m[2] === '')) return null
  let start: number
  let end: number
  if (m[1] === '') {
    start = Math.max(0, size - Number(m[2]))
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  }
  return start <= end && start < size ? { start, end } : null
}

export function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (req) => {
    try {
      const url = new URL(req.url)
      let path: string
      try {
        path = normalizePath(decodeURIComponent(url.pathname))
      } catch {
        return fail(400, 'Caminho inválido.')
      }
      const info = mediaInfo(path)
      if (!info) return fail(403, 'Tipo de arquivo não permitido.')
      let session
      try {
        session = getSession(url.hostname)
      } catch {
        return fail(404, 'VPS desconectada.')
      }
      const { sftp } = session
      const st = await call<Stats>((cb) => sftp.stat(path, cb))
      if (st.isDirectory()) return fail(404, 'É uma pasta.')

      const headers: Record<string, string> = { 'Content-Type': info.mime, 'Accept-Ranges': 'bytes' }
      const rangeHeader = req.headers.get('range')
      const range = rangeHeader ? parseRange(rangeHeader, st.size) : null
      if (rangeHeader && !range) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${st.size}` } })
      if (st.size === 0) return new Response(null, { status: 200, headers: { ...headers, 'Content-Length': '0' } })

      const start = range?.start ?? 0
      const end = range?.end ?? st.size - 1
      const stream = sftp.createReadStream(path, { start, end })
      // Se o player desistir (troca de aba, seek), o SFTP para de ler.
      req.signal.addEventListener('abort', () => stream.destroy())
      headers['Content-Length'] = String(end - start + 1)
      if (range) headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`
      return new Response(Readable.toWeb(stream) as ReadableStream, { status: range ? 206 : 200, headers })
    } catch (e) {
      return fail(500, (e as Error).message)
    }
  })
}
