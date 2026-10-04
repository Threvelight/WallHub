import { useEffect, useState } from 'react'

let push: ((msg: string) => void) | null = null

/** Fire-and-forget status message ("Added 6 items"). */
export function toast(msg: string) {
  push?.(msg)
}

export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    push = (m) => {
      setMsg(m)
      clearTimeout(t)
      t = setTimeout(() => setMsg(null), 2600)
    }
    return () => {
      push = null
      clearTimeout(t)
    }
  }, [])
  return msg ? (
    <div className="toast" role="status">
      {msg}
    </div>
  ) : null
}
