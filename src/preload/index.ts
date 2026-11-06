import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { Result, Unsubscribe, VpsApi } from '../shared/types'

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const r = (await ipcRenderer.invoke(channel, ...args)) as Result<T>
  if (r.ok) return r.data
  // O contextBridge descarta propriedades extras de Error; um objeto simples chega inteiro.
  throw r.error
}

function on<A extends unknown[]>(channel: string, cb: (...args: A) => void): Unsubscribe {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as A))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: VpsApi = {
  connections: {
    list: () => invoke('connections:list'),
    save: (input, id) => invoke('connections:save', input, id),
    remove: (id) => invoke('connections:remove', id),
    setFavorites: (id, paths) => invoke('connections:setFavorites', id, paths),
    test: (input, id) => invoke('connections:test', input, id),
    probe: (id) => invoke('connections:probe', id),
    pickKeyFile: () => invoke('connections:pickKeyFile'),
    readSshConfig: () => invoke('connections:readSshConfig')
  },
  session: {
    connect: (id, secret) => invoke('session:connect', id, secret),
    disconnect: (id) => invoke('session:disconnect', id),
    setSudo: (id, enabled, password) => invoke('session:setSudo', id, enabled, password),
    onClosed: (cb) => on('session:closed', cb),
    onSudoChanged: (cb) => on('session:sudo', cb)
  },
  fs: {
    list: (id, path) => invoke('fs:list', id, path),
    read: (id, path) => invoke('fs:read', id, path),
    readImage: (id, path) => invoke('fs:readImage', id, path),
    readTail: (id, path) => invoke('fs:readTail', id, path),
    write: (id, path, content, expectedMtime, encoding) => invoke('fs:write', id, path, content, expectedMtime, encoding),
    createFile: (id, path) => invoke('fs:createFile', id, path),
    mkdir: (id, path) => invoke('fs:mkdir', id, path),
    rename: (id, from, to) => invoke('fs:rename', id, from, to),
    remove: (id, paths, permanent) => invoke('fs:remove', id, paths, permanent),
    paste: (srcId, paths, destId, destDir, mode, replace) => invoke('fs:paste', srcId, paths, destId, destDir, mode, replace),
    search: (id, searchId, query) => invoke('fs:search', id, searchId, query),
    cancelSearch: (searchId) => invoke('fs:cancelSearch', searchId),
    setPermissions: (id, paths, change) => invoke('fs:setPermissions', id, paths, change),
    accounts: (id) => invoke('fs:accounts', id),
    compress: (id, paths, format, name) => invoke('fs:compress', id, paths, format, name),
    extract: (id, archive, mode, replace) => invoke('fs:extract', id, archive, mode, replace),
    toolInstallInfo: (id, tool) => invoke('fs:toolInstallInfo', id, tool),
    installTool: (id, tool) => invoke('fs:installTool', id, tool),
    pickUpload: () => invoke('fs:pickUpload'),
    upload: (id, localPaths, remoteDir) => invoke('fs:upload', id, localPaths, remoteDir),
    download: (id, remotePaths) => invoke('fs:download', id, remotePaths),
    revealLocal: (path) => invoke('fs:revealLocal', path),
    pathForFile: (file) => webUtils.getPathForFile(file)
  },
  trash: {
    list: (id) => invoke('trash:list', id),
    restore: (id, trashIds) => invoke('trash:restore', id, trashIds),
    purge: (id, trashIds) => invoke('trash:purge', id, trashIds)
  },
  stats: {
    get: (id) => invoke('stats:get', id)
  },
  tunnels: {
    add: (vpsId, def) => invoke('tunnels:add', vpsId, def),
    remove: (vpsId, tunnelId) => invoke('tunnels:remove', vpsId, tunnelId),
    status: (vpsId) => invoke('tunnels:status', vpsId),
    start: (vpsId, tunnelId) => invoke('tunnels:start', vpsId, tunnelId),
    stop: (vpsId, tunnelId) => invoke('tunnels:stop', vpsId, tunnelId)
  },
  services: {
    availability: (id) => invoke('services:availability', id),
    listUnits: (id) => invoke('services:listUnits', id),
    unitAction: (id, name, action) => invoke('services:unitAction', id, name, action),
    unitStatus: (id, name) => invoke('services:unitStatus', id, name),
    listContainers: (id) => invoke('services:listContainers', id),
    containerAction: (id, target, action) => invoke('services:containerAction', id, target, action)
  },
  transfers: {
    onProgress: (cb) => on('transfer:progress', cb),
    cancel: (transferId) => invoke('transfers:cancel', transferId),
    retry: (transferId) => invoke('transfers:retry', transferId)
  },
  logs: {
    start: (streamId, vpsId, source) => invoke('logs:start', streamId, vpsId, source),
    stop: (streamId) => ipcRenderer.send('logs:stop', streamId),
    onData: (cb) => on('log:data', cb),
    onEnd: (cb) => on('log:end', cb)
  },
  terminal: {
    open: (termId, vpsId, cwd, cols, rows) => invoke('terminal:open', termId, vpsId, cwd, cols, rows),
    write: (termId, data) => ipcRenderer.send('terminal:write', termId, data),
    resize: (termId, cols, rows) => ipcRenderer.send('terminal:resize', termId, cols, rows),
    close: (termId) => ipcRenderer.send('terminal:close', termId),
    onData: (cb) => on('terminal:data', cb),
    onExit: (cb) => on('terminal:exit', cb)
  }
}

contextBridge.exposeInMainWorld('vpsApi', api)
