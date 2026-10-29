import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir, userInfo } from 'node:os'
import { join, normalize } from 'node:path'
import type { SshConfigHost } from '../shared/types'

interface Block {
  patterns: string[]
  /** Chave em minúsculas -> valor; só o primeiro valor de cada chave conta. */
  values: Map<string, string>
}

const DEFAULT_KEYS = ['id_ed25519', 'id_ecdsa', 'id_rsa']

const expandHome = (p: string) => normalize(p.replace(/^~(?=$|[\\/])/, homedir()))
const unquote = (v: string) => v.replace(/^"(.*)"$/, '$1')

function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`, 'i')
}

/** Mesma regra do OpenSSH: casa algum padrão positivo e nenhum negado (!padrão). */
function blockMatches(block: Block, alias: string): boolean {
  let matched = false
  for (const p of block.patterns) {
    if (p.startsWith('!')) {
      if (globToRegex(p.slice(1)).test(alias)) return false
    } else if (globToRegex(p).test(alias)) matched = true
  }
  return matched
}

export function parseSshConfig(text: string): Block[] {
  const blocks: Block[] = [{ patterns: ['*'], values: new Map() }] // opções antes do primeiro Host valem para todos
  let current: Block | null = blocks[0]
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^(\S+?)\s*(?:=\s*|\s+)(.+)$/)
    if (!m) continue
    const key = m[1].toLowerCase()
    const value = m[2].trim()
    if (key === 'host') {
      current = { patterns: value.split(/\s+/).map(unquote), values: new Map() }
      blocks.push(current)
    } else if (key === 'match') {
      current = null // blocos Match dependem de condições em tempo de conexão; são ignorados
    } else if (current && !current.values.has(key)) {
      current.values.set(key, unquote(value))
    }
  }
  return blocks
}

export function resolveHosts(blocks: Block[]): SshConfigHost[] {
  const aliases = new Set<string>()
  for (const b of blocks.slice(1)) for (const p of b.patterns) if (!/[*?!]/.test(p)) aliases.add(p)

  return [...aliases].map((alias) => {
    const get = (key: string) => blocks.find((b) => blockMatches(b, alias) && b.values.has(key))?.values.get(key)
    const identity = get('identityfile')
    const fallbackKey = DEFAULT_KEYS.map((k) => join(homedir(), '.ssh', k)).find((p) => existsSync(p))
    const keyPath = identity ? expandHome(identity) : fallbackKey
    const port = Number(get('port') ?? 22)
    const proxy = get('proxyjump') ?? get('proxycommand')
    return {
      alias,
      host: get('hostname')?.replace(/%h/g, alias) ?? alias,
      port: Number.isInteger(port) ? port : 22,
      // Sem "User", o ssh usa o usuário local; o app faz o mesmo.
      username: get('user') ?? userInfo().username,
      auth: keyPath ? 'key' : 'password',
      keyPath: keyPath ?? '',
      warning: proxy
        ? 'Usa ProxyJump/ProxyCommand, que o VPS Hub ainda não suporta.'
        : identity && !existsSync(expandHome(identity))
          ? `Chave não encontrada: ${expandHome(identity)}`
          : undefined
    }
  })
}

export async function readSshConfig(): Promise<SshConfigHost[]> {
  const file = join(homedir(), '.ssh', 'config')
  if (!existsSync(file)) return []
  return resolveHosts(parseSshConfig(await readFile(file, 'utf8')))
}
