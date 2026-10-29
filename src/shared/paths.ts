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

/** Retorna mensagem de erro, ou null se o nome for válido para um item. */
export function validateName(name: string): string | null {
  if (!name.trim()) return 'Informe um nome.'
  if (name.includes('/') || name.includes('\0')) return 'O nome não pode conter "/".'
  if (name === '.' || name === '..') return 'Nome inválido.'
  return null
}
