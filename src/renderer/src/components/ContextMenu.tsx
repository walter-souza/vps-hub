import type { LucideIcon } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export type MenuEntry =
  | { label: string; icon?: LucideIcon; shortcut?: string; onClick: () => void; danger?: boolean; disabled?: boolean }
  | 'sep'

export interface MenuState {
  x: number
  y: number
  items: MenuEntry[]
}

export function ContextMenu({ x, y, items, onClose }: MenuState & { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  // Mantém o menu dentro da janela.
  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect()
    setPos({ x: Math.min(x, window.innerWidth - r.width - 4), y: Math.min(y, window.innerHeight - r.height - 4) })
    ref.current!.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [x, y])

  useEffect(() => {
    const outside = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose()
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('mousedown', outside)
    window.addEventListener('keydown', key)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('mousedown', outside)
      window.removeEventListener('keydown', key)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  const moveFocus = (dir: 1 | -1) => {
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
    buttons[(i + dir + buttons.length) % buttons.length]?.focus()
  }

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') moveFocus(1)
        else if (e.key === 'ArrowUp') moveFocus(-1)
        else return
        e.preventDefault()
      }}
      className="fixed z-50 min-w-56 rounded-lg border border-line bg-panel-2 p-1 shadow-xl"
    >
      {items.map((it, i) => {
        if (it === 'sep') return <div key={i} className="my-1 h-px bg-line" />
        const Icon = it.icon
        return (
          <button
            key={i}
            role="menuitem"
            disabled={it.disabled}
            onClick={() => {
              onClose()
              it.onClick()
            }}
            className={`flex h-7 w-full items-center gap-2.5 rounded px-2 text-left outline-none hover:bg-hover focus:bg-hover disabled:opacity-40 ${it.danger ? 'text-red-400' : ''}`}
          >
            <span className="w-4">{Icon && <Icon size={14} />}</span>
            <span className="flex-1">{it.label}</span>
            {it.shortcut && <span className="text-[11px] text-muted">{it.shortcut}</span>}
          </button>
        )
      })}
    </div>
  )
}
