import type { ContainerAction, ContainerInfo, ServiceAction, ServiceUnit, ServicesAvailability } from '../shared/types'
import { AppError } from './errors'
import { exec, execAs, getSession, shellQuote, type Session } from './sessions'

/**
 * Serviços do systemd e contêineres do Docker. Tudo roda pelos comandos `systemctl` e `docker` do
 * próprio servidor (como root quando o modo sudo está ligado); nada é instalado na VPS.
 */

export const UNIT_RE = /^[\w@:.\\-]+\.service$/
export const CONTAINER_RE = /^[\w][\w.-]*$/
const SERVICE_ACTIONS: ServiceAction[] = ['start', 'stop', 'restart', 'reload', 'enable', 'disable']
const CONTAINER_ACTIONS: ContainerAction[] = ['start', 'stop', 'restart', 'remove']

/** Acrescenta a dica do modo sudo quando o comando falhou por falta de permissão. */
function explain(stderr: string, fallback: string): AppError {
  const text = stderr.trim() || fallback
  const denied = /authentication required|access denied|permission denied|not permitted|must be root|sudo/i.test(text)
  return new AppError(denied ? `${text}\nSem permissão: ative o modo sudo (escudo na aba Arquivos) ou conecte como root.` : text)
}

async function works(s: Session, cmd: string): Promise<boolean> {
  return (await exec(s.client, `${cmd} >/dev/null 2>&1`)).code === 0
}

export async function availability(id: string): Promise<ServicesAvailability> {
  const s = getSession(id)
  // `systemctl` existe em contêineres sem systemd; só conta se ele realmente responde.
  const [systemd, docker] = await Promise.all([
    works(s, 'command -v systemctl && systemctl list-units --no-pager --no-legend'),
    works(s, 'command -v docker')
  ])
  return { systemd, docker }
}

// ---------- systemd ----------

/** Junta `list-units` (estado atual) e `list-unit-files` (habilitado no boot). */
export async function listUnits(id: string): Promise<ServiceUnit[]> {
  const s = getSession(id)
  const { stdout, stderr, code } = await exec(
    s.client,
    'systemctl list-units --type=service --all --no-legend --no-pager --plain; echo @@files; systemctl list-unit-files --type=service --no-legend --no-pager --plain'
  )
  if (code !== 0 && !stdout.includes('@@files')) throw explain(stderr, 'Não foi possível listar os serviços.')
  const [unitsText, filesText = ''] = stdout.split('@@files\n')
  const enabled = new Map<string, string>()
  for (const l of filesText.split('\n')) {
    const [name, state] = l.trim().split(/\s+/)
    if (name && state) enabled.set(name, state)
  }
  const units: ServiceUnit[] = []
  for (const l of unitsText.split('\n')) {
    const m = /^\s*●?\s*(\S+\.service)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/.exec(l)
    if (m) units.push({ name: m[1], load: m[2], active: m[3], sub: m[4], description: m[5].trim(), enabled: enabled.get(m[1]) ?? '' })
  }
  // Unidades que só existem como arquivo (nunca carregadas) também aparecem, como inativas.
  for (const [name, state] of enabled) {
    if (!units.some((u) => u.name === name)) units.push({ name, load: 'not-loaded', active: 'inactive', sub: 'dead', description: '', enabled: state })
  }
  return units.sort((a, b) => a.name.localeCompare(b.name))
}

function checkUnit(name: unknown): string {
  if (typeof name !== 'string' || !UNIT_RE.test(name)) throw new AppError('Nome de serviço inválido.')
  return name
}

export async function unitAction(id: string, name: string, action: ServiceAction): Promise<void> {
  const s = getSession(id)
  if (!SERVICE_ACTIONS.includes(action)) throw new AppError('Ação inválida.')
  const unit = checkUnit(name)
  const { code, stderr } = await execAs(s, `systemctl ${action} -- ${shellQuote(unit)}`)
  if (code !== 0) throw explain(stderr, `Falha ao executar "${action}" em ${unit}.`)
}

/** Saída de `systemctl status` (inclui as últimas linhas do log do serviço). */
export async function unitStatus(id: string, name: string): Promise<string> {
  const s = getSession(id)
  const unit = checkUnit(name)
  // O status devolve código ≠ 0 para serviços parados; o texto é o que interessa.
  const { stdout, stderr } = await exec(s.client, `systemctl status --no-pager -n 15 -- ${shellQuote(unit)} 2>&1`)
  return (stdout || stderr).trim()
}

// ---------- Docker ----------

export async function listContainers(id: string): Promise<ContainerInfo[]> {
  const s = getSession(id)
  const { stdout, stderr, code } = await execAs(s, "docker ps -a --no-trunc --format '{{json .}}'")
  if (code !== 0) throw explain(stderr, 'Não foi possível listar os contêineres.')
  const list: ContainerInfo[] = []
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    try {
      const j = JSON.parse(line) as Record<string, string>
      list.push({
        id: String(j.ID ?? '').slice(0, 12),
        name: String(j.Names ?? '').split(',')[0],
        image: String(j.Image ?? ''),
        state: String(j.State ?? ''),
        status: String(j.Status ?? ''),
        ports: String(j.Ports ?? ''),
        createdAt: String(j.CreatedAt ?? '')
      })
    } catch {
      // linha que não é JSON (aviso do docker): ignora
    }
  }
  return list.sort((a, b) => a.name.localeCompare(b.name))
}

export async function containerAction(id: string, target: string, action: ContainerAction): Promise<void> {
  const s = getSession(id)
  if (!CONTAINER_ACTIONS.includes(action)) throw new AppError('Ação inválida.')
  if (typeof target !== 'string' || !CONTAINER_RE.test(target)) throw new AppError('Nome de contêiner inválido.')
  const verb = action === 'remove' ? 'rm' : action
  const { code, stderr } = await execAs(s, `docker ${verb} -- ${shellQuote(target)}`)
  if (code !== 0) throw explain(stderr, `Falha ao executar "${action}" em ${target}.`)
}
