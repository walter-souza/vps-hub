import Editor from '@monaco-editor/react'
import { Eye, RotateCw, Save } from 'lucide-react'
import { useDeferredValue, useEffect, useRef, useState } from 'react'
import type { editor } from 'monaco-editor'
import { Button } from '../../components/ui'
import { modelUri } from '../../lib/monaco'
import { isMarkdown, MarkdownPreview } from './MarkdownPreview'

export interface OpenFile {
  path: string
  content: string
  /** Conteúdo igual ao do servidor na última leitura/gravação. */
  saved: string
  mtime: number | null
  saving: boolean
  /** Linha a exibir (ex.: resultado de busca). */
  reveal?: { line: number; seq: number }
}

interface Props {
  vpsId: string
  file: OpenFile
  onChange: (content: string) => void
  onSave: () => void
  onReload: () => void
  /** Chamado após rolar até file.reveal, para não repetir ao voltar à aba. */
  onRevealed: () => void
  /** Abre outro arquivo da VPS (links relativos da pré-visualização de Markdown). */
  onOpenPath: (path: string) => void
}

export function EditorView({ vpsId, file, onChange, onSave, onReload, onRevealed, onOpenPath }: Props) {
  const saveRef = useRef(onSave)
  saveRef.current = onSave
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const dirty = file.content !== file.saved
  const markdown = isMarkdown(file.path)
  const [preview, setPreview] = useState(true)
  const previewSource = useDeferredValue(file.content)

  const revealLine = () => {
    const ed = editorRef.current
    if (!ed || !file.reveal) return
    ed.revealLineInCenter(file.reveal.line)
    ed.setPosition({ lineNumber: file.reveal.line, column: 1 })
    ed.focus()
    onRevealed()
  }
  useEffect(revealLine, [file.reveal]) // aba já aberta: novo pedido de linha

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-line bg-panel px-3 text-xs">
        <span className="truncate font-mono text-muted">{file.path}</span>
        <span className={dirty ? 'text-warn' : 'text-muted'}>{file.saving ? 'Salvando…' : dirty ? '● Não salvo' : 'Salvo'}</span>
        <div className="flex-1" />
        {markdown && (
          <Button size="sm" variant="ghost" onClick={() => setPreview((p) => !p)} aria-pressed={preview} title="Mostrar ou ocultar a pré-visualização">
            <Eye size={13} /> Pré-visualizar
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onReload} title="Recarregar do servidor">
          <RotateCw size={13} /> Recarregar
        </Button>
        <Button size="sm" variant="primary" onClick={onSave} disabled={!dirty || file.saving}>
          <Save size={13} /> Salvar <span className="opacity-70">Ctrl+S</span>
        </Button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className={`min-h-0 min-w-0 ${markdown && preview ? 'w-1/2 border-r border-line' : 'flex-1'}`}>
        <Editor
          path={modelUri(vpsId, file.path)}
          value={file.content}
          theme="vs-dark"
          onChange={(v) => onChange(v ?? '')}
          onMount={(editor, monaco) => {
            editorRef.current = editor
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current())
            editor.focus()
            revealLine()
          }}
          options={{
            fontSize: 13,
            fontFamily: "'Cascadia Code', Consolas, monospace",
            automaticLayout: true,
            scrollBeyondLastLine: false,
            renderWhitespace: 'selection',
            smoothScrolling: true
          }}
        />
        </div>
        {markdown && preview && (
          <div className="min-h-0 w-1/2 min-w-0">
            <MarkdownPreview source={previewSource} path={file.path} vpsId={vpsId} onOpenPath={onOpenPath} />
          </div>
        )}
      </div>
    </div>
  )
}
