import { Box, Cog, Gauge, type LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { LogSource, ServicesAvailability } from '../../../../shared/types'
import { api } from '../../lib/api'
import { Dashboard } from './Dashboard'
import { DockerView, SystemdView } from './ServicePanels'

interface Props {
  vpsId: string
  /** A aba "Painel" está à frente: só então as leituras ao vivo rodam. */
  active: boolean
  closed: boolean
  onOpenLive: (source: LogSource) => void
}

interface Section {
  id: string
  label: string
  icon: LucideIcon
}

const OVERVIEW: Section = { id: 'overview', label: 'Visão geral', icon: Gauge }
const SYSTEMD: Section = { id: 'systemd', label: 'Serviços', icon: Cog }
const DOCKER: Section = { id: 'docker', label: 'Docker', icon: Box }

/** Painel da VPS: o que o servidor está fazendo agora (além dos arquivos). Fica montado para guardar o histórico. */
export function Panel({ vpsId, active, closed, onOpenLive }: Props) {
  const [section, setSection] = useState(OVERVIEW.id)
  const [available, setAvailable] = useState<ServicesAvailability | null>(null)
  const live = active && !closed

  // Serviços e Docker só aparecem se o servidor os tem (checado uma vez, ao abrir o painel).
  useEffect(() => {
    if (active && !closed && !available) api.services.availability(vpsId).then(setAvailable, () => setAvailable({ systemd: false, docker: false }))
  }, [active, closed, available, vpsId])

  const sections = [OVERVIEW, ...(available?.systemd ? [SYSTEMD] : []), ...(available?.docker ? [DOCKER] : [])]
  return (
    <div className={`absolute inset-0 flex bg-bg ${active ? '' : 'hidden'}`}>
      <nav className="w-44 shrink-0 border-r border-line bg-panel py-2" aria-label="Seções do painel">
        {sections.map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            aria-current={section === s.id}
            className={`flex h-8 w-full items-center gap-2 px-3 text-left ${section === s.id ? 'bg-hover text-fg' : 'text-muted hover:bg-hover hover:text-fg'}`}
          >
            <s.icon size={14} className="shrink-0" />
            <span className="truncate">{s.label}</span>
          </button>
        ))}
      </nav>
      <div className="relative min-w-0 flex-1">
        {section === OVERVIEW.id && <Dashboard vpsId={vpsId} active={live} />}
        {section === SYSTEMD.id && <SystemdView vpsId={vpsId} active={live} onOpenLive={onOpenLive} />}
        {section === DOCKER.id && <DockerView vpsId={vpsId} active={live} onOpenLive={onOpenLive} />}
      </div>
    </div>
  )
}
