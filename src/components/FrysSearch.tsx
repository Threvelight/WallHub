import { useEffect, useRef, useState } from 'react'
import { MAX_QUERY, MIN_QUERY, searchProducts, type KrogerProduct } from '../lib/kroger'
import ProductImage from './ProductImage'

const DEBOUNCE_MS = 350

type Results = { query: string; items: KrogerProduct[]; total: number }

/**
 * Search-as-you-type over Fry's products. Results stay in this component's state
 * only (see lib/kroger.ts). Tapping one calls onAdd; a product already on the
 * list shows as such.
 */
export default function FrysSearch({
  onAdd,
  isOnList,
}: {
  onAdd: (p: KrogerProduct) => Promise<void>
  isOnList: (productId: string) => boolean
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Results | null>(null)
  const [searching, setSearching] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
  const request = useRef<AbortController | null>(null)

  const q = query.trim()

  useEffect(() => {
    request.current?.abort()
    if (q.length < MIN_QUERY) {
      setResults(null)
      setSearching(false)
      setUnavailable(false)
      return
    }
    const controller = new AbortController()
    request.current = controller
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const page = await searchProducts(q, 0, controller.signal)
        if (controller.signal.aborted) return
        setResults({ query: q, ...page })
        setUnavailable(false)
      } catch {
        if (controller.signal.aborted) return
        setResults(null)
        setUnavailable(true)
      } finally {
        if (!controller.signal.aborted) setSearching(false)
      }
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [q])

  // Abandon any request in flight when the screen closes.
  useEffect(() => () => request.current?.abort(), [])

  async function loadMore() {
    if (!results) return
    const controller = new AbortController()
    request.current = controller
    setSearching(true)
    try {
      const page = await searchProducts(results.query, results.items.length, controller.signal)
      if (controller.signal.aborted) return
      const seen = new Set(results.items.map((p) => p.productId))
      setResults({ ...results, total: page.total, items: [...results.items, ...page.items.filter((p) => !seen.has(p.productId))] })
    } catch {
      if (!controller.signal.aborted) setUnavailable(true)
    } finally {
      if (!controller.signal.aborted) setSearching(false)
    }
  }

  async function add(p: KrogerProduct) {
    setAdding(p.productId)
    try {
      await onAdd(p)
    } finally {
      setAdding(null)
    }
  }

  const shown = results?.query === q ? results : null

  return (
    <section className="frys" aria-label="Search Fry's">
      <div className="frys-box">
        <span className="frys-icon" aria-hidden>
          🔍
        </span>
        <input
          type="search"
          className="grow"
          placeholder="Search Fry's…"
          aria-label="Search Fry's"
          enterKeyHint="search"
          autoComplete="off"
          maxLength={MAX_QUERY}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
        />
        {query && (
          <button type="button" className="icon" aria-label="Clear Fry's search" onClick={() => setQuery('')}>
            ×
          </button>
        )}
      </div>

      {unavailable && <p className="frys-status muted small">Fry's search isn't available right now. You can still type items above.</p>}
      {!unavailable && searching && !shown && <p className="frys-status muted small">Searching Fry's…</p>}
      {!unavailable && shown && !shown.items.length && <p className="frys-status muted small">No Fry's products match “{shown.query}”.</p>}

      {shown && shown.items.length > 0 && (
        <ul className="frys-results" aria-label="Fry's results">
          {shown.items.map((p) => {
            const onList = isOnList(p.productId)
            return (
              <li key={p.productId}>
                <button
                  type="button"
                  className="frys-result"
                  disabled={onList || adding === p.productId}
                  onClick={() => add(p)}
                  aria-label={`Add ${[p.brand, p.name, p.size].filter(Boolean).join(', ')}`}
                >
                  <ProductImage src={p.imageThumb} />
                  <span className="frys-text">
                    {p.brand && <strong className="frys-brand">{p.brand}</strong>}
                    <span className="frys-name">{p.name}</span>
                    {p.size && <span className="frys-size">{p.size}</span>}
                  </span>
                  <span className="frys-add" aria-hidden>
                    {onList ? '✓ On list' : adding === p.productId ? '…' : '+'}
                  </span>
                </button>
              </li>
            )
          })}
          {shown.total > shown.items.length && (
            <li>
              <button type="button" className="link small frys-more" disabled={searching} onClick={loadMore}>
                {searching ? 'Loading…' : 'Show more results'}
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  )
}
