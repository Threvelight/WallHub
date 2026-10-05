import { useEffect, useRef, useState } from 'react'
import { fetchProducts } from './kroger'

/**
 * Live pictures for saved Fry's products, fetched in one batched call per change
 * of the product set and kept only in this screen's state (Kroger's terms). A
 * product Fry's no longer has maps to null; if the call fails nothing is
 * recorded, so those items stay plain text and are retried when the list changes.
 */
export function useProductPictures(productIds: string[]) {
  const [pictures, setPictures] = useState<Map<string, string | null>>(() => new Map())
  const known = useRef(pictures)
  known.current = pictures
  const key = [...new Set(productIds)].sort().join(',')

  useEffect(() => {
    const missing = key ? key.split(',').filter((id) => !known.current.has(id)) : []
    if (!missing.length) return
    const controller = new AbortController()
    fetchProducts(missing, controller.signal)
      .then((found) => {
        if (controller.signal.aborted) return
        setPictures((prev) => {
          const next = new Map(prev)
          for (const id of missing) {
            const p = found.get(id)
            next.set(id, p?.imageThumb ?? p?.imageMedium ?? p?.imageLarge ?? null)
          }
          return next
        })
      })
      .catch(() => {})
    return () => controller.abort()
  }, [key])

  return pictures
}
