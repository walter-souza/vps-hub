import type { FileEntryWithStats, Stats } from 'ssh2'
import { baseName, copyName, joinPath, parentPath } from '../shared/paths'
import type { PasteMode } from '../shared/types'
import { AppError } from './errors'
import { call, remotePath, statOrNull, streamCopy, track } from './files'
import { getSession, sh, shellQuote, type Session } from './sessions'
import { assertRemovable, deletePermanently, moveToTrash } from './trash'

/** Copia entre duas VPS passando pelo app (SFTP → SFTP), recriando links simbólicos como links. */
async function copyAcross(src: Session, dst: Session, from: string, to: string): Promise<void> {
  const st = await call<Stats>((cb) => src.sftp.lstat(from, cb))
  const mode = st.mode & 0o7777
  if (st.isSymbolicLink()) {
    const target = await call<string>((cb) => src.sftp.readlink(from, cb))
    return sh(dst, `ln -s -- ${shellQuote(target)} ${shellQuote(to)}`, `Falha ao criar o link "${baseName(to)}"`)
  }
  if (st.isDirectory()) {
    await call((cb) => dst.sftp.mkdir(to, { mode }, cb))
    const items = await call<FileEntryWithStats[]>((cb) => src.sftp.readdir(from, cb))
    for (const i of items) {
      if (i.filename !== '.' && i.filename !== '..') await copyAcross(src, dst, joinPath(from, i.filename), joinPath(to, i.filename))
    }
    return
  }
  await track(dst.info.id, baseName(from), 'copy', st.size, (step, signal) =>
    streamCopy(src.sftp.createReadStream(from), dst.sftp.createWriteStream(to, { mode }), step, signal)
  )
}

/**
 * Cola itens em destDir. Na mesma VPS usa cp/mv no servidor; entre VPS copia via SFTP
 * (e, ao recortar, apaga a origem só depois de copiar tudo). Itens substituídos vão para a lixeira.
 * Retorna os caminhos finais.
 */
export async function paste(
  srcId: string,
  paths: string[],
  destId: string,
  destDir: string,
  mode: PasteMode,
  replace: boolean
): Promise<string[]> {
  if (mode !== 'copy' && mode !== 'cut') throw new AppError('Operação inválida.')
  if (!Array.isArray(paths)) throw new AppError('Seleção inválida.')
  const src = getSession(srcId)
  const dst = getSession(destId)
  const sameVps = src === dst
  const dir = remotePath(destDir)
  const sources = paths.map(remotePath)
  if (mode === 'cut') assertRemovable(src, sources, 'movido')
  if (!(await call<Stats>((cb) => dst.sftp.stat(dir, cb))).isDirectory()) throw new AppError('O destino não é uma pasta.')

  const results: string[] = []
  for (const from of sources) {
    const name = baseName(from)
    if (sameVps && (dir === from || dir.startsWith(`${from}/`))) {
      throw new AppError(`Não é possível colar "${name}" dentro dela mesma.`)
    }
    let to = joinPath(dir, name)
    if (sameVps && parentPath(from) === dir) {
      // Recortar e colar no mesmo lugar não faz nada; copiar cria "nome - cópia".
      if (mode === 'cut') {
        results.push(from)
        continue
      }
      const isDir = (await call<Stats>((cb) => src.sftp.lstat(from, cb))).isDirectory()
      for (let n = 1; await statOrNull(dst.sftp, to); n++) to = joinPath(dir, copyName(name, n, isDir))
    } else if (await statOrNull(dst.sftp, to)) {
      if (!replace) throw new AppError(`Já existe "${name}" em ${dir}.`, 'EXISTS')
      await moveToTrash(dst, to)
    }

    if (sameVps) {
      const cmd = mode === 'copy' ? 'cp -a' : 'mv'
      await sh(dst, `${cmd} -- ${shellQuote(from)} ${shellQuote(to)}`, `Falha ao colar "${name}"`)
    } else {
      await copyAcross(src, dst, from, to)
      if (mode === 'cut') await deletePermanently(src, from)
    }
    results.push(to)
  }
  return results
}
