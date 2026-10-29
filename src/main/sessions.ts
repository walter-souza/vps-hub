import { BrowserWindow, dialog, type MessageBoxOptions } from 'electron'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { connect as tcpConnect } from 'node:net'
import { homedir } from 'node:os'
import { Client, utils, type AuthenticationType, type ConnectConfig, type SFTPWrapper } from 'ssh2'
import type { SessionInfo, TestResult, VpsFields, VpsInput } from '../shared/types'
import { AppError, toAppError } from './errors'
import { emit } from './events'
import { cleanFields, store } from './store'

export interface Session {
  client: Client
  sftp: SFTPWrapper
  uid: number
  info: SessionInfo
}

const sessions = new Map<string, Session>()
const pending = new Map<string, Promise<SessionInfo>>()
const endListeners: ((id: string) => void)[] = []

/** Registra callback chamado quando uma sessão termina (queda ou desconexão). */
export function onSessionEnd(fn: (id: string) => void): void {
  endListeners.push(fn)
}

export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

export function getSession(id: string): Session {
  const s = sessions.get(id)
  if (!s) throw new AppError('A VPS está desconectada.', 'NOT_CONNECTED')
  return s
}

async function verifyHostKey(hostPort: string, fingerprint: string): Promise<boolean> {
  const known = store.hostKey(hostPort)
  if (known === fingerprint) return true
  const opts: MessageBoxOptions = known
    ? {
        type: 'warning',
        title: 'A identidade do servidor mudou',
        message: `ATENÇÃO: a host key de ${hostPort} mudou!`,
        detail:
          'Isso pode indicar um ataque man-in-the-middle, ou que o servidor foi reinstalado.\n\n' +
          `Anterior: ${known}\nAtual: ${fingerprint}\n\n` +
          'Só continue se tiver certeza de que o servidor foi reinstalado.',
        buttons: ['Cancelar', 'Confiar na nova chave'],
        defaultId: 0,
        cancelId: 0
      }
    : {
        type: 'question',
        title: 'Novo servidor',
        message: `Primeira conexão com ${hostPort}`,
        detail: `Fingerprint da host key:\n${fingerprint}\n\nConfirme que ela corresponde ao servidor antes de continuar.`,
        buttons: ['Confiar e conectar', 'Cancelar'],
        defaultId: 0,
        cancelId: 1
      }
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
  const accepted = known ? response === 1 : response === 0
  if (accepted) store.setHostKey(hostPort, fingerprint)
  return accepted
}

async function loadKey(keyPath: string, passphrase?: string): Promise<Buffer> {
  const path = keyPath.replace(/^~(?=$|[\\/])/, homedir())
  let data: Buffer
  try {
    data = await readFile(path)
  } catch {
    throw new AppError(`Não foi possível ler a chave: ${path}`)
  }
  const parsed = utils.parseKey(data, passphrase)
  if (parsed instanceof Error) {
    if (!passphrase && /passphrase|encrypted/i.test(parsed.message)) {
      throw new AppError('Esta chave é protegida por passphrase.', 'SECRET_REQUIRED')
    }
    if (passphrase) throw new AppError('Não foi possível abrir a chave: passphrase incorreta?', 'SECRET_REQUIRED')
    throw new AppError(`Chave inválida: ${parsed.message}`)
  }
  return data
}

async function openClient(f: VpsFields, secret: string | undefined): Promise<Client> {
  const config: ConnectConfig = {
    host: f.host,
    port: f.port,
    username: f.username,
    // Inclui o tempo em que o usuário confirma a host key no diálogo.
    readyTimeout: 60_000,
    keepaliveInterval: 15_000,
    keepaliveCountMax: 4
  }
  if (f.auth === 'password') {
    if (!secret) throw new AppError('Informe a senha.', 'SECRET_REQUIRED')
    config.password = secret
  } else {
    config.privateKey = await loadKey(f.keyPath, secret)
    config.passphrase = secret
  }

  // Começa com "none" para descobrir quais métodos o servidor aceita; assim, se nenhum dos
  // nossos for aceito, dá para explicar o motivo em vez de um genérico "autenticação falhou".
  const wanted: AuthenticationType[] = f.auth === 'password' ? ['password', 'keyboard-interactive'] : ['publickey']
  const tried = new Set<AuthenticationType>()
  let serverMethods: AuthenticationType[] | null = null
  config.authHandler = (authsLeft, _partial, next) => {
    if (!authsLeft) return next('none')
    serverMethods = authsLeft
    const method = wanted.find((m) => !tried.has(m) && authsLeft.includes(m))
    if (!method) return (next as unknown as (stop: false) => void)(false)
    tried.add(method)
    next(method)
  }
  const unsupportedMethod = (): AppError | null => {
    if (!serverMethods || wanted.some((m) => serverMethods!.includes(m))) return null
    const accepted = serverMethods.includes('publickey') ? 'apenas por chave SSH' : `apenas por: ${serverMethods.join(', ')}`
    return f.auth === 'password'
      ? new AppError(`Este servidor não aceita login por senha, ${accepted}. Edite a conexão e escolha "Chave SSH".`, 'AUTH_METHOD')
      : new AppError(`Este servidor não aceita login por chave SSH, ${accepted}.`, 'AUTH_METHOD')
  }

  const hostPort = `${f.host}:${f.port}`
  let hostRejected = false
  config.hostVerifier = (key: Buffer, verify: (ok: boolean) => void) => {
    const fp = 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
    verifyHostKey(hostPort, fp).then(
      (ok) => {
        hostRejected = !ok
        verify(ok)
      },
      () => {
        hostRejected = true
        verify(false)
      }
    )
  }

  return new Promise((resolve, reject) => {
    const client = new Client()
    const onError = (e: unknown) =>
      reject(
        hostRejected
          ? new AppError('Conexão cancelada: host key não confirmada.', 'HOST_REJECTED')
          : (unsupportedMethod() ?? toAppError(e))
      )
    client.once('error', onError)
    client.once('ready', () => {
      client.removeListener('error', onError)
      // Erros após o "ready" chegam também como "close"; sem listener o processo cairia.
      client.on('error', () => {})
      resolve(client)
    })
    // Alguns servidores pedem a senha via keyboard-interactive.
    client.on('keyboard-interactive', (_name, _instr, _lang, prompts, finish) => finish(prompts.map(() => secret ?? '')))
    client.connect(config)
  })
}

