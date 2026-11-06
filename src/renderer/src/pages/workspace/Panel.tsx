import { Gauge, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { Dashboard } from './Dashboard'

interface Props {
  vpsId: string
  /** A aba "Painel" está à frente: só então as leituras ao vivo rodam. */
  active: boolean
  closed: boolean
}

const SECTIONS: { id: string; label: string; icon: LucideIcon }[] = [{ id: 'overview', label: 'Visão geral', icon: Gauge }]

/** Painel da VPS: o que o servidor está fazendo agora (além dos arquivos). Fica montado para guardar o histórico. */
export function Panel({ vpsId, active, closed }: Props) {
  const [section, setSection] = useState(SECTIONS[0].id)
  return (
    <div className={`absolute inset-0 flex bg-bg ${active ? '' : 'hidden'}`}>
      <nav className="w-44 shrink-0 border-r border-line bg-panel py-2" aria-label="Seções do painel">
        {SECTIONS.map((s) => (
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
        {section === 'overview' && <Dashboard vpsId={vpsId} active={active && !closed} />}
      </div>
    </div>
  )
}
