import type { ClientChannel, Stats } from 'ssh2'
import { baseName, parentPath } from '../shared/paths'
import type { SearchQuery, SearchResponse, SearchResult } from '../shared/types'
import { AppError, toAppError } from './errors'
import { call, remotePath } from './files'
import { getSession, shellQuote as q } from './sessions'

const LIMIT = 500
const MAX_FILE = '-size -5120k' // conteúdo: ignora arquivos com 5 MB ou mais
const running = new Map<string, { stream: ClientChannel; canceled: boolean }>()

const globEscape = (s: string) => s.replace(/[*?[\]\\]/g, '\\$&')

function buildCommand(dir: string, { term, mode, caseSensitive, skipHeavy }: SearchQuery): string {
  // Pseudo-sistemas de arquivos (/proc pode travar leituras) e a lixeira nunca entram.
  const prune = ['-path /proc', '-path /sys', '-path /dev', '-name .vpshub-trash']
  if (skipHeavy) prune.push('-name node_modules', '-name .git')
  const find = `find ${q(dir)} \\( ${prune.join(' -o ')} \\) -prune -o`
  if (mode === 'name') return `${find} ${caseSensitive ? '-name' : '-iname'} ${q(`*${globEscape(term)}*`)} -print0 2>/dev/null`

  // Saída de ambos os ramos: "<caminho>\0<linha>:<texto>\n" (primeira ocorrência por arquivo).
  // GNU grep faz isso direto (-Z, e -I pula binários); no BusyBox o laço monta o mesmo formato.
  const flags = `-n -m1 -F${caseSensitive ? '' : ' -i'}`
  const files = `${find} -type f ${MAX_FILE} -print0 2>/dev/null | xargs -0 -r`
  const loop = `for f; do r=$(grep ${flags} -- "$0" "$f" 2>/dev/null) && printf "%s\\000%s\\n" "$f" "$r"; done`
  return (
    `if grep --version 2>/dev/null | grep -q GNU; ` +
    `then ${files} grep -IH ${flags} -Z -- ${q(term)} 2>/dev/null; ` +
    `else ${files} sh -c ${q(loop)} ${q(term)}; fi`
  )
}

/** Separa a saída em registros sem decodificar UTF-8 no meio de um caractere. */
function takeRecords(buf: Buffer, mode: SearchQuery['mode']): { records: { path: string; rest?: string }[]; remainder: Buffer } {
  const records: { path: string; rest?: string }[] = []
  let start = 0
  while (start < buf.length) {
    const nul = buf.indexOf(0, start)
    if (nul < 0) break
    if (mode === 'name') {
      records.push({ path: buf.subarray(start, nul).toString('utf8') })
      start = nul + 1
      continue
    }
    const nl = buf.indexOf(10, nul + 1)
    if (nl < 0) break
    records.push({ path: buf.subarray(start, nul).toString('utf8'), rest: buf.subarray(nul + 1, nl).toString('utf8') })
    start = nl + 1
  }
  return { records, remainder: buf.subarray(start) }
}

export async function search(id: string, searchId: string, query: SearchQuery): Promise<SearchResponse> {
  const s = getSession(id)
  const dir = remotePath(query?.dir)
  const term = typeof query.term === 'string' ? query.term : ''
  if (!term || term.length > 200 || /[\0\r\n]/.test(term)) throw new AppError('Termo de busca inválido.')
  if (query.mode !== 'name' && query.mode !== 'content') throw new AppError('Tipo de busca inválido.')
  if (typeof searchId !== 'string' || running.has(searchId)) throw new AppError('Busca inválida.')

  const found: { path: string; rest?: string }[] = []
  let truncated = false
  const stream = await new Promise<ClientChannel>((resolve, reject) =>
    s.client.exec(buildCommand(dir, { ...query, term }), (err, ch) => (err ? reject(toAppError(err)) : resolve(ch)))
  )
  const job = { stream, canceled: false }
  running.set(searchId, job)
  try {
    await new Promise<void>((resolve) => {
      let pending: Buffer = Buffer.alloc(0)
      stream.on('data', (chunk: Buffer) => {
        if (truncated || job.canceled) return
        const { records, remainder } = takeRecords(Buffer.concat([pending, chunk]), query.mode)
        pending = remainder
        for (const r of records) {
          if (r.path === dir) continue
          if (found.length === LIMIT) {
            truncated = true
            stop(stream)
            break
          }
          found.push(r)
        }
      })
      stream.stderr.on('data', () => {})
      stream.on('close', () => resolve())
    })
  } finally {
    running.delete(searchId)
  }

  const results = await Promise.all(
    found.map(async ({ path, rest }): Promise<SearchResult> => {
      const st = await call<Stats>((cb) => s.sftp.stat(path, cb)).catch(() => null)
      const sep = rest?.indexOf(':') ?? -1
      return {
        path,
        name: baseName(path),
        parent: parentPath(path),
        isDir: st?.isDirectory() ?? false,
        size: st?.size ?? 0,
        mtime: st?.mtime ?? 0,
        ...(rest !== undefined && sep > 0
          ? { line: Number(rest.slice(0, sep)), preview: rest.slice(sep + 1).trim().slice(0, 200) }
          : {})
      }
    })
  )
  return { results, truncated, canceled: job.canceled }
}

function stop(stream: ClientChannel): void {
  // Encerra find/grep no servidor (se suportado) e fecha o canal; o resto morre por SIGPIPE.
  try {
    stream.signal('TERM')
  } catch {
    // servidor sem suporte a sinais
  }
  stream.close()
}

export function cancelSearch(searchId: string): void {
  const job = running.get(searchId)
  if (!job) return
  job.canceled = true
  stop(job.stream)
}
