import { dialog, ipcMain } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Result } from '../shared/types'
import { toApiError } from './errors'
import * as files from './files'
import { connectSession, disconnect, probe, testConnection } from './sessions'
import { readSshConfig } from './sshConfig'
import { store } from './store'
import { paste } from './paste'
import * as trash from './trash'
import { closeTerminal, openTerminal, resizeTerminal, writeTerminal } from './terminals'

// Canais com resposta: o resultado vai embrulhado em Result para preservar mensagem e código do erro.
function handle(channel: string, fn: (...args: any[]) => unknown): void {
  ipcMain.handle(channel, async (_e, ...args): Promise<Result<unknown>> => {
    try {
      return { ok: true, data: await fn(...args) }
    } catch (e) {
      return { ok: false, error: toApiError(e) }
    }
  })
}

async function pickKeyFile(): Promise<string | null> {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Selecionar chave privada',
    defaultPath: join(homedir(), '.ssh'),
    properties: ['openFile', 'showHiddenFiles']
  })
  return canceled ? null : (filePaths[0] ?? null)
}

export function registerIpc(): void {
  handle('connections:list', () => store.list())
  handle('connections:save', (input, id) => store.save(input, id))
  handle('connections:remove', (id) => {
    disconnect(id)
    store.remove(id)
  })
  handle('connections:test', testConnection)
  handle('connections:probe', probe)
  handle('connections:pickKeyFile', pickKeyFile)
  handle('connections:readSshConfig', readSshConfig)

  handle('session:connect', connectSession)
  handle('session:disconnect', disconnect)

  handle('fs:list', files.list)
  handle('fs:read', files.read)
  handle('fs:write', files.write)
  handle('fs:createFile', files.createFile)
  handle('fs:mkdir', files.makeDir)
  handle('fs:rename', files.rename)
  handle('fs:remove', trash.remove)
  handle('fs:paste', paste)
  handle('fs:pickUpload', files.pickUpload)
  handle('fs:upload', files.upload)
  handle('fs:download', files.download)
  handle('fs:revealLocal', files.revealLocal)

  handle('trash:list', trash.list)
  handle('trash:restore', trash.restore)
  handle('trash:purge', trash.purge)

  handle('terminal:open', openTerminal)
  ipcMain.on('terminal:write', (_e, termId, data) => writeTerminal(termId, data))
  ipcMain.on('terminal:resize', (_e, termId, cols, rows) => resizeTerminal(termId, cols, rows))
  ipcMain.on('terminal:close', (_e, termId) => closeTerminal(termId))
}
