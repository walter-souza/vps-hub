import { randomBytes } from 'node:crypto'
import type { FileEntryWithStats, Stats } from 'ssh2'
import { baseName, joinPath, parentPath } from '../shared/paths'
import type { TrashItem } from '../shared/types'
import { AppError } from './errors'
import { call, remotePath, statOrNull } from './files'
import { exec, getSession, sh, shellQuote, type Session } from './sessions'

// Lixeira por VPS em ~/.vpshub-trash/<id>/, com o item e um arquivo de metadados com o caminho original.
const TRASH_DIR = '.vpshub-trash'
const META = '.vpshub-origin.json'
const ID_RE = /^\d+-[0-9a-f]+$/
/** Pastas do sistema que o VPS Hub nunca exclui, move nem altera recursivamente. */
export const PROTECTED = new Set(
  ['/', '/bin', '/boot', '/dev', '/etc', '/home', '/lib', '/lib64', '/opt', '/proc', '/root', '/run', '/sbin', '/srv', '/sys', '/usr', '/var']
)

const trashRoot = (s: Session) => joinPath(s.info.home, TRASH_DIR)

function entryPath(s: Session, trashId: unknown): string {
  if (typeof trashId !== 'string' || !ID_RE.test(trashId)) throw new AppError('Item da lixeira inválido.')
  return joinPath(trashRoot(s), trashId)
}

const isListed = (e: FileEntryWithStats) => e.filename !== '.' && e.filename !== '..'

/** Pastas do sistema, a home e qualquer pasta que a contenha (e portanto a lixeira) nunca saem do lugar. */
export function assertRemovable(s: Session, paths: string[], action: string): void {
  const root = trashRoot(s)
  const blocked = paths.find((t) => PROTECTED.has(t) || t === s.info.home || root.startsWith(`${t}/`))
  if (blocked) throw new AppError(`Por segurança, "${blocked}" não pode ser ${action} pelo VPS Hub.`)
}

export async function deletePermanently(s: Session, path: string): Promise<void> {
  const st = await call<Stats>((cb) => s.sftp.lstat(path, cb))
  if (st.isDirectory()) await sh(s, `rm -rf -- ${shellQuote(path)}`, `Falha ao excluir "${baseName(path)}"`)
  else await call((cb) => s.sftp.unlink(path, cb))
}

export async function moveToTrash(s: Session, path: string): Promise<string> {
  await call<Stats>((cb) => s.sftp.lstat(path, cb)) // falha cedo se o item não existe
  const root = trashRoot(s)
  const trashId = `${Date.now()}-${randomBytes(3).toString('hex')}`
  const entry = joinPath(root, trashId)
  await sh(s, `mkdir -p -- ${shellQuote(root)} && chmod 700 -- ${shellQuote(root)} && mkdir -- ${shellQuote(entry)}`, 'Falha ao criar a lixeira')
  try {
    const meta = JSON.stringify({ path, deletedAt: Date.now() })
    await call((cb) => s.sftp.writeFile(joinPath(entry, META), meta, cb))
    // mv (e não rename do SFTP) para funcionar também entre sistemas de arquivos diferentes.
    await sh(s, `mv -- ${shellQuote(path)} ${shellQuote(joinPath(entry, baseName(path)))}`, `Falha ao mover "${baseName(path)}" para a lixeira`)
  } catch (e) {
    await exec(s.client, `rm -rf -- ${shellQuote(entry)}`).catch(() => {})
    throw e
  }
  return trashId
}

/** Exclui itens: vão para a lixeira, salvo se permanent ou se já estiverem dentro dela. */
export async function remove(id: string, paths: string[], permanent: boolean): Promise<string[]> {
  const s = getSession(id)
  if (!Array.isArray(paths)) throw new AppError('Seleção inválida.')
  const targets = paths.map(remotePath)
  const root = trashRoot(s)
  assertRemovable(s, targets, 'excluído')

  const trashIds: string[] = []
  for (const path of targets) {
    if (permanent || path === root || path.startsWith(`${root}/`)) await deletePermanently(s, path)
    else trashIds.push(await moveToTrash(s, path))
  }
  return trashIds
}

async function readEntry(s: Session, trashId: string): Promise<TrashItem | null> {
  const entry = entryPath(s, trashId)
  const children = await call<FileEntryWithStats[]>((cb) => s.sftp.readdir(entry, cb))
  const item = children.find((c) => isListed(c) && c.filename !== META)
  if (!item) return null
  let originalPath = ''
  let deletedAt = Number(trashId.split('-')[0])
  try {
    const meta = JSON.parse((await call<Buffer>((cb) => s.sftp.readFile(joinPath(entry, META), cb))).toString('utf8'))
    if (typeof meta.path === 'string' && meta.path.startsWith('/')) originalPath = meta.path
    if (Number.isFinite(meta.deletedAt)) deletedAt = meta.deletedAt
  } catch {
    // Sem metadados o item ainda aparece, mas não pode ser restaurado automaticamente.
  }
  return { id: trashId, name: item.filename, originalPath, deletedAt, isDir: item.attrs.isDirectory(), size: item.attrs.size }
}

export async function list(id: string): Promise<TrashItem[]> {
  const s = getSession(id)
  const root = trashRoot(s)
  if (!(await statOrNull(s.sftp, root))) return []
  const dirs = await call<FileEntryWithStats[]>((cb) => s.sftp.readdir(root, cb))
  const items = await Promise.all(
    dirs.filter((d) => d.attrs.isDirectory() && ID_RE.test(d.filename)).map((d) => readEntry(s, d.filename).catch(() => null))
  )
  return items.filter((i): i is TrashItem => !!i).sort((a, b) => b.deletedAt - a.deletedAt)
}

export async function restore(id: string, trashIds: string[]): Promise<void> {
  const s = getSession(id)
  if (!Array.isArray(trashIds)) throw new AppError('Seleção inválida.')
  for (const trashId of trashIds) {
    const item = await readEntry(s, trashId)
    if (!item) throw new AppError('Item não encontrado na lixeira.')
    if (!item.originalPath) throw new AppError(`Local original de "${item.name}" desconhecido; mova-o manualmente.`)
    if (await statOrNull(s.sftp, item.originalPath)) {
      throw new AppError(`Já existe um item em ${item.originalPath}. Renomeie ou mova-o antes de restaurar.`)
    }
    const entry = entryPath(s, trashId)
    await sh(
      s,
      `mkdir -p -- ${shellQuote(parentPath(item.originalPath))} && mv -- ${shellQuote(joinPath(entry, item.name))} ${shellQuote(item.originalPath)}`,
      `Falha ao restaurar "${item.name}"`
    )
    await sh(s, `rm -rf -- ${shellQuote(entry)}`, 'Falha ao limpar a lixeira')
  }
}

export async function purge(id: string, trashIds?: string[]): Promise<void> {
  const s = getSession(id)
  if (trashIds === undefined) return sh(s, `rm -rf -- ${shellQuote(trashRoot(s))}`, 'Falha ao esvaziar a lixeira')
  if (!Array.isArray(trashIds)) throw new AppError('Seleção inválida.')
  for (const trashId of trashIds) await sh(s, `rm -rf -- ${shellQuote(entryPath(s, trashId))}`, 'Falha ao excluir da lixeira')
}
