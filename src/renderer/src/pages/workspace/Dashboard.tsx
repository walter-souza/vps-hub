import { useEffect, useRef, useState } from 'react'
import type { SystemStats } from '../../../../shared/types'
import { api, errMsg } from '../../lib/api'
import { formatSize } from '../../lib/format'

const REFRESH_MS = 2000
const HISTORY = 60

interface History {
  cpu: number[]
  mem: number[]
  rx: number[]
  tx: number[]
}

const push = (list: number[], v: number | null) => (v === null ? list : [...list.slice(-(HISTORY - 1)), v])

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return [d && `${d} d`, (d || h) && `${h} h`, `${m} min`].filter(Boolean).join(' ')
}

const rateText = (v: number | null) => (v === null ? '—' : `${formatSize(v)}/s`)

/** Cor da barra conforme o uso: verde, âmbar, vermelho. */
const level = (percent: number) => (percent >= 90 ? 'bg-danger' : percent >= 75 ? 'bg-warn' : 'bg-ok')

function Sparkline({ values, max = 100, color = 'var(--color-accent)' }: { values: number[]; max?: number; color?: string }) {
  const top = Math.max(max, ...values, 1)
  // Alinhado à direita: a leitura mais recente fica na borda, como num monitor de tarefas.
  const points = values.map((v, i) => `${((HISTORY - values.length + i) / (HISTORY - 1)) * 100},${28 - (v / top) * 26}`).join(' ')
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-10 w-full" aria-hidden>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function Card({ title, value, detail, children, label }: { title: string; value: string; detail?: string; children?: React.ReactNode; label: string }) {
  return (
    <section className="rounded-lg border border-line bg-panel p-4" aria-label={label}>
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{title}</h3>
        <span className="text-lg font-semibold">{value}</span>
      </div>
      {detail && <div className="mt-0.5 text-xs text-muted">{detail}</div>}
      <div className="mt-2">{children}</div>
    </section>
  )
}

function Bar({ percent }: { percent: number }) {
  return (
    <div className="h-2 overflow-hidden rounded bg-panel-2" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full ${level(percent)}`} style={{ width: `${percent}%` }} />
    </div>
  )
}

/** Visão geral: CPU, memória, disco, rede e carga, atualizados a cada 2 s enquanto a aba está à frente. */
export function Dashboard({ vpsId, active }: { vpsId: string; active: boolean }) {
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [history, setHistory] = useState<History>({ cpu: [], mem: [], rx: [], tx: [] })
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)

  useEffect(() => {
    if (!active) return
    let alive = true
    const read = async () => {
      if (busy.current) return
      busy.current = true
      try {
        const s = await api.stats.get(vpsId)
        if (!alive) return
        setStats(s)
        setError(null)
        const memPercent = s.memory.total ? (100 * s.memory.used) / s.memory.total : null
        setHistory((h) => ({
          cpu: push(h.cpu, s.cpu.percent),
          mem: push(h.mem, memPercent),
          rx: push(h.rx, s.network.rxRate),
          tx: push(h.tx, s.network.txRate)
        }))
      } catch (e) {
        if (alive) setError(errMsg(e))
      } finally {
        busy.current = false
      }
    }
    read()
    const timer = setInterval(read, REFRESH_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [vpsId, active])

  if (error && !stats) {
    return (
      <div className="flex h-full items-center justify-center text-danger" role="alert">
        {error}
      </div>
    )
  }
  if (!stats) return <div className="flex h-full items-center justify-center text-muted">Lendo métricas…</div>

  const mem = stats.memory
  const memPercent = mem.total ? (100 * mem.used) / mem.total : 0
  const cpu = stats.cpu.percent
  return (
    <div className="h-full overflow-auto p-4">
      <div className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-muted">
        <span className="text-sm font-semibold text-fg">{stats.hostname || 'Servidor'}</span>
        <span>Kernel {stats.kernel}</span>
        <span>No ar há {formatUptime(stats.uptime)}</span>
        <span>
          Carga {stats.load.map((l) => l.toFixed(2)).join(' · ')} ({stats.cpu.cores} núcleo{stats.cpu.cores > 1 ? 's' : ''})
        </span>
        {error && <span className="text-danger">{error}</span>}
      </div>

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
        <Card label="CPU" title="CPU" value={cpu === null ? '—' : `${cpu.toFixed(0)}%`} detail={`${stats.cpu.cores} núcleo${stats.cpu.cores > 1 ? 's' : ''}`}>
          <Sparkline values={history.cpu} />
          {stats.cpu.cores > 1 && (
            <div className="mt-2 flex h-8 items-end gap-0.5" aria-label="Uso por núcleo">
              {stats.cpu.perCore.map((p, i) => (
                <div key={i} className="flex-1 rounded-sm bg-panel-2" title={`Núcleo ${i}: ${p === null ? '—' : `${p.toFixed(0)}%`}`}>
                  <div className={`w-full rounded-sm ${level(p ?? 0)}`} style={{ height: `${Math.max(p ?? 0, 3) * 0.32}px` }} />
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card
          label="Memória"
          title="Memória"
          value={`${memPercent.toFixed(0)}%`}
          detail={`${formatSize(mem.used)} de ${formatSize(mem.total)}${mem.swapTotal ? ` · swap ${formatSize(mem.swapUsed)} de ${formatSize(mem.swapTotal)}` : ''}`}
        >
          <Sparkline values={history.mem} color="var(--color-ok)" />
          <div className="mt-2">
            <Bar percent={memPercent} />
          </div>
        </Card>

        <Card label="Rede" title="Rede" value={`↓ ${rateText(stats.network.rxRate)}`} detail={`↑ ${rateText(stats.network.txRate)} · total ↓ ${formatSize(stats.network.rxTotal)} ↑ ${formatSize(stats.network.txTotal)}`}>
          <Sparkline values={history.rx} max={1024} color="var(--color-accent)" />
          <Sparkline values={history.tx} max={1024} color="var(--color-warn)" />
        </Card>

        <Card label="Disco" title="Disco" value={stats.disks[0] ? `${Math.round((100 * stats.disks[0].used) / (stats.disks[0].total || 1))}%` : '—'}>
          <ul className="space-y-3">
            {stats.disks.map((d) => {
              const percent = d.total ? (100 * d.used) / d.total : 0
              return (
                <li key={d.filesystem + d.mount}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="truncate font-mono" title={d.filesystem}>
                      {d.mount}
                    </span>
                    <span className="text-muted">
                      {formatSize(d.used)} de {formatSize(d.total)} · {percent.toFixed(0)}%
                    </span>
                  </div>
                  <Bar percent={percent} />
                </li>
              )
            })}
          </ul>
        </Card>
      </div>
    </div>
  )
}
