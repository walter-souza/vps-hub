import { archiveInfo, baseName, joinPath, parentPath, type ArchiveKind } from '../shared/paths'
import type { ArchiveFormat, ArchiveTool, ExtractMode, ToolInstallInfo } from '../shared/types'
import { AppError } from './errors'
import { remotePath, statOrNull } from './files'
import { exec, getSession, sh, shellQuote as q, type Session } from './sessions'
import { moveToTrash } from './trash'

/** Flag de compressão do tar por tipo de arquivo. */
const TAR_FLAG = { tar: '', 'tar.gz': 'z', 'tar.bz2': 'j', 'tar.xz': 'J' } as const

async function requireTool(s: Session, tool: ArchiveTool): Promise<void> {
  const { code } = await exec(s.client, `command -v ${tool} >/dev/null 2>&1`)
  if (code !== 0) throw new AppError(`O comando "${tool}" não está instalado na VPS.`, 'MISSING_TOOL')
}

const TOOLS: ArchiveTool[] = ['zip', 'unzip']
const MANAGERS: Record<string, (pkg: string) => string> = {
  'apt-get': (p) => `apt-get install -y ${p}`,
  dnf: (p) => `dnf install -y ${p}`,
  yum: (p) => `yum install -y ${p}`,
  apk: (p) => `apk add --no-cache ${p}`,
  pacman: (p) => `pacman -S --noconfirm ${p}`,
  zypper: (p) => `zypper --non-interactive install ${p}`
}

/** Detecta o gerenciador de pacotes e se a sessão pode instalar (root ou sudo sem senha). */
async function installPlan(s: Session, tool: ArchiveTool) {
  if (!TOOLS.includes(tool)) throw new AppError('Ferramenta inválida.')
  const { stdout } = await exec(
    s.client,
    `for m in ${Object.keys(MANAGERS).join(' ')}; do command -v $m >/dev/null 2>&1 && { echo $m; break; }; done; ` +
      `if [ "$(id -u)" = 0 ]; then echo root; elif sudo -n true 2>/dev/null; then echo sudo; else echo none; fi`
  )
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean)
  const privilege = lines.pop() as 'root' | 'sudo' | 'none'
  const manager = lines[0] && MANAGERS[lines[0]] ? lines[0] : null
  const sudo = privilege === 'sudo' ? 'sudo -n ' : ''
  return { manager, privilege, sudo, base: manager ? MANAGERS[manager](tool) : null }
}

export async function toolInstallInfo(id: string, tool: ArchiveTool): Promise<ToolInstallInfo> {
  const { manager, privilege, base } = await installPlan(getSession(id), tool)
  if (!manager || !base) return { command: null, canInstall: false, reason: 'Gerenciador de pacotes não reconhecido; instale manualmente.' }
  const command = `${privilege === 'sudo' ? 'sudo ' : ''}${base}`
  if (privilege === 'none') {
    return { command: `sudo ${base}`, canInstall: false, reason: 'Instalar pacotes exige root ou sudo sem senha. Rode o comando no terminal ou conecte como root.' }
  }
  return { command, canInstall: true }
}

/** Instala zip/unzip pelo gerenciador de pacotes da VPS. */
export async function installTool(id: string, tool: ArchiveTool): Promise<void> {
  const s = getSession(id)
  const { manager, privilege, sudo, base } = await installPlan(s, tool)
  if (!manager || !base || privilege === 'none') throw new AppError('Esta sessão não pode instalar pacotes (precisa de root ou sudo sem senha).')
  // apt: sem perguntas; se o índice de pacotes estiver vazio/velho, atualiza e tenta de novo.
  const run = manager === 'apt-get' ? `${sudo}env DEBIAN_FRONTEND=noninteractive ${base}` : `${sudo}${base}`
  const cmd = manager === 'apt-get' ? `${run} || (${sudo}apt-get update -q && ${run})` : run
  const { code, stdout, stderr } = await exec(s.client, `${cmd} 2>&1`)
  if (code !== 0) {
    const tail = (stderr || stdout).trim().split('\n').slice(-6).join('\n')
    throw new AppError(`Falha ao instalar ${tool}:\n${tail}`)
  }
  await requireTool(s, tool)
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
