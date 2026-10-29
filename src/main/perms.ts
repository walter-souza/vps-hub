import type { Accounts, PermChange } from '../shared/types'
import { AppError } from './errors'
import { remotePath } from './files'
import { exec, getSession, shellQuote as q } from './sessions'
import { PROTECTED } from './trash'

const NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,31}\$?$/ // nome de usuário/grupo ou id numérico

/**
 * Converte os bits a ligar/desligar em modo simbólico ("u+x,g-w,o-rwx"), para que os bits não
 * alterados continuem como estão em cada item (seleção múltipla e recursão).
 */
export function symbolicMode(set: number, clear: number): string {
  const parts: string[] = []
  for (const [who, shift] of [['u', 6], ['g', 3], ['o', 0]] as const) {
    const letters = (mask: number) => ['r', 'w', 'x'].filter((_, i) => mask & ((4 >> i) << shift)).join('')
    const plus = letters(set)
    const minus = letters(clear)
    if (plus) parts.push(`${who}+${plus}`)
    if (minus) parts.push(`${who}-${minus}`)
  }
  return parts.join(',')
}

function validate(c: PermChange): void {
  const bits = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 0o777
  if (!bits(c.set) || !bits(c.clear) || (c.set & c.clear) !== 0) throw new AppError('Permissões inválidas.')
  for (const name of [c.owner, c.group]) {
    if (name !== undefined && (typeof name !== 'string' || !NAME_RE.test(name))) throw new AppError(`Nome de usuário ou grupo inválido: "${name}".`)
  }
  if (!['all', 'dirs', 'files'].includes(c.applyTo)) throw new AppError('Opção inválida.')
}

/** chmod/chown em cada item; com recursive, também em tudo que estiver dentro das pastas. */
export async function changePermissions(id: string, paths: string[], change: PermChange): Promise<void> {
  const s = getSession(id)
  if (!Array.isArray(paths) || paths.length === 0) throw new AppError('Seleção inválida.')
  validate(change)
  const targets = paths.map(remotePath)
  if (change.recursive) {
    const blocked = targets.find((t) => PROTECTED.has(t))
    if (blocked) throw new AppError(`Por segurança, "${blocked}" não pode ser alterado recursivamente pelo VPS Hub.`)
  }

  const R = change.recursive ? '-R ' : ''
  const mode = symbolicMode(change.set, change.clear)
  const type = change.applyTo === 'dirs' ? '-type d ' : change.applyTo === 'files' ? '-type f ' : ''
  const commands: string[] = []
  for (const path of targets) {
    // O dono vale para tudo; "aplicar a" filtra só as permissões.
    if (change.owner) commands.push(`chown ${R}${q(change.group ? `${change.owner}:${change.group}` : change.owner)} ${q(path)}`)
    else if (change.group) commands.push(`chgrp ${R}${q(change.group)} ${q(path)}`)
    if (!mode) continue
    if (change.recursive) commands.push(`find ${q(path)} ${type}-exec chmod ${mode} {} +`)
    else if (!type) commands.push(`chmod ${mode} ${q(path)}`)
    else commands.push(`if [ ${change.applyTo === 'dirs' ? '-d' : '-f'} ${q(path)} ]; then chmod ${mode} ${q(path)}; fi`)
  }

  // Continua nos demais itens se um falhar e reporta tudo no fim.
  const errors: string[] = []
  for (const cmd of commands) {
    const { code, stderr } = await exec(s.client, cmd)
    if (code !== 0) errors.push(...(stderr.trim() || `código ${code}`).split('\n'))
  }
  if (errors.length > 0) {
    const more = errors.length > 5 ? `\n… e mais ${errors.length - 5} erro(s)` : ''
    throw new AppError(`Alguns itens não foram alterados:\n${errors.slice(0, 5).join('\n')}${more}`)
  }
}

/** Usuários e grupos do servidor, para sugerir no diálogo. */
export async function accounts(id: string): Promise<Accounts> {
  const s = getSession(id)
  const names = async (db: string) => {
    const { stdout } = await exec(s.client, `getent ${db} 2>/dev/null || cat /etc/${db}`)
    return [...new Set(stdout.split('\n').map((l) => l.split(':')[0].trim()).filter(Boolean))].sort()
  }
  const [users, groups] = await Promise.all([names('passwd'), names('group')])
  return { users, groups, isRoot: s.uid === 0 }
}
