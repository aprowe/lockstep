import { useEffect, useRef, useState } from 'react'

/**
 * Returns `true` while `value` is "fresh" (changed recently).
 * Resets to `false` after `delay` ms of no changes.
 * Skips the initial render so chips don't flash on mount.
 */
export function useTransientChip(value: string, delay = 1200): boolean {
  const [visible, setVisible] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = useRef(false)

  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return }
    setVisible(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setVisible(false), delay)
  }, [value, delay])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  return visible
}
