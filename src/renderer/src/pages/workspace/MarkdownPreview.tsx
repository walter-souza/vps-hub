import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useEffect, useMemo, useRef } from 'react'
import { baseName, imageMime, joinPath, parentPath } from '../../../../shared/paths'
import { api } from '../../lib/api'

/** Arquivos que ganham pré-visualização ao lado do editor. */
export const isMarkdown = (name: string) => /\.(md|markdown|mdx)$/i.test(name)

interface Props {
  source: string
  /** Caminho do arquivo na VPS: base para links e imagens relativos. */
  path: string
  vpsId: string
  onOpenPath: (path: string) => void
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i
const isRemote = (url: string) => /^(https?:)?\/\//i.test(url)
/** Remove ?consulta e #âncora e decodifica %20 etc. de um link relativo. */
const localPart = (url: string) => {
  const clean = url.split(/[?#]/)[0]
  try {
    return decodeURIComponent(clean)
  } catch {
    return clean
  }
}
const slug = (text: string) =>
  text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-')

/**
 * Renderiza Markdown (GFM). O HTML passa pelo DOMPurify antes de entrar na página: scripts,
 * handlers e iframes são removidos. Depois de montado:
 * - imagens relativas são lidas da própria VPS (blob:); imagens externas ficam bloqueadas (a CSP não
 *   deixa o app buscar nada na internet) e mostram o texto alternativo;
 * - links http(s) abrem no navegador, links relativos abrem o arquivo no app e #âncoras rolam até o título.
 */
export function MarkdownPreview({ source, path, vpsId, onOpenPath }: Props) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(source, { gfm: true, async: false }), { FORBID_TAGS: ['style'] }), [source])
  const root = useRef<HTMLDivElement>(null)
  const dir = parentPath(path)

  useEffect(() => {
    const el = root.current
    if (!el) return
    el.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h) => (h.id = slug(h.textContent ?? '')))

    const urls: string[] = []
    let alive = true
    const blocked = (img: HTMLImageElement, why: string) => {
      const note = document.createElement('span')
      note.className = 'markdown-img-blocked'
      note.title = why
      note.textContent = img.alt ? `🖼 ${img.alt}` : '🖼 imagem'
      img.replaceWith(note)
    }
    el.querySelectorAll('img').forEach(async (img) => {
      const src = img.getAttribute('src') ?? ''
      if (src.startsWith('data:') || src.startsWith('blob:')) return
      if (isRemote(src) || SCHEME.test(src)) return blocked(img, 'Imagem externa: o app não busca conteúdo na internet.')
      const target = src.startsWith('/') ? joinPath('/', localPart(src)) : joinPath(dir, localPart(src))
      if (!imageMime(baseName(target))) return blocked(img, 'Formato de imagem não suportado.')
      img.removeAttribute('src')
      try {
        const { data, mime } = await api.fs.readImage(vpsId, target)
        const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }))
        if (!alive) return URL.revokeObjectURL(url)
        urls.push(url)
        img.src = url
      } catch {
        if (alive) blocked(img, `Não foi possível carregar ${target}`)
      }
    })
    return () => {
      alive = false
      urls.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [html, dir, vpsId])

  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    e.preventDefault() // a janela do app nunca navega
    const href = a.getAttribute('href') ?? ''
    if (href.startsWith('#')) return void root.current?.querySelector(`[id="${CSS.escape(decodeURIComponent(href.slice(1)))}"]`)?.scrollIntoView()
    if (/^https?:\/\//i.test(href)) return void window.open(href) // o processo principal abre no navegador
    if (SCHEME.test(href) || href.startsWith('//')) return
    const target = localPart(href)
    if (target) onOpenPath(href.startsWith('/') ? joinPath('/', target) : joinPath(dir, target))
  }

  return (
    <div
      ref={root}
      className="markdown h-full overflow-auto px-8 py-6"
      aria-label="Pré-visualização"
      role="document"
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
