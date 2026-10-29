import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useMemo } from 'react'

/** Arquivos que ganham pré-visualização ao lado do editor. */
export const isMarkdown = (name: string) => /\.(md|markdown|mdx)$/i.test(name)

/**
 * Renderiza Markdown (GFM). O HTML passa pelo DOMPurify antes de entrar na página: scripts,
 * handlers e iframes são removidos. Imagens só carregam se forem data:/blob: (a CSP bloqueia o resto).
 */
export function MarkdownPreview({ source }: { source: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(source, { gfm: true, async: false }), { FORBID_TAGS: ['style'] }), [source])
  return (
    <div
      className="markdown h-full overflow-auto px-8 py-6"
      aria-label="Pré-visualização"
      role="document"
      // Links não navegam: a janela do app não pode sair da interface.
      onClick={(e) => (e.target as HTMLElement).closest('a') && e.preventDefault()}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
