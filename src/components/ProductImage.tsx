import { useState } from 'react'

/**
 * A Fry's product picture. With no picture, or one that fails to load, it shows an
 * empty tile, or nothing at all when `hideMissing` is set. Never a broken image.
 */
export default function ProductImage({
  src,
  className = '',
  hideMissing = false,
}: {
  src: string | null | undefined
  className?: string
  hideMissing?: boolean
}) {
  const [failed, setFailed] = useState<string | null>(null)
  if (!src || failed === src) return hideMissing ? null : <span className={`product-img no-img ${className}`} aria-hidden />
  return (
    <img
      className={`product-img ${className}`}
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(src)}
    />
  )
}
