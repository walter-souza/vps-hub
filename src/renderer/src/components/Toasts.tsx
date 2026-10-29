import { CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { useApp } from '../lib/store'

const icons = { info: Info, success: CheckCircle2, error: XCircle }
const colors = { info: 'text-accent', success: 'text-ok', error: 'text-danger' }

export function Toasts() {
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismissToast)
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-96 flex-col gap-2" aria-live="polite">
      {toasts.map((t) => {
        const Icon = icons[t.kind]
        return (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-line bg-panel-2 p-3 shadow-xl"
          >
            <Icon size={16} className={`mt-0.5 shrink-0 ${colors[t.kind]}`} />
            <div className="min-w-0 flex-1 break-words">{t.text}</div>
            {t.action && (
              <button
                className="shrink-0 text-xs font-medium text-accent hover:underline"
                onClick={() => {
                  t.action!.run()
                  dismiss(t.id)
                }}
              >
                {t.action.label}
              </button>
            )}
            <button aria-label="Fechar" className="shrink-0 text-muted hover:text-fg" onClick={() => dismiss(t.id)}>
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
