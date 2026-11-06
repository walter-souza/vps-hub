import type { DiskUsage, SystemStats } from '../shared/types'
import { AppError } from './errors'
import { exec, getSession, onSessionEnd } from './sessions'

/**
 * Métricas do servidor lidas de /proc (Linux) com um único comando por leitura. CPU e rede são taxas,
 * então comparam esta leitura com a anterior da mesma VPS: a primeira chamada devolve `null` nelas.
 */

const COMMAND = [
  'echo @@stat; grep "^cpu" /proc/stat',
  'echo @@mem; cat /proc/meminfo',
  'echo @@load; cat /proc/loadavg /proc/uptime',
  'echo @@df; df -P -k 2>/dev/null',
  'echo @@net; cat /proc/net/dev',
  'echo @@host; hostname; uname -r'
].join('; ')

interface Sample {
  at: number
  /** Por linha "cpu"/"cpuN": [total, ocioso]. */
  cpu: [number, number][]
  rx: number
  tx: number
}
const previous = new Map<string, Sample>()
onSessionEnd((id) => previous.delete(id))

function sections(out: string): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  let current: string[] = []
  for (const line of out.split('\n')) {
    if (line.startsWith('@@')) result[line.slice(2).trim()] = current = []
    else if (line.trim()) current.push(line)
  }
  return result
}

const num = (v: string | undefined) => Number(v ?? 0) || 0
const pct = (v: number) => Math.round(Math.min(100, Math.max(0, v)) * 10) / 10

function parseMemory(lines: string[]): SystemStats['memory'] {
  const kb: Record<string, number> = {}
  for (const l of lines) {
    const m = /^(\w+):\s+(\d+)/.exec(l)
    if (m) kb[m[1]] = Number(m[2])
  }
  const total = (kb.MemTotal ?? 0) * 1024
  // Kernels antigos não têm MemAvailable.
  const available = (kb.MemAvailable ?? (kb.MemFree ?? 0) + (kb.Buffers ?? 0) + (kb.Cached ?? 0)) * 1024
  const swapTotal = (kb.SwapTotal ?? 0) * 1024
  return { total, used: Math.max(0, total - available), available, swapTotal, swapUsed: Math.max(0, swapTotal - (kb.SwapFree ?? 0) * 1024) }
}

/** Só discos de verdade (/dev/…, exceto loops) e a raiz; sistemas virtuais ficam de fora. */
function parseDisks(lines: string[]): DiskUsage[] {
  const seen = new Set<string>()
  const disks: DiskUsage[] = []
  for (const l of lines.slice(1)) {
    const m = /^(\S+)\s+(\d+)\s+(\d+)\s+\d+\s+\S+\s+(\/.*)$/.exec(l)
    if (!m) continue
    const [, filesystem, total, used, mount] = m
    const real = (filesystem.startsWith('/dev/') && !filesystem.startsWith('/dev/loop')) || mount === '/'
    if (!real || seen.has(filesystem + mount) || (seen.has(filesystem) && mount !== '/')) continue
    seen.add(filesystem + mount)
    seen.add(filesystem)
    disks.push({ filesystem, mount, total: Number(total) * 1024, used: Number(used) * 1024 })
  }
  return disks
}

function parseNet(lines: string[]): { rx: number; tx: number } {
  let rx = 0
  let tx = 0
  for (const l of lines) {
    const m = /^\s*([^:\s]+):\s*(.*)$/.exec(l)
    if (!m || m[1] === 'lo') continue
    const cols = m[2].trim().split(/\s+/)
    rx += num(cols[0])
    tx += num(cols[8])
  }
  return { rx, tx }
}

export async function getStats(id: string): Promise<SystemStats> {
  const s = getSession(id)
  const { stdout, code, stderr } = await exec(s.client, COMMAND)
  if (code !== 0 && !stdout.includes('@@stat')) throw new AppError(`Não foi possível ler as métricas: ${stderr.trim() || `código ${code}`}`)
  const at = Date.now()
  const sec = sections(stdout)

  const cpu = (sec.stat ?? []).filter((l) => l.startsWith('cpu')).map((l): [number, number] => {
    const v = l.trim().split(/\s+/).slice(1, 9).map(Number)
    return [v.reduce((a, b) => a + b, 0), (v[3] ?? 0) + (v[4] ?? 0)] // ocioso = idle + iowait
  })
  if (cpu.length === 0) throw new AppError('Este servidor não expõe /proc/stat; o painel só funciona em Linux.')
  const net = parseNet(sec.net ?? [])
  const prev = previous.get(id)
  previous.set(id, { at, cpu, rx: net.rx, tx: net.tx })

  const busy = (i: number) => {
    const dt = cpu[i][0] - (prev?.cpu[i]?.[0] ?? cpu[i][0])
    return prev && prev.cpu[i] && dt > 0 ? pct((100 * (dt - (cpu[i][1] - prev.cpu[i][1]))) / dt) : null
  }
  const seconds = prev ? (at - prev.at) / 1000 : 0
  const rate = (now: number, before: number | undefined) => (prev && seconds > 0 && before !== undefined ? Math.max(0, (now - before) / seconds) : null)

  const [load, up] = [sec.load?.[0]?.split(/\s+/) ?? [], sec.load?.[1]?.split(/\s+/) ?? []]
  return {
    at,
    hostname: sec.host?.[0]?.trim() ?? '',
    kernel: sec.host?.[1]?.trim() ?? '',
    uptime: num(up[0]),
    load: [num(load[0]), num(load[1]), num(load[2])],
    cpu: { percent: busy(0), cores: cpu.length - 1 || 1, perCore: cpu.slice(1).map((_, i) => busy(i + 1)) },
    memory: parseMemory(sec.mem ?? []),
    disks: parseDisks(sec.df ?? []),
    network: { rxRate: rate(net.rx, prev?.rx), txRate: rate(net.tx, prev?.tx), rxTotal: net.rx, txTotal: net.tx }
  }
}
