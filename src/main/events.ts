import { BrowserWindow } from 'electron'

/** Envia um evento para todas as janelas do renderer. */
export function emit(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, ...args)
}
