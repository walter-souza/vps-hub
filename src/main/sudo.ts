import type { Client } from 'ssh2'
import { SFTP } from 'ssh2/lib/protocol/SFTP.js'
import type { SessionInfo } from '../shared/types'
import { AppError, toAppError } from './errors'
import { emit } from './events'
import { exec, getSession, shellQuote, sudoPrefix, type Session } from './sessions'

/**
 * Modo sudo: abre um segundo canal SFTP em que o próprio sftp-server roda como root
 * (`sudo sftp-server`). Enquanto o modo está ligado, `session.sftp` aponta para ele, e assim listar,
 * ler, gravar, renomear, enviar e baixar passam a valer para qualquer arquivo; os comandos remotos
 * (lixeira, colar, permissões…) ganham o prefixo sudo em `execAs`. A senha do sudo fica só na memória
 * deste processo e vai ao servidor pela entrada padrão, nunca na linha de comando.
 */

const KNOWN_SERVERS = ['/usr/lib/ssh/sftp-server', '/usr/lib/openssh/sftp-server', '/usr/libexec/openssh/sftp-server', '/usr/libexec/sftp-server']
const SAFE_PATH = /^\/[\w./+-]+$/

/** Caminho do sftp-server: o do sshd_config, se for um binário, ou um dos locais conhecidos. */
async function findSftpServer(s: Session): Promise<string> {
  const { stdout } = await exec(
    s.client,
    `grep -hi '^[[:space:]]*Subsystem[[:space:]]\\{1,\\}sftp' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null; ` +
      `for p in ${KNOWN_SERVERS.join(' ')}; do [ -x "$p" ] && echo "PATH $p"; done`
  )
  const candidates = stdout
    .split('\n')
    .map((l) => (l.startsWith('PATH ') ? l.slice(5) : l.trim().split(/\s+/)[2]))
    .filter((p): p is string => !!p && SAFE_PATH.test(p))
  const found = candidates[0]
  if (!found) throw new AppError('Não encontrei o sftp-server no servidor (talvez ele use "internal-sftp"); o modo sudo precisa do binário.')
  return found
}

function openRootSftp(client: Client, cmd: string, password?: string): Promise<InstanceType<typeof SFTP>> {
  return new Promise((resolve, reject) => {
    client.exec(cmd, (err, ch) => {
      if (err) return reject(toAppError(err))
      let stderr = ''
      ch.stderr.on('data', (d: Buffer) => (stderr += d))
      // O sudo lê a senha (um byte por vez) antes de entregar a entrada ao sftp-server.
      if (password !== undefined) ch.write(`${password}\n`)
      const { incoming, outgoing } = ch as unknown as { incoming: { id: number }; outgoing: object } // internos do ssh2
      const sftp = new SFTP(client, { type: 'session', incoming, outgoing }, {})
      // O canal passa a ser tratado como SFTP; o stderr do sudo (avisos) continua sendo drenado.
      Object.assign(sftp, { stderr: ch.stderr })
      ;(client as unknown as { _chanMgr: { update(id: number, c: unknown): void } })._chanMgr.update(incoming.id, sftp)
      sftp
        .on('ready', () => resolve(sftp))
        .on('error', (e: Error) => reject(toAppError(e)))
        .on('close', () => reject(new AppError(`Falha ao abrir o SFTP como root${stderr.trim() ? `: ${stderr.trim()}` : '.'}`)))
      sftp._init()
    })
  })
}

function explainSudoFailure(stderr: string, password?: string): AppError {
  const text = stderr.trim()
  if (/not found|nao encontrado|não encontrado/i.test(text)) return new AppError('O sudo não está instalado nesta VPS.')
  if (/not in the sudoers|may not run sudo|not allowed to execute/i.test(text)) return new AppError('Este usuário não tem permissão para usar sudo.')
  if (password === undefined && /password is required|terminal is required/i.test(text)) {
    return new AppError('O sudo deste usuário exige senha.', 'SECRET_REQUIRED')
  }
  if (/incorrect password|try again/i.test(text)) return new AppError('Senha do sudo incorreta.', 'SECRET_REQUIRED')
  return new AppError(`Não foi possível usar o sudo: ${text || 'erro desconhecido'}`)
}

function turnOff(s: Session): void {
  const root = s.rootSftp
  s.rootSftp = undefined
  s.sudo = undefined
  s.sftp = s.userSftp
  s.uid = s.realUid
  s.info = { ...s.info, sudo: false }
  try {
    root?.end()
  } catch {
    // o canal já caiu
  }
}

export async function setSudo(id: string, enabled: boolean, password?: string): Promise<SessionInfo> {
  const s = getSession(id)
  if (!enabled) {
    if (s.sudo) turnOff(s)
    return s.info
  }
  if (s.realUid === 0) throw new AppError('Você já está conectado como root.')
  if (s.sudo) return s.info
  if (password !== undefined && (typeof password !== 'string' || password.length > 1024)) throw new AppError('Senha inválida.')

  // Valida o sudo antes de abrir o canal, para dar um erro claro (e saber se falta a senha).
  const check = await exec(s.client, `${sudoPrefix(password)} true`, password)
  if (check.code !== 0) throw explainSudoFailure(check.stderr, password)

  const server = await findSftpServer(s)
  const root = await openRootSftp(s.client, `${sudoPrefix(password)} ${shellQuote(server)}`, password)
  s.rootSftp = root
  s.sudo = { password }
  s.sftp = root
  s.uid = 0
  s.info = { ...s.info, sudo: true }
  // Se o canal root cair, volta ao modo normal e avisa a interface.
  root.on('close', () => {
    if (s.rootSftp !== root) return
    turnOff(s)
    emit('session:sudo', s.info)
  })
  return s.info
}
