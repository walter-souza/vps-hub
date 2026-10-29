import { app, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { VpsConnection, VpsFields, VpsInput } from '../shared/types'
import { AppError } from './errors'

interface StoredConnection extends VpsFields {
  id: string
  /** Segredo criptografado com safeStorage (DPAPI no Windows), em base64. */
  secret?: string
  lastConnectedAt?: number
}

interface StoreData {
  version: 1
  connections: StoredConnection[]
  /** "host:porta" -> fingerprint SHA256 da host key aceita. */
  knownHosts: Record<string, string>
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export function cleanFields(i: VpsInput): VpsFields {
  const name = str(i.name).trim()
  const host = str(i.host).trim()
  const username = str(i.username).trim()
  const port = Number(i.port)
  const auth = i.auth === 'key' ? 'key' : 'password'
  const keyPath = auth === 'key' ? str(i.keyPath).trim() : ''
  const initialPath = str(i.initialPath).trim()
  if (!name) throw new AppError('Informe um nome para a conexão.')
  if (!host) throw new AppError('Informe o host.')
  if (!username) throw new AppError('Informe o usuário.')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new AppError('Porta inválida.')
  if (auth === 'key' && !keyPath) throw new AppError('Selecione o arquivo da chave privada.')
  if (initialPath && !initialPath.startsWith('/') && !initialPath.startsWith('~')) {
    throw new AppError('A pasta inicial deve começar com "/" ou "~".')
  }
  const color = /^#[0-9a-f]{6}$/i.test(str(i.color)) ? i.color : '#3b82f6'
  const tags = Array.isArray(i.tags)
    ? [...new Set(i.tags.map((t) => str(t).trim()).filter(Boolean))].slice(0, 10)
    : []
  return { name, host, port, username, auth, keyPath, initialPath, color, tags }
}

async function encrypt(secret: string): Promise<string> {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new AppError('Criptografia do sistema indisponível; não é possível salvar a senha.')
  }
  return (await safeStorage.encryptStringAsync(secret)).toString('base64')
}

class ConnectionStore {
  private data: StoreData = { version: 1, connections: [], knownHosts: {} }
  private file = ''

  load(): void {
    this.file = join(app.getPath('userData'), 'vps-hub.json')
    if (!existsSync(this.file)) return
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as StoreData
      this.data = { version: 1, connections: parsed.connections ?? [], knownHosts: parsed.knownHosts ?? {} }
    } catch {
      // Preserva o arquivo ilegível em vez de sobrescrevê-lo na próxima gravação.
      renameSync(this.file, `${this.file}.corrupt-${Date.now()}`)
    }
  }

  private persist(): void {
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
    renameSync(tmp, this.file)
  }

  private toPublic({ secret, ...rest }: StoredConnection): VpsConnection {
    return { ...rest, hasSecret: !!secret }
  }

  list(): VpsConnection[] {
    return this.data.connections.map((c) => this.toPublic(c))
  }

  get(id: string): StoredConnection {
    const c = this.data.connections.find((x) => x.id === id)
    if (!c) throw new AppError('Conexão não encontrada.')
    return c
  }

  async getSecret(id: string): Promise<string | undefined> {
    const c = this.get(id)
    if (!c.secret) return undefined
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(Buffer.from(c.secret, 'base64'))
    // A chave do sistema foi trocada: regrava o segredo com a chave atual.
    if (shouldReEncrypt) {
      c.secret = await encrypt(result)
      this.persist()
    }
    return result
  }

  async save(input: VpsInput, id?: string): Promise<VpsConnection> {
    const fields = cleanFields(input)
    const existing = id ? this.get(id) : undefined
    let secret = existing && existing.auth === fields.auth ? existing.secret : undefined
    if (!input.rememberSecret) secret = undefined
    else if (input.secret) secret = await encrypt(input.secret)

    const next: StoredConnection = { ...existing, ...fields, id: existing?.id ?? randomUUID(), secret }
    if (existing) this.data.connections = this.data.connections.map((c) => (c.id === next.id ? next : c))
    else this.data.connections.push(next)
    this.persist()
    return this.toPublic(next)
  }

  remove(id: string): void {
    this.data.connections = this.data.connections.filter((c) => c.id !== id)
    this.persist()
  }

  touch(id: string): void {
    this.get(id).lastConnectedAt = Date.now()
    this.persist()
  }

  hostKey(hostPort: string): string | undefined {
    return this.data.knownHosts[hostPort]
  }

  setHostKey(hostPort: string, fingerprint: string): void {
    this.data.knownHosts[hostPort] = fingerprint
    this.persist()
  }
}

export const store = new ConnectionStore()
