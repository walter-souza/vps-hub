import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef } from 'react'
import { api, errMsg } from '../../lib/api'

interface Props {
  termId: string
  vpsId: string
  cwd: string
  hidden: boolean
}

export function TerminalView({ termId, vpsId, cwd, hidden }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)

  useEffect(() => {
    const el = ref.current!
    const term = new Terminal({
      fontFamily: "'Cascadia Code', Consolas, monospace",
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      theme: { background: '#151920', foreground: '#d7dce4', cursor: '#d7dce4', selectionBackground: '#3b82f655' }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    termRef.current = term
    // Painel recolhido tem tamanho zero; o fit só roda quando há espaço.
    const safeFit = () => el.offsetWidth > 0 && el.offsetHeight > 0 && fit.fit()
    safeFit()

    const offData = api.terminal.onData((id, data) => id === termId && term.write(data))
    const offExit = api.terminal.onExit((id) => id === termId && term.write('\r\n\x1b[90m[sessão encerrada]\x1b[0m\r\n'))
    const input = term.onData((d) => api.terminal.write(termId, d))
    const resize = term.onResize(({ cols, rows }) => api.terminal.resize(termId, cols, rows))
    const observer = new ResizeObserver(() => safeFit())
    observer.observe(el)

    api.terminal.open(termId, vpsId, cwd, term.cols, term.rows).catch((e) => term.write(`\x1b[31m${errMsg(e)}\x1b[0m\r\n`))

    return () => {
      observer.disconnect()
      offData()
      offExit()
      input.dispose()
      resize.dispose()
      api.terminal.close(termId)
      term.dispose()
      termRef.current = null
    }
  }, [termId, vpsId, cwd])

  useEffect(() => {
    if (!hidden) termRef.current?.focus()
  }, [hidden])

  return (
    <div className={`absolute inset-0 bg-panel p-2 ${hidden ? 'invisible' : ''}`}>
      <div ref={ref} className="h-full w-full" />
    </div>
  )
}
