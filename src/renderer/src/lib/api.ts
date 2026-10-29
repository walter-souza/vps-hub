export const api = window.vpsApi

/** As chamadas da API rejeitam com ApiErrorShape ({ message, code }). */
export function errMsg(e: unknown): string {
  return (e as { message?: string })?.message ?? String(e)
}

export function errCode(e: unknown): string | undefined {
  return (e as { code?: string })?.code
}
