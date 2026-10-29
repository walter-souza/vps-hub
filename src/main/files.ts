import { dialog, shell } from 'electron'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { FileEntryWithStats, SFTPWrapper, Stats } from 'ssh2'
import { baseName, joinPath, normalizePath, parentPath } from '../shared/paths'
import type { FileContent, FileEntry, TransferEvent } from '../shared/types'
import { AppError, toAppError } from './errors'
import { emit } from './events'
import { getSession, type Session } from './sessions'

type Cb<T> = (err: Error | null | undefined, res?: T) => void

export function call<T = void>(fn: (cb: Cb<T>) => void): Promise<T> {
  return new Promise((resolve, reject) => fn((err, res) => (err ? reject(toAppError(err)) : resolve(res as T))))
}

const noop = () => {}
const MAX_EDIT_BYTES = 5 * 1024 * 1024

export function remotePath(p: unknown): string {
  if (typeof p !== 'string' || !p.startsWith('/') || p.includes('\0')) throw new AppError('Caminho inválido.')
  return normalizePath(p)
}

export function statOrNull(sftp: SFTPWrapper, path: string): Promise<Stats | null> {
  return new Promise((resolve, reject) =>
    sftp.stat(path, (err, st) => {
      if (!err) return resolve(st)
      if ((err as { code?: number }).code === 2) return resolve(null)
      reject(toAppError(err))
    })
  )
}

async function assertMissing(sftp: SFTPWrapper, path: string): Promise<void> {
  if (await statOrNull(sftp, path)) throw new AppError(`Já existe um item chamado "${baseName(path)}".`)
}

function permString(mode: number): string {
  const kind = mode & 0o170000
  let s = kind === 0o040000 ? 'd' : kind === 0o120000 ? 'l' : '-'
  for (let i = 0; i < 9; i++) s += mode & (1 << (8 - i)) ? 'rwxrwxrwx'[i] : '-'
  return s
}

export async function list(id: string, dir: string): Promise<FileEntry[]> {
  const { sftp } = getSession(id)
  const path = remotePath(dir)
  const items = await call<FileEntryWithStats[]>((cb) => sftp.readdir(path, cb))
  return Promise.all(
    items
      .filter((i) => i.filename !== '.' && i.filename !== '..')
      .map(async (i): Promise<FileEntry> => {
        const full = joinPath(path, i.filename)
        const isLink = i.attrs.isSymbolicLink()
        const isDir = isLink
          ? await call<Stats>((cb) => sftp.stat(full, cb)).then((s) => s.isDirectory(), () => false)
          : i.attrs.isDirectory()
        return {
          name: i.filename,
          path: full,
          type: isLink ? 'link' : isDir ? 'dir' : 'file',
          isDir,
          size: i.attrs.size,
          mtime: i.attrs.mtime,
          perms: permString(i.attrs.mode),
          owner: i.longname.split(/\s+/)[2] ?? String(i.attrs.uid)
        }
      })
  )
}

export async function read(id: string, p: string): Promise<FileContent> {
  const { sftp } = getSession(id)
  const path = remotePath(p)
  const st = await call<Stats>((cb) => sftp.stat(path, cb))
  if (st.isDirectory()) throw new AppError('Não é possível editar uma pasta.')
  if (st.size > MAX_EDIT_BYTES) throw new AppError('Arquivo grande demais para o editor (máx. 5 MB). Use "Baixar".')
  const buf = await call<Buffer>((cb) => sftp.readFile(path, cb))
  if (buf.subarray(0, 8000).includes(0)) throw new AppError('Arquivo binário não pode ser editado. Use "Baixar".')
  let content: string
  try {
    // ignoreBOM mantém o BOM no texto, para que ele seja preservado ao salvar.
    content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf)
  } catch {
    throw new AppError('O arquivo não está em UTF-8; editá-lo poderia corromper o conteúdo. Use "Baixar".')
  }
  return { content, mtime: st.mtime }
}

/** Grava em arquivo temporário e renomeia por cima; retorna false quando isso não é possível. */
async function writeAtomic(sftp: SFTPWrapper, path: string, data: Buffer, mode: number): Promise<boolean> {
  const tmp = joinPath(parentPath(path), `.${baseName(path)}.vpshub-${randomBytes(4).toString('hex')}`)
  try {
    await call((cb) => sftp.writeFile(tmp, data, { mode }, cb))
  } catch (e) {
    await call((cb) => sftp.unlink(tmp, cb)).catch(noop)
    if ((e as { code?: number }).code === 3 || /permiss/i.test((e as Error).message)) return false // sem escrita na pasta
    throw e
  }
  try {
    await call((cb) => sftp.chmod(tmp, mode, cb))
    await call((cb) => sftp.ext_openssh_rename(tmp, path, cb))
    return true
  } catch (e) {
    await call((cb) => sftp.unlink(tmp, cb)).catch(noop)
    if (/not support/i.test((e as Error).message)) return false
    throw e
  }
}