export function exec(client: Client, cmd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    client.exec(cmd, (err, stream) => {
      if (err) return reject(toAppError(err))
      const out: Buffer[] = []
      const errOut: Buffer[] = []
      stream.on('data', (d: Buffer) => out.push(d))
      stream.stderr.on('data', (d: Buffer) => errOut.push(d))
      stream.on('close', (code: number) =>
        resolve({ stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(errOut).toString('utf8'), code })
      )
    })
  })
}

async function sysInfo(client: Client): Promise<{ uid: number; user: string; os: string }> {
  const { stdout } = await exec(
    client,
    `id -u; id -un; (. /etc/os-release 2>/dev/null && printf '%s\\n' "$PRETTY_NAME") || uname -sr`
  )
  const [uid, user, os] = stdout.split('\n').map((l) => l.trim())
  return { uid: Number(uid), user: user ?? '', os: os || 'Desconhecido' }
}

export function connectSession(id: string, secretOverride?: string): Promise<SessionInfo> {
  const existing = sessions.get(id)
  if (existing) return Promise.resolve(existing.info)
  const inflight = pending.get(id)
  if (inflight) return inflight

  const p = (async () => {
    const c = store.get(id)
    const client = await openClient(c, secretOverride || store.getSecret(id))
    try {
      const sftp = await new Promise<SFTPWrapper>((res, rej) =>
        client.sftp((e, s) => (e ? rej(toAppError(e)) : res(s)))
      )
      const { uid, user, os } = await sysInfo(client)
      const home = await new Promise<string>((res, rej) =>
        sftp.realpath('.', (e, path) => (e ? rej(toAppError(e)) : res(path)))
      )
      const session: Session = { client, sftp, uid, info: { id, user, home, os } }
      sessions.set(id, session)
      client.on('close', () => {
        if (sessions.get(id) !== session) return
        sessions.delete(id)
        endListeners.forEach((fn) => fn(id))
        emit('session:closed', id)
      })
      store.touch(id)
      return session.info
    } catch (e) {
      client.end()
      throw e
    }
  })()
  pending.set(id, p)
  return p.finally(() => pending.delete(id))
}

export function disconnect(id: string): void {
  const s = sessions.get(id)
  if (!s) return
  sessions.delete(id)
  endListeners.forEach((fn) => fn(id))
  s.client.end()
}

export async function testConnection(input: VpsInput, id?: string): Promise<TestResult> {
  const fields = cleanFields(input)
  const existing = id ? store.get(id) : undefined
  const secret = input.secret || (existing && existing.auth === fields.auth ? store.getSecret(existing.id) : undefined)
  const client = await openClient(fields, secret)
  try {
    const start = Date.now()
    const { os } = await sysInfo(client)
    return { os, latencyMs: Date.now() - start }
  } finally {
    client.end()
  }
}

/** Mede a latência TCP até a porta SSH; null = inacessível. */
export function probe(id: string): Promise<number | null> {
  const { host, port } = store.get(id)
  return new Promise((resolve) => {
    const start = Date.now()
    const sock = tcpConnect({ host, port })
    const done = (v: number | null) => {
      sock.destroy()
      resolve(v)
    }
    sock.setTimeout(4000, () => done(null))
    sock.once('connect', () => done(Date.now() - start))
    sock.once('error', () => done(null))
  })
}
