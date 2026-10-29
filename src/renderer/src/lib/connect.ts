import type { VpsConnection } from '../../../shared/types'
import { api, errCode, errMsg } from './api'
import { prompt } from './dialogs'
import { toast, useApp } from './store'

/** Conecta (ou reconecta) e abre o workspace; pede senha/passphrase quando necessário. */
export async function connectVps(vps: VpsConnection, secret?: string): Promise<boolean> {
  const { sessions, sessionOpened, open } = useApp.getState()
  const current = sessions[vps.id]
  if (current && !current.closed) {
    open(vps.id)
    return true
  }
  try {
    sessionOpened(await api.session.connect(vps.id, secret))
    open(vps.id)
    // Atualiza o "último acesso" exibido no Hub.
    api.connections.list().then(useApp.getState().setConnections, () => {})
    return true
  } catch (e) {
    if (errCode(e) !== 'SECRET_REQUIRED') {
      toast('error', `${vps.name}: ${errMsg(e)}`)
      return false
    }
    const value = await prompt({
      title: vps.auth === 'password' ? `Senha de ${vps.username}@${vps.host}` : 'Passphrase da chave SSH',
      message: errMsg(e),
      password: true,
      confirmLabel: 'Conectar'
    })
    return value ? connectVps(vps, value) : false
  }
}