export async function write(id: string, p: string, content: string, expectedMtime: number | null): Promise<number> {
  const { sftp, uid } = getSession(id)
  const path = remotePath(p)
  if (typeof content !== 'string') throw new AppError('Conteúdo inválido.')
  const st = await statOrNull(sftp, path)
  if (st && expectedMtime != null && st.mtime !== expectedMtime) {
    throw new AppError('O arquivo foi alterado no servidor depois que você o abriu.', 'CONFLICT')
  }
  const data = Buffer.from(content, 'utf8')
  // O rename atômico trocaria o dono do arquivo; só é usado quando o arquivo já é nosso.
  const atomic = st && st.uid === uid && (await writeAtomic(sftp, path, data, st.mode & 0o7777))
  if (!atomic) await call((cb) => sftp.writeFile(path, data, cb))
  return (await call<Stats>((cb) => sftp.stat(path, cb))).mtime
}

export async function createFile(id: string, p: string): Promise<void> {
  const { sftp } = getSession(id)
  const path = remotePath(p)
  await assertMissing(sftp, path)
  const handle = await call<Buffer>((cb) => sftp.open(path, 'wx', cb))
  await call((cb) => sftp.close(handle, cb))
}

export async function makeDir(id: string, p: string): Promise<void> {
  const { sftp } = getSession(id)
  const path = remotePath(p)
  await assertMissing(sftp, path)
  await call((cb) => sftp.mkdir(path, cb))
}

export async function rename(id: string, from: string, to: string): Promise<void> {
  const { sftp } = getSession(id)
  const src = remotePath(from)
  const dest = remotePath(to)
  if (src === dest) return
  await assertMissing(sftp, dest)
  await call((cb) => sftp.rename(src, dest, cb))
}

async function track(
  vpsId: string,
  name: string,
  direction: TransferEvent['direction'],
  total: number,
  run: (step: (transferred: number) => void) => Promise<void>
): Promise<void> {
  const ev: TransferEvent = { id: randomUUID(), vpsId, name, direction, transferred: 0, total, status: 'running' }
  emit('transfer:progress', { ...ev })
  let last = 0
  const step = (transferred: number) => {
    ev.transferred = transferred
    const now = Date.now()
    if (now - last < 150) return
    last = now
    emit('transfer:progress', { ...ev })
  }
  try {
    await run(step)
    emit('transfer:progress', { ...ev, transferred: total, status: 'done' })
  } catch (e) {
    emit('transfer:progress', { ...ev, status: 'error', error: toAppError(e).message })
    throw e
  }
}

async function uploadItem(s: Session, local: string, remote: string): Promise<void> {
  const st = await stat(local)
  if (st.isDirectory()) {
    if (!(await statOrNull(s.sftp, remote))) await call((cb) => s.sftp.mkdir(remote, cb))
    for (const name of await readdir(local)) await uploadItem(s, join(local, name), joinPath(remote, name))
    return
  }
  await track(s.info.id, basename(local), 'up', st.size, (step) =>
    call((cb) => s.sftp.fastPut(local, remote, { step: (t) => step(t) }, cb))
  )
}

export async function upload(id: string, localPaths: string[], remoteDir: string): Promise<void> {
  const s = getSession(id)
  const dir = remotePath(remoteDir)
  if (!Array.isArray(localPaths)) throw new AppError('Seleção inválida.')
  for (const local of localPaths) await uploadItem(s, local, joinPath(dir, basename(local)))
}

/** Nomes remotos podem ter caracteres proibidos no Windows. */
const localName = (name: string) => name.replace(/[<>:"\\|?*\x00-\x1f]/g, '_')

function uniqueLocal(path: string): string {
  if (!existsSync(path)) return path
  const ext = extname(path)
  const stem = path.slice(0, path.length - ext.length)
  for (let n = 1; ; n++) {
    const candidate = `${stem} (${n})${ext}`
    if (!existsSync(candidate)) return candidate
  }
}

async function downloadItem(s: Session, remote: string, local: string): Promise<void> {
  const st = await call<Stats>((cb) => s.sftp.stat(remote, cb))
  if (st.isDirectory()) {
    await mkdir(local, { recursive: true })
    const items = await call<FileEntryWithStats[]>((cb) => s.sftp.readdir(remote, cb))
    for (const i of items) {
      if (i.filename === '.' || i.filename === '..') continue
      await downloadItem(s, joinPath(remote, i.filename), join(local, localName(i.filename)))
    }
    return
  }
  await track(s.info.id, baseName(remote), 'down', st.size, (step) =>
    call((cb) => s.sftp.fastGet(remote, local, { step: (t) => step(t) }, cb))
  )
}

export async function download(id: string, remotePaths: string[]): Promise<string | null> {
  const s = getSession(id)
  if (!Array.isArray(remotePaths)) throw new AppError('Seleção inválida.')
  const targets = remotePaths.map(remotePath)
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Salvar em…',
    properties: ['openDirectory', 'createDirectory']
  })
  if (canceled || !filePaths[0]) return null
  const dir = filePaths[0]
  for (const remote of targets) await downloadItem(s, remote, uniqueLocal(join(dir, localName(baseName(remote)))))
  return dir
}

export async function pickUpload(): Promise<string[]> {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Enviar arquivos',
    properties: ['openFile', 'multiSelections']
  })
  return canceled ? [] : filePaths
}

export async function revealLocal(path: string): Promise<void> {
  if (typeof path !== 'string') return
  const err = await shell.openPath(path)
  if (err) throw new AppError(err)
}
