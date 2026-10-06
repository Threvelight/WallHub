import { useCallback, useEffect, useRef, useState } from 'react'
import {
  deletePhoto,
  formatSize,
  getUploaders,
  listPhotos,
  shrinkPhoto,
  signPhotos,
  SIGNED_SECONDS,
  uploadPhoto,
  type Photo,
} from '../lib/photos'
import { toast } from './Toast'

/** Above this, remind people how much the free plan holds. */
const NEARLY_FULL = 800 * 1024 * 1024
/** Re-sign a little before the URLs run out. */
const RESIGN_MS = (SIGNED_SECONDS - 10 * 60) * 1000

/** The Photos card in Settings: add photos for the Today photo frame, see them, delete them. */
export default function PhotosSection({
  householdId,
  userId,
  isOwner,
}: {
  householdId: string
  userId: string
  isOwner: boolean
}) {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [urls, setUrls] = useState<Map<string, string>>(new Map())
  const [uploaders, setUploaders] = useState<Map<string, string>>(new Map())
  const [loaded, setLoaded] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [progress, setProgress] = useState('')
  const [failures, setFailures] = useState<string[]>([])
  const [deleting, setDeleting] = useState<string | null>(null)
  const [refused, setRefused] = useState(false)
  const signedAt = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)

  const sign = useCallback(async (paths: string[]) => {
    try {
      setUrls(await signPhotos(paths))
      signedAt.current = Date.now()
    } catch {
      /* the grid shows placeholders; the next refresh tries again */
    }
  }, [])

  const load = useCallback(async () => {
    try {
      const list = await listPhotos(householdId)
      setPhotos(list)
      setLoadFailed(false)
      await sign(list.map((p) => p.path))
      // The owner may delete everything, so only members need to know who added what.
      if (!isOwner) setUploaders(await getUploaders(list.map((p) => p.path)))
    } catch {
      setLoadFailed(true)
    } finally {
      setLoaded(true)
    }
  }, [householdId, isOwner, sign])

  useEffect(() => {
    void load()
  }, [load])

  // Signed URLs expire after an hour: refresh them before then, and on return to the page.
  useEffect(() => {
    const paths = photos.map((p) => p.path)
    const stale = () => Date.now() - signedAt.current > RESIGN_MS
    const timer = setInterval(() => stale() && void sign(paths), 60_000)
    const onVisible = () => document.visibilityState === 'visible' && stale() && void sign(paths)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [photos, sign])

  async function addPhotos(files: File[]) {
    const failed: string[] = []
    const added = new Map(uploaders)
    setFailures([])
    for (let i = 0; i < files.length; i++) {
      setProgress(`Uploading ${i + 1} of ${files.length}`)
      try {
        const path = await uploadPhoto(householdId, userId, await shrinkPhoto(files[i]))
        added.set(path, userId)
      } catch {
        failed.push(files[i].name || `Photo ${i + 1}`)
      }
    }
    setUploaders(added)
    setProgress('')
    setFailures(failed)
    const ok = files.length - failed.length
    if (ok) toast(`Added ${ok} photo${ok === 1 ? '' : 's'}`)
    await load()
  }

  async function remove(path: string) {
    if (!confirm('Delete this photo? It will leave the photo frame on every device.')) return
    setDeleting(path)
    setRefused(false)
    const ok = await deletePhoto(path)
    setDeleting(null)
    if (ok) {
      setPhotos((list) => list.filter((p) => p.path !== path))
      toast('Photo deleted')
    } else {
      setRefused(true)
      void load()
    }
  }

  const total = photos.reduce((sum, p) => sum + p.size, 0)
  const canDelete = (path: string) => isOwner || uploaders.get(path) === userId

  return (
    <section className="card stack" aria-label="Photos">
      <h2>Photos</h2>
      <p className="muted small">
        Photos show on the Today screen as a slideshow when nobody has touched it for 5 minutes, between 6 AM and 9 PM.
        They're shrunk before uploading. Location data is removed from uploaded copies. Photos aren't included in the
        backup file.
      </p>
      <div className="row wrap">
        <button className="primary" disabled={!!progress} onClick={() => fileInput.current?.click()}>
          Add photos
        </button>
        {progress && (
          <span className="muted" role="status">
            {progress}
          </span>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])]
            e.target.value = ''
            if (files.length) void addPhotos(files)
          }}
        />
      </div>
      {failures.length > 0 && (
        <p className="error small" role="alert">
          {failures.length === 1 ? "This one didn't upload: " : "These didn't upload: "}
          {failures.join(', ')}. This device may not be able to open {failures.length === 1 ? 'it' : 'them'}, or the
          connection dropped. Try again.
        </p>
      )}

      {loaded && (
        <p className="small" aria-live="polite">
          {photos.length
            ? `${photos.length} photo${photos.length === 1 ? '' : 's'}, ${formatSize(total)}`
            : loadFailed
              ? "Photos can't be loaded right now."
              : 'No photos yet.'}
          {total > NEARLY_FULL && <span className="muted"> The free plan holds 1 GB.</span>}
        </p>
      )}

      {refused && (
        <p className="error small" role="alert">
          That photo couldn't be deleted. Only the person who added it, or the household owner, can delete it. If you
          did add it, check the connection and try again.
        </p>
      )}

      {photos.length > 0 && (
        <ul className="photo-grid">
          {photos.map((p) => {
            const url = urls.get(p.path)
            return (
              <li key={p.path} className="photo-tile">
                {url ? (
                  <img
                    src={url}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    // An expired or broken link: sign again (at most once a minute).
                    onError={() => Date.now() - signedAt.current > 60_000 && void sign(photos.map((x) => x.path))}
                  />
                ) : (
                  <span className="photo-placeholder" aria-hidden />
                )}
                {canDelete(p.path) && (
                  <button
                    className="photo-delete"
                    aria-label="Delete photo"
                    disabled={deleting === p.path}
                    onClick={() => void remove(p.path)}
                  >
                    ✕
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
