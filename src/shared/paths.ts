// Caminhos remotos são sempre POSIX, independente do SO local.

export function normalizePath(p: string): string {
  const parts: string[] = []
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return '/' + parts.join('/')
}

export function joinPath(dir: string, name: string): string {
  return normalizePath(`${dir}/${name}`)
}

export function parentPath(p: string): string {
  return normalizePath(`${p}/..`)
}

export function baseName(p: string): string {
  const n = normalizePath(p)
  return n === '/' ? '/' : n.slice(n.lastIndexOf('/') + 1)
}

/** Nome para colar uma cópia na mesma pasta, como no Windows: "app - cópia.js", "app - cópia (2).js". */
export function copyName(name: string, n: number, isDir: boolean): string {
  const dot = isDir ? -1 : name.lastIndexOf('.')
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
  return `${stem} - cópia${n > 1 ? ` (${n})` : ''}${ext}`
}

export type ArchiveKind = 'zip' | 'tar' | 'tar.gz' | 'tar.bz2' | 'tar.xz'

const ARCHIVE_EXTS: [string, ArchiveKind][] = [
  ['.tar.gz', 'tar.gz'], ['.tgz', 'tar.gz'], ['.tar.bz2', 'tar.bz2'], ['.tbz2', 'tar.bz2'],
  ['.tar.xz', 'tar.xz'], ['.txz', 'tar.xz'], ['.tar', 'tar'], ['.zip', 'zip']
]

/** Tipo de arquivo compactado e nome sem extensão, ou null se o app não souber extraí-lo. */
export function archiveInfo(name: string): { kind: ArchiveKind; stem: string } | null {
  const match = ARCHIVE_EXTS.find(([ext]) => name.toLowerCase().endsWith(ext))
  return match && name.length > match[0].length ? { kind: match[1], stem: name.slice(0, -match[0].length) } : null
}

/** Retorna mensagem de erro, ou null se o nome for válido para um item. */
export function validateName(name: string): string | null {
  if (!name.trim()) return 'Informe um nome.'
  if (name.includes('/') || name.includes('\0')) return 'O nome não pode conter "/".'
  if (name === '.' || name === '..') return 'Nome inválido.'
  return null
}

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif', svg: 'image/svg+xml'
}

/** MIME de uma imagem que o visualizador sabe exibir, ou null para outros arquivos. */
export function imageMime(name: string): string | null {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? (IMAGE_MIME[name.slice(dot + 1).toLowerCase()] ?? null) : null
}
