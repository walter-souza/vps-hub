import type { VpsConnection } from '../../../shared/types'
import { api, errCode, errMsg } from './api'
import { prompt } from './dialogs'
import { toast, useApp } from './store'

/** Liga ou desliga o modo sudo da VPS; pede a senha do sudo quando ele exige. Retorna se ficou como pedido. */
export async function setSudo(vps: VpsConnection, enabled: boolean, password?: string): Promise<boolean> {
  try {
    useApp.getState().sessionOpened(await api.session.setSudo(vps.id, enabled, password))
    return true
  } catch (e) {
    if (errCode(e) !== 'SECRET_REQUIRED') {
      toast('error', errMsg(e))
      return false
    }
    const value = await prompt({
      title: `Senha do sudo de ${vps.username}@${vps.host}`,
      message: errMsg(e),
      password: true,
      confirmLabel: 'Ativar modo sudo'
    })
    return value ? setSudo(vps, enabled, value) : false
  }
}
