import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { listPhotos, shuffle, signPhotos, type Photo } from '../lib/photos'

/** The slideshow starts after this long with no taps, keys, scrolling or typing. */
const IDLE_MS = 5 * 60_000
/** How long each photo stays up. */
const SLIDE_MS = 15_000
/**
 * The slideshow's links last a day and are reused from pass to pass, so the browser's
 * own HTTP cache can serve a photo it has already shown instead of downloading it again
 * (which matters for the free plan's monthly download allowance).
 */
const LINK_SECONDS = 24 * 60 * 60
/** Re-sign a little before a link runs out. */
const RESIGN_MS = (LINK_SECONDS - 10 * 60) * 1000
const ACTIVITY = ['pointerdown', 'keydown', 'wheel', 'scroll', 'touchstart', 'input'] as const

/** True while something on the page wants the person's attention: a sheet, the note editor, a text field. */
function busy() {
  if (document.querySelector('.backdrop, dialog[open]')) return true
  const el = document.activeElement
  return !!el && (el.matches('input, textarea, select') || (el as HTMLElement).isContentEditable)
}

/**
 * Today's photo frame. After a stretch with nobody using the screen, it shows the
 * household's photos full-screen. It never runs at night (night mode wins), and with no
 * photos, or when they can't be loaded, it simply doesn't appear.
 *
 * For testing, for this page view only: ?idle=10 sets the idle time to 10 seconds, and
 * ?photos=1 starts it straight away if there are photos.
 */
export default function PhotoFrame({ householdId, night, now }: { householdId?: string; night: boolean; now: Date }) {
  const [params] = useSearchParams()
  const idleSeconds = Number(params.get('idle'))
  const idleMs = idleSeconds > 0 ? idleSeconds * 1000 : IDLE_MS
  const startNow = useRef(params.get('photos') === '1')
  const lastActive = useRef(Date.now())
  const [first, setFirst] = useState<Photo[] | null>(null)
  const checking = useRef(false)

  // Any use of the screen restarts the idle wait.
  useEffect(() => {
    const touch = () => (lastActive.current = Date.now())
    for (const t of ACTIVITY) document.addEventListener(t, touch, { capture: true, passive: true })
    return () => {
      for (const t of ACTIVITY) document.removeEventListener(t, touch, { capture: true })
    }
  }, [])

  // Night mode takes over from a running slideshow, and the idle wait starts again in the morning.
  useEffect(() => {
    if (!night) return
    lastActive.current = Date.now()
    setFirst(null)
  }, [night])

  // Once a second, see whether it's time to start.
  useEffect(() => {
    if (night || first || !householdId) return
    let live = true
    const timer = setInterval(async () => {
      const due = startNow.current || Date.now() - lastActive.current >= idleMs
      if (!due || checking.current || document.visibilityState !== 'visible' || busy()) return
      checking.current = true
      startNow.current = false
      const since = lastActive.current
      let photos: Photo[] = []
      try {
        photos = await listPhotos(householdId)
      } catch {
        /* no slideshow this time */
      }
      checking.current = false
      if (!live) return // night began, or the page closed, while listing
      // Starting is pointless with no photos, and wrong if someone touched the screen meanwhile.
      if (photos.length && !busy() && lastActive.current === since) setFirst(photos)
      else lastActive.current = Date.now()
    }, 1000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [night, first, householdId, idleMs])

  if (night || !first || !householdId) return null
  return (
    <Slideshow
      householdId={householdId}
      first={first}
      now={now}
      onEnd={() => {
        lastActive.current = Date.now()
        setFirst(null)
      }}
    />
  )
}

/** Resolves once the image is downloaded and decoded, so it can fade in whole. */
function preload(url: string): Promise<boolean> {
  const img = new Image()
  img.src = url
  return img.decode().then(
    () => true,
    () => false,
  )
}

function Slideshow({
  householdId,
  first,
  now,
  onEnd,
}: {
  householdId: string
  first: Photo[]
  now: Date
  onEnd: () => void
}) {
  // Two stacked layers; flipping which one is on top crossfades between them.
  const [layers, setLayers] = useState<[string | null, string | null]>([null, null])
  const [top, setTop] = useState(0)
  const endRef = useRef(onEnd)
  endRef.current = onEnd

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    let wake = () => {}
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        wake = resolve
        timer = setTimeout(resolve, ms)
      })
    let front = 0
    const show = (url: string) => {
      front = 1 - front
      const f = front
      setLayers((l) => (f === 0 ? [url, l[1]] : [l[0], url]))
      setTop(f)
    }

    const links = new Map<string, { url: string; at: number }>()
    const fresh = (path: string) => {
      const l = links.get(path)
      return l && Date.now() - l.at < RESIGN_MS ? l.url : undefined
    }
    async function sign(paths: string[]) {
      try {
        const at = Date.now()
        for (const [path, url] of await signPhotos(paths, LINK_SECONDS)) links.set(path, { url, at })
      } catch {
        /* those photos are skipped */
      }
    }

    async function run() {
      let list = first
      let last: string | undefined
      for (let pass = 0; !stopped; pass++) {
        // Each pass picks up photos added or deleted since the last one.
        if (pass > 0) {
          try {
            list = await listPhotos(householdId)
          } catch {
            /* keep the previous list */
          }
        }
        if (stopped || !list.length) break
        const order = shuffle(list.map((p) => p.path))
        // Don't show the same photo twice in a row across passes.
        if (order.length > 1 && order[0] === last) order.push(order.shift()!)

        // Sign, in one call, every photo in this pass without a usable link.
        const missing = order.filter((p) => !fresh(p))
        if (missing.length) await sign(missing)
        // Download and decode a photo; a link that fails is signed again once.
        const load = async (path: string) => {
          let url = fresh(path)
          if (url && (await preload(url))) return url
          await sign([path])
          url = links.get(path)?.url
          return url && (await preload(url)) ? url : undefined
        }

        let shown = 0
        let next = load(order[0])
        for (let i = 0; i < order.length && !stopped; i++) {
          const url = await next
          // Fetch the following photo while this one is up.
          next = i + 1 < order.length ? load(order[i + 1]) : Promise.resolve(undefined)
          if (stopped) return
          if (!url) continue
          show(url)
          last = order[i]
          shown++
          await wait(SLIDE_MS)
        }
        // Nothing in this pass could be shown: leave quietly rather than try again at once.
        if (!shown) break
      }
      if (!stopped) endRef.current()
    }
    void run()
    return () => {
      stopped = true
      clearTimeout(timer)
      wake()
    }
  }, [householdId, first])

  // Any key ends it. (A tap is handled by the overlay itself, so it can't press anything below.)
  useEffect(() => {
    const end = () => endRef.current()
    document.addEventListener('keydown', end, true)
    return () => document.removeEventListener('keydown', end, true)
  }, [])

  // Until the first photo is ready there's nothing to see, but a tap still cancels it.
  const started = layers[0] !== null || layers[1] !== null
  return (
    <div
      className={`photo-frame ${started ? 'shown' : ''}`}
      role="button"
      aria-label="Photo slideshow, tap to go back to Today"
      onClick={() => endRef.current()}
    >
      {layers.map((url, i) =>
        url ? (
          <img key={i} className={`photo-layer ${top === i ? 'on' : ''}`} src={url} alt="" draggable={false} />
        ) : null,
      )}
      {started && (
        <div className="photo-clock" aria-hidden>
          {now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
        </div>
      )}
    </div>
  )
}
