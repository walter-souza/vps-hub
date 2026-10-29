import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from 'react'

/** Altura fixa de cada linha da lista (classe h-7); permite achar linhas pela posição sem medir o DOM. */
export const ROW_HEIGHT = 28

export interface ClickModifiers {
  ctrlKey: boolean
  shiftKey: boolean
}

/**
 * Seleção no estilo do Windows Explorer: "anchor" é onde começa o intervalo do Shift e "focus" é o
 * item atual (o que as setas movem). Ctrl+setas move só o foco; Ctrl+Espaço alterna o item focado.
 */
export function useListSelection(paths: string[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [focus, setFocus] = useState<string | null>(null)

  // Itens que sumiram da lista (outra pasta, filtro, exclusão) saem da seleção.
  useEffect(() => {
    const present = new Set(paths)
    setSelected((s) => ([...s].every((p) => present.has(p)) ? s : new Set([...s].filter((p) => present.has(p)))))
    setFocus((f) => (f && present.has(f) ? f : null))
    setAnchor((a) => (a && present.has(a) ? a : null))
  }, [paths])

  const range = useCallback(
    (from: string, to: string) => {
      const a = paths.indexOf(from)
      const b = paths.indexOf(to)
      if (a < 0 || b < 0) return [to]
      return paths.slice(Math.min(a, b), Math.max(a, b) + 1)
    },
    [paths]
  )

  /** Seleciona exatamente estes caminhos (ex.: após criar/colar), focando o primeiro. */
  const selectOnly = useCallback((list: string[]) => {
    setSelected(new Set(list))
    setAnchor(list[0] ?? null)
    setFocus(list[0] ?? null)
  }, [])

  const click = (path: string, { ctrlKey, shiftKey }: ClickModifiers) => {
    if (shiftKey) {
      const start = anchor ?? focus ?? path
      const span = range(start, path)
      setSelected((s) => new Set(ctrlKey ? [...s, ...span] : span))
      setAnchor(start)
    } else if (ctrlKey) {
      setSelected((s) => {
        const next = new Set(s)
        if (next.has(path)) next.delete(path)
        else next.add(path)
        return next
      })
      setAnchor(path)
    } else {
      setSelected(new Set([path]))
      setAnchor(path)
    }
    setFocus(path)
  }

  /** Move o foco para o índice (já limitado à lista) com a semântica de Shift/Ctrl do Windows. */
  const moveTo = (index: number, { ctrlKey, shiftKey }: ClickModifiers) => {
    if (paths.length === 0) return null
    const target = paths[Math.max(0, Math.min(paths.length - 1, index))]
    if (shiftKey) {
      const start = anchor ?? focus ?? target
      setSelected(new Set(range(start, target)))
      setAnchor(start)
    } else if (!ctrlKey) {
      setSelected(new Set([target]))
      setAnchor(target)
    }
    setFocus(target)
    return target
  }

  const toggleFocused = () => {
    if (!focus) return
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(focus)) next.delete(focus)
      else next.add(focus)
      return next
    })
    setAnchor(focus)
  }

  const focusIndex = focus ? paths.indexOf(focus) : -1
  return { selected, setSelected, selectOnly, focus, focusIndex, click, moveTo, toggleFocused }
}

/** Digitar letras pula para o primeiro item cujo nome começa com o que foi digitado (como no Windows). */
export function useTypeAhead(names: string[], focusIndex: number, onMatch: (index: number) => void) {
  const buffer = useRef('')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  return (key: string) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => (buffer.current = ''), 1000)
    // Repetir a mesma letra percorre os itens que começam com ela.
    const repeating = buffer.current.length > 0 && [...buffer.current].every((c) => c === key.toLowerCase())
    buffer.current += key.toLowerCase()
    const prefix = repeating ? key.toLowerCase() : buffer.current
    const start = repeating || buffer.current.length === 1 ? focusIndex + 1 : Math.max(focusIndex, 0)
    for (let i = 0; i < names.length; i++) {
      const idx = (start + i) % names.length
      if (names[idx].toLowerCase().startsWith(prefix)) return onMatch(idx)
    }
  }
}

interface MarqueeRect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Retângulo de seleção ao arrastar a partir de um espaço em branco da lista (fora do nome dos itens).
 * Coordenadas no conteúdo rolável, com rolagem automática perto das bordas. Ctrl inverte e Shift soma
 * os itens tocados. Sem arrastar, vira um clique na linha sob o cursor (onTap).
 */
export function useMarquee(
  listRef: RefObject<HTMLDivElement | null>,
  paths: string[],
  selected: Set<string>,
  onSelect: (next: Set<string>) => void,
  onTap: (path: string | null, mods: ClickModifiers) => void
) {
  const [rect, setRect] = useState<MarqueeRect | null>(null)
  const pathsRef = useRef(paths)
  pathsRef.current = paths

  const start = (e: ReactMouseEvent) => {
    const list = listRef.current
    if (!list || e.button !== 0) return
    const box = list.getBoundingClientRect()
    const origin = { x: e.clientX - box.left + list.scrollLeft, y: e.clientY - box.top + list.scrollTop }
    const mods = { ctrlKey: e.ctrlKey, shiftKey: e.shiftKey }
    const base = e.ctrlKey || e.shiftKey ? new Set(selected) : new Set<string>()
    let pointer = { x: e.clientX, y: e.clientY }
    let started = false

    const update = () => {
      const b = list.getBoundingClientRect()
      const x = Math.max(0, Math.min(list.scrollWidth, pointer.x - b.left + list.scrollLeft))
      const y = Math.max(0, Math.min(list.scrollHeight, pointer.y - b.top + list.scrollTop))
      if (!started && Math.abs(x - origin.x) < 4 && Math.abs(y - origin.y) < 4) return
      started = true
      list.focus()
      const top = Math.min(origin.y, y)
      const bottom = Math.max(origin.y, y)
      setRect({ left: Math.min(origin.x, x), top, width: Math.abs(x - origin.x), height: bottom - top })
      const all = pathsRef.current
      const first = Math.max(0, Math.floor(top / ROW_HEIGHT))
      const last = Math.min(all.length - 1, Math.floor(bottom / ROW_HEIGHT))
      const touched = first <= last ? all.slice(first, last + 1) : []
      const next = new Set(base)
      for (const p of touched) {
        if (e.ctrlKey && base.has(p)) next.delete(p)
        else next.add(p)
      }
      onSelect(next)
    }

    // Rolagem automática enquanto o cursor está acima/abaixo da lista.
    const scroller = setInterval(() => {
      const b = list.getBoundingClientRect()
      const dy = pointer.y < b.top ? pointer.y - b.top : pointer.y > b.bottom ? pointer.y - b.bottom : 0
      if (dy !== 0 && started) {
        list.scrollTop += Math.sign(dy) * Math.min(40, Math.abs(dy))
        update()
      }
    }, 30)
    const move = (ev: MouseEvent) => {
      pointer = { x: ev.clientX, y: ev.clientY }
      update()
    }
    const up = () => {
      clearInterval(scroller)
      if (!started) onTap(pathsRef.current[Math.floor(origin.y / ROW_HEIGHT)] ?? null, mods)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setRect(null)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return { rect, start }
}
