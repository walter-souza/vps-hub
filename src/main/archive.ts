import { archiveInfo, baseName, joinPath, parentPath, type ArchiveKind } from '../shared/paths'
import type { ArchiveFormat, ExtractMode } from '../shared/types'
import { AppError } from './errors'
import { remotePath, statOrNull } from './files'
import { exec, getSession, sh, shellQuote as q, type Session } from './sessions'
import { moveToTrash } from './trash'

/** Flag de compressão do tar por tipo de arquivo. */
const TAR_FLAG = { tar: '', 'tar.gz': 'z', 'tar.bz2': 'j', 'tar.xz': 'J' } as const

async function requireTool(s: Session, tool: 'zip' | 'unzip'): Promise<void> {
  const { code } = await exec(s.client, `command -v ${tool} >/dev/null 2>&1`)
  if (code !== 0) {
    throw new AppError(`O comando "${tool}" não está instalado na VPS. Instale com "apt install ${tool}" (Debian/Ubuntu) ou use .tar.gz.`, 'MISSING_TOOL')
  }
}

/** Compacta itens de uma mesma pasta em <pasta>/<name>. Retorna o caminho do arquivo criado. */
export async function compress(id: string, paths: string[], format: ArchiveFormat, name: string): Promise<string> {
  const s = getSession(id)
  if (!Array.isArray(paths) || paths.length === 0) throw new AppError('Seleção inválida.')
  if (format !== 'zip' && format !== 'tar.gz') throw new AppError('Formato inválido.')
  if (typeof name !== 'string' || !name.trim() || name.includes('/') || name.includes('\0')) throw new AppError('Nome inválido.')
  const sources = paths.map(remotePath)
  const dir = parentPath(sources[0])
  if (sources.some((p) => parentPath(p) !== dir)) throw new AppError('Os itens precisam estar na mesma pasta.')
  const dest = joinPath(dir, name.trim())
  if (await statOrNull(s.sftp, dest)) throw new AppError(`Já existe "${baseName(dest)}" nesta pasta.`, 'EXISTS')

  // "./nome" impede que um item começando com "-" seja lido como opção.
  const items = sources.map((p) => q(`./${baseName(p)}`)).join(' ')
  if (format === 'zip') {
    await requireTool(s, 'zip')
    await sh(s, `cd ${q(dir)} && zip -r -q -y ${q(dest)} ${items}`, 'Falha ao compactar')
  } else {
    await sh(s, `tar -czf ${q(dest)} -C ${q(dir)} ${items}`, 'Falha ao compactar')
  }
  return dest
}

/** Nomes das entradas do arquivo, para validar caminhos e detectar conflitos. */
async function listEntries(s: Session, archive: string, kind: ArchiveKind): Promise<string[]> {
  if (kind === 'zip') {
    await requireTool(s, 'unzip')
    const { code, stdout, stderr } = await exec(s.client, `unzip -l ${q(archive)}`)
    if (code !== 0) throw new AppError(`Não foi possível ler o arquivo: ${stderr.trim() || stdout.trim()}`)
    // Mesmo layout no Info-ZIP e no BusyBox: "<tamanho> <data> <hora> <nome>".
    return stdout
      .split('\n')
      .map((l) => l.match(/^\s*\d+\s+\S+\s+\S+\s+(.+)$/)?.[1])
      .filter((n): n is string => !!n)
  }
  const { code, stdout, stderr } = await exec(s.client, `tar -t${TAR_FLAG[kind]}f ${q(archive)}`)
  if (code !== 0) throw new AppError(`Não foi possível ler o arquivo: ${stderr.trim()}`)
  return stdout.split('\n').filter(Boolean)
}

/** Bloqueia "zip slip": entradas absolutas ou com ".." escreveriam fora do destino. */
function assertSafeEntries(entries: string[]): void {
  const bad = entries.find((e) => e.startsWith('/') || e.split('/').includes('..'))
  if (bad) throw new AppError(`Arquivo recusado por segurança: a entrada "${bad}" escreveria fora da pasta de destino.`)
}

/** Primeiro componente de cada entrada ("./site/a.txt" -> "site"). */
const topLevel = (entries: string[]) =>
  [...new Set(entries.map((e) => e.replace(/^(\.\/)+/, '').split('/')[0]).filter((n) => n && n !== '.'))]

/**
 * Extrai um arquivo. "folder" cria uma pasta nova com o nome do arquivo; "here" extrai na pasta
 * do arquivo e, com replace, manda para a lixeira os itens que seriam sobrescritos.
 * Retorna os caminhos criados no nível de cima.
 */
export async function extract(id: string, archivePath: string, mode: ExtractMode, replace: boolean): Promise<string[]> {
  const s = getSession(id)
  const archive = remotePath(archivePath)
  const info = archiveInfo(baseName(archive))
  if (!info) throw new AppError('Formato de arquivo não suportado.')
  const { kind, stem } = info
  if (mode !== 'folder' && mode !== 'here') throw new AppError('Opção inválida.')
  const entries = await listEntries(s, archive, kind)
  assertSafeEntries(entries)

  const dir = parentPath(archive)
  let dest = dir
  if (mode === 'folder') {
    dest = joinPath(dir, stem)
    for (let n = 2; await statOrNull(s.sftp, dest); n++) dest = joinPath(dir, `${stem} (${n})`)
    await sh(s, `mkdir -- ${q(dest)}`, 'Falha ao criar a pasta')
  } else {
    const clashes: string[] = []
    for (const name of topLevel(entries)) if (await statOrNull(s.sftp, joinPath(dir, name))) clashes.push(name)
    if (clashes.length > 0) {
      if (!replace) throw new AppError(`Já existem nesta pasta: ${clashes.join(', ')}`, 'EXISTS')
      for (const name of clashes) await moveToTrash(s, joinPath(dir, name))
    }
  }

  // -o: não restaura dono/grupo gravados no arquivo (relevante quando se é root).
  const cmd =
    kind === 'zip' ? `unzip -q -o ${q(archive)} -d ${q(dest)}` : `tar -x${TAR_FLAG[kind]}of ${q(archive)} -C ${q(dest)}`
  await sh(s, cmd, 'Falha ao extrair')
  return mode === 'folder' ? [dest] : topLevel(entries).map((n) => joinPath(dir, n))
}
