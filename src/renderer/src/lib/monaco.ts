// Usa o Monaco empacotado localmente (sem CDN), com os workers do Vite.
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import CssWorker from 'monaco-editor/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker'

self.MonacoEnvironment = {
  getWorker(_id, label) {
    if (label === 'json') return new JsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
    if (label === 'typescript' || label === 'javascript') return new TsWorker()
    return new EditorWorker()
  }
}

loader.config({ monaco })

/** URI do modelo: um por arquivo remoto, por VPS. */
export function modelUri(vpsId: string, path: string): string {
  return `vps://${vpsId}${path.split('/').map(encodeURIComponent).join('/')}`
}

export function disposeModel(vpsId: string, path: string): void {
  monaco.editor.getModel(monaco.Uri.parse(modelUri(vpsId, path)))?.dispose()
}
