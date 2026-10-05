import { useEffect } from 'react'

/**
 * Keeps the screen on while the calling page is showing (Screen Wake Lock API,
 * iPadOS 16.4+). The browser drops the lock whenever the page is hidden, so it is
 * requested again each time the page becomes visible, and released on leaving.
 * Unsupported or refused requests are silently ignored.
 */
export function useWakeLock() {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let active = true

    const request = async () => {
      if (document.visibilityState !== 'visible' || (lock && !lock.released)) return
      try {
        const l = await navigator.wakeLock.request('screen')
        if (active) lock = l
        else void l.release()
      } catch {
        // Not allowed right now (e.g. low battery mode); nothing to show.
      }
    }
    const onVisible = () => void request()

    void request()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      active = false
      document.removeEventListener('visibilitychange', onVisible)
      if (lock && !lock.released) void lock.release().catch(() => {})
      lock = null
    }
  }, [])
}
