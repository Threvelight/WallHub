import { useState } from 'react'

/** A Fry's product picture, or an empty tile when there is none or it fails to load (never a broken image). */
export default function ProductImage({ src, className = '' }: { src: string | null | undefined; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (!src || failed === src) return <span className={`product-img no-img ${className}`} aria-hidden />
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
