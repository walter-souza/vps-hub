import { app, BrowserWindow, dialog, Menu, shell } from 'electron'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import { store } from './store'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 560,
    show: false,
    backgroundColor: '#0f1115',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0f1115', symbolColor: '#cbd5e1', height: 40 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  // O renderer bloqueia o fechamento quando há arquivos não salvos.
  win.webContents.on('will-prevent-unload', (e) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      message: 'Há arquivos com alterações não salvas.',
      detail: 'Se sair agora, as alterações serão perdidas.',
      buttons: ['Sair sem salvar', 'Cancelar'],
      defaultId: 1,
      cancelId: 1
    })
    if (choice === 0) e.preventDefault()
  })

  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools()
    })
  }

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

// Sem menu: evita atalhos como Ctrl+R e Ctrl+W, que descartariam edições abertas.
Menu.setApplicationMenu(null)

app.whenReady().then(() => {
  store.load()
  registerIpc()
  createWindow()
})

app.on('window-all-closed', () => app.quit())
