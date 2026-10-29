import { useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'

const variants = {
  default: 'bg-panel-2 hover:bg-hover border border-line',
  primary: 'bg-accent hover:bg-blue-500 text-white',
  ghost: 'hover:bg-hover text-fg',
  danger: 'bg-red-600 hover:bg-red-500 text-white'
}
const sizes = { sm: 'h-7 px-2.5 text-xs', md: 'h-8 px-3.5', icon: 'h-7 w-7 justify-center' }

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants
  size?: keyof typeof sizes
}

export function Button({ variant = 'default', size = 'md', className = '', type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={`no-drag inline-flex shrink-0 items-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50 ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    />
  )
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`h-8 w-full rounded-md border border-line bg-bg px-2.5 outline-none placeholder:text-muted/60 focus:border-accent ${className}`}
      {...props}
    />
  )
}

export function Field({ label, hint, children, className = '' }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  )
}

interface ModalProps {
  title: string
  children: ReactNode
  footer?: ReactNode
  onClose: () => void
  width?: string
}

/** Janela modal. Esc fecha; clique fora não fecha, para não perder o que foi digitado. */
export function Modal({ title, children, footer, onClose, width = 'max-w-md' }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[autofocus], input, button')
    el?.focus()
  }, [])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return
          e.stopPropagation()
          onClose()
        }}
        className={`w-full ${width} max-h-[90vh] overflow-auto rounded-xl border border-line bg-panel shadow-2xl`}
      >
        <div className="px-5 pt-4 pb-2 text-[15px] font-semibold">{title}</div>
        <div className="px-5 py-2">{children}</div>
        {footer && <div className="flex justify-end gap-2 px-5 py-4">{footer}</div>}
      </div>
    </div>
  )
}
