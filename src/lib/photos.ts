// Household photos for the Today photo frame. Files live in the private
// household-photos bucket at <household_id>/<random id>.jpg. Nothing about them is
// kept in browser storage: listings and signed URLs live in screen state only.

import { supabase } from './supabase'

const BUCKET = 'household-photos'
const bucket = () => supabase.storage.from(BUCKET)

/** Longest side, in pixels, of an uploaded copy. */
const MAX_SIDE = 1600
const QUALITY = 0.82
/** The bucket refuses anything larger. */
const MAX_BYTES = 2 * 1024 * 1024
/** Signed URLs last this long. */
export const SIGNED_SECONDS = 60 * 60

export type Photo = {
  /** Full path in the bucket */
  path: string
  createdAt: string
  size: number
}

/** Every photo in the household's folder, newest first. */
export async function listPhotos(householdId: string): Promise<Photo[]> {
  const out: Photo[] = []
  // The API returns at most `limit` entries per call.
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await bucket().list(householdId, {
      limit: 1000,
      offset,
      sortBy: { column: 'created_at', order: 'desc' },
    })
    if (error) throw new Error(error.message)
    for (const f of data ?? []) {
      if (!f.id || f.name.startsWith('.')) continue // folders and placeholders
      out.push({ path: `${householdId}/${f.name}`, createdAt: f.created_at ?? '', size: Number(f.metadata?.size) || 0 })
    }
    if ((data ?? []).length < 1000) break
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Signed URLs for these paths, valid for an hour. Paths that fail are left out. */
export async function signPhotos(paths: string[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>()
  if (!paths.length) return urls
  const { data, error } = await bucket().createSignedUrls(paths, SIGNED_SECONDS)
  if (error) throw new Error(error.message)
  for (const d of data ?? []) if (d.path && d.signedUrl) urls.set(d.path, d.signedUrl)
  return urls
}

/**
 * Who added each photo, from the `uploader` metadata saved with it. Used only to
 * decide whether to offer a delete button; the database decides who may delete.
 */
export async function getUploaders(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const results = await Promise.allSettled(paths.map((p) => bucket().info(p)))
  results.forEach((r, i) => {
    const meta = r.status === 'fulfilled' ? (r.value.data?.metadata as Record<string, unknown> | undefined) : undefined
    if (typeof meta?.uploader === 'string') out.set(paths[i], meta.uploader)
  })
  return out
}

/**
 * A smaller JPEG copy of an image file: longest side 1600px, upright (the browser
 * applies the photo's rotation when it decodes it). Re-encoding drops the
 * original's location and camera data.
 */
export async function shrinkPhoto(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const w = img.naturalWidth
    const h = img.naturalHeight
    if (!w || !h) throw new Error('unreadable')
    const scale = Math.min(1, MAX_SIDE / Math.max(w, h))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w * scale)
    canvas.height = Math.round(h * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no canvas')
    ctx.fillStyle = '#ffffff' // transparent PNG areas would otherwise turn black
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    for (const q of [QUALITY, 0.7, 0.55]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', q))
      if (!blob) throw new Error('encode failed')
      if (blob.size <= MAX_BYTES) return blob
    }
    throw new Error('too large')
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function uploadPhoto(householdId: string, userId: string, blob: Blob) {
  const path = `${householdId}/${crypto.randomUUID()}.jpg`
  const { error } = await bucket().upload(path, blob, {
    contentType: 'image/jpeg',
    cacheControl: '3600',
    upsert: false,
    metadata: { uploader: userId },
  })
  if (error) throw new Error(error.message)
  return path
}

/** Deletes a photo. Returns false when the database didn't allow it. */
export async function deletePhoto(path: string): Promise<boolean> {
  const { data, error } = await bucket().remove([path])
  if (error) return false
  // A delete the policy refuses removes nothing and reports no error.
  return (data ?? []).length > 0
}

/** "about 8 MB" */
export function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `about ${Math.max(1, Math.round(bytes / 1024))} KB`
  const mb = bytes / (1024 * 1024)
  return `about ${mb < 10 ? Math.round(mb * 10) / 10 : Math.round(mb)} MB`
}

/** Fisher-Yates shuffle into a new array. */
export function shuffle<T>(items: T[]): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
