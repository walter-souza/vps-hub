import type { ApiErrorShape } from '../shared/types'

export class AppError extends Error {
  constructor(
    message: string,
    public code?: string
  ) {
    super(message)
  }
}

const SFTP_STATUS: Record<number, string> = {
  2: 'Arquivo ou pasta não encontrado.',
  3: 'Permissão negada.',
  4: 'O servidor recusou a operação (o item pode já existir ou a pasta não estar vazia).'
}

const NET_CODES: Record<string, string> = {
  ENOTFOUND: 'Host não encontrado. Verifique o endereço.',
  EAI_AGAIN: 'Falha ao resolver o endereço do host.',
  ECONNREFUSED: 'Conexão recusada. Verifique o host e a porta.',
  ETIMEDOUT: 'Tempo esgotado ao conectar.',
  EHOSTUNREACH: 'Host inacessível.',
  ENETUNREACH: 'Rede inacessível.',
  ECONNRESET: 'A conexão foi encerrada pelo servidor.'
}

export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e
  const err = e as { message?: string; code?: unknown; level?: string }
  const message = err?.message ?? String(e)
  if (err?.level === 'client-authentication') {
    return new AppError('Autenticação falhou: usuário, senha ou chave incorretos.', 'AUTH_FAILED')
  }
  if (err?.level === 'client-timeout') return new AppError('Tempo esgotado ao conectar.', 'TIMEOUT')
  if (typeof err?.code === 'number' && SFTP_STATUS[err.code]) return new AppError(SFTP_STATUS[err.code])
  if (typeof err?.code === 'string' && NET_CODES[err.code]) return new AppError(NET_CODES[err.code], err.code)
  return new AppError(message)
}

export function toApiError(e: unknown): ApiErrorShape {
  const err = toAppError(e)
  return { message: err.message, code: err.code }
}
