import { useCallback, useEffect, useRef, useState } from 'react'

// Sierra Vista, AZ weather from Open-Meteo's free forecast API (no key). Their terms
// ask for attribution, which the Today screen shows. Nothing is stored: the latest
// reading lives in screen state only.

const URL_ =
  'https://api.open-meteo.com/v1/forecast?latitude=31.5545&longitude=-110.3037' +
  '&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min' +
  '&timezone=America%2FPhoenix&temperature_unit=fahrenheit&wind_speed_unit=mph&forecast_days=1'

const REFRESH_MS = 30 * 60_000
/** A reading older than this is hidden rather than shown as current. */
const STALE_MS = 90 * 60_000

export type Weather = { temp: number; high: number; low: number; label: string; icon: string; at: number }

/** Short word and icon for a WMO weather code. */
export function describe(code: number, isDay: boolean): { label: string; icon: string } {
  if (code === 0) return { label: 'Clear', icon: isDay ? '☀️' : '🌙' }
  if (code === 1) return { label: 'Mostly clear', icon: isDay ? '🌤️' : '🌙' }
  if (code === 2) return { label: 'Partly cloudy', icon: '⛅' }
  if (code === 3) return { label: 'Cloudy', icon: '☁️' }
  if (code === 45 || code === 48) return { label: 'Fog', icon: '🌫️' }
  if (code >= 51 && code <= 57) return { label: 'Drizzle', icon: '🌦️' }
  if (code >= 61 && code <= 67) return { label: 'Rain', icon: '🌧️' }
  if (code >= 71 && code <= 77) return { label: 'Snow', icon: '🌨️' }
  if (code >= 80 && code <= 82) return { label: 'Showers', icon: '🌦️' }
  if (code === 85 || code === 86) return { label: 'Snow showers', icon: '🌨️' }
  if (code >= 95) return { label: 'Storms', icon: '⛈️' }
  return { label: '', icon: '🌡️' }
}

async function fetchWeather(signal: AbortSignal): Promise<Weather> {
  const res = await fetch(URL_, { signal, cache: 'no-store' })
  if (!res.ok) throw new Error(`weather ${res.status}`)
  const j = await res.json()
  const num = (v: unknown) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('weather data missing')
    return Math.round(v)
  }
  return {
    temp: num(j.current?.temperature_2m),
    high: num(j.daily?.temperature_2m_max?.[0]),
    low: num(j.daily?.temperature_2m_min?.[0]),
    ...describe(j.current?.weather_code, j.current?.is_day !== 0),
    at: Date.now(),
  }
}

/**
 * Current weather, refreshed every 30 minutes and whenever the screen comes back
 * into view. `null` until the first reading arrives; `failed` when there's no
 * recent reading to show.
 */
export function useWeather() {
  const [weather, setWeather] = useState<Weather | null>(null)
  const [failed, setFailed] = useState(false)
  const last = useRef<Weather | null>(null)
  const controller = useRef<AbortController | null>(null)

  const refresh = useCallback(async () => {
    controller.current?.abort()
    const c = new AbortController()
    controller.current = c
    try {
      const w = await fetchWeather(c.signal)
      last.current = w
      setWeather(w)
      setFailed(false)
    } catch {
      if (c.signal.aborted) return
      // Keep a recent reading through a blip; hide an old one.
      if (!last.current || Date.now() - last.current.at > STALE_MS) {
        last.current = null
        setWeather(null)
        setFailed(true)
      }
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), REFRESH_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      controller.current?.abort()
    }
  }, [refresh])

  return { weather, failed }
}
