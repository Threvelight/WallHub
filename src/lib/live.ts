import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

/**
 * Runs `fetcher`, then re-runs it whenever any of `tables` changes for this
 * household (Supabase Realtime) or the app comes back to the foreground.
 * Refetching (instead of patching rows from the event) keeps every device exact,
 * and household lists are small enough that it is cheap.
 */
export function useLiveQuery<T>(
  key: string,
  householdId: string | undefined,
  tables: string[],
  fetcher: () => Promise<T>,
  initial: T,
) {
  const [data, setData] = useState<T>(initial)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const latest = useRef(0)

  const reload = useCallback(async () => {
    // Only the newest request may land, so a slow older one can't overwrite it.
    const seq = ++latest.current
    try {
      const result = await fetcherRef.current()
      if (seq !== latest.current) return
      setData(result)
      setError(null)
    } catch (e) {
      if (seq !== latest.current) return
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (seq === latest.current) setLoading(false)
    }
  }, [])

  const scheduleReload = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void reload(), 120)
  }, [reload])

  const tablesKey = tables.join(',')

  useEffect(() => {
    if (!householdId) return
    setLoading(true)
    void reload()

    const channel = supabase.channel(`live:${key}:${householdId}`)
    for (const table of tablesKey.split(',')) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `household_id=eq.${householdId}` },
        scheduleReload,
      )
      // Realtime can't filter deletes, so listen to all of them; a stray one
      // only costs a refetch.
      channel.on('postgres_changes', { event: 'DELETE', schema: 'public', table }, scheduleReload)
    }
    channel.subscribe((status) => {
      // After a reconnect (phone slept, network blip) pick up anything missed.
      if (status === 'SUBSCRIBED') scheduleReload()
    })

    const onVisible = () => {
      if (document.visibilityState === 'visible') scheduleReload()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', scheduleReload)

    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', scheduleReload)
      if (timer.current) clearTimeout(timer.current)
      void supabase.removeChannel(channel)
    }
  }, [key, householdId, tablesKey, reload, scheduleReload])

  return { data, setData, loading, error, reload }
}

export const normalize = (s: string) => s.trim().toLowerCase()
