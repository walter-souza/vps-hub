import Editor from '@monaco-editor/react'
import { RotateCw, Save } from 'lucide-react'
import { useRef } from 'react'
import { Button } from '../../components/ui'
import { modelUri } from '../../lib/monaco'

export interface OpenFile {
  path: string
  content: string
  /** Conteúdo igual ao do servidor na última leitura/gravação. */
  saved: string
  mtime: number | null
  saving: boolean
}

interface Props {
  vpsId: string
  file: OpenFile
  onChange: (content: string) => void
  onSave: () => void
  onReload: () => void
}

export function EditorView({ vpsId, file, onChange, onSave, onReload }: Props) {
  const saveRef = useRef(onSave)
  saveRef.current = onSave
  const dirty = file.content !== file.saved

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-line bg-panel px-3 text-xs">
        <span className="truncate font-mono text-muted">{file.path}</span>
        <span className={dirty ? 'text-warn' : 'text-muted'}>{file.saving ? 'Salvando…' : dirty ? '● Não salvo' : 'Salvo'}</span>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onReload} title="Recarregar do servidor">
          <RotateCw size={13} /> Recarregar
        </Button>
        <Button size="sm" variant="primary" onClick={onSave} disabled={!dirty || file.saving}>
          <Save size={13} /> Salvar <span className="opacity-70">Ctrl+S</span>
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <Editor
          path={modelUri(vpsId, file.path)}
          value={file.content}
          theme="vs-dark"
          onChange={(v) => onChange(v ?? '')}
          onMount={(editor, monaco) => {
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current())
            editor.focus()
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
    </div>
  )
}
