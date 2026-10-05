// Fry's (Kroger) products through the kroger-search Edge Function, which holds the
// Kroger credentials. Kroger's terms forbid keeping copies of their catalog, so
// results and pictures live only in React state while a screen is open: never
// write them to localStorage, IndexedDB or the database. The only Kroger data
// WallHub saves is what a person picks for their list: name, brand, size and
// product ID.

import { supabase } from './supabase'

export type KrogerProduct = {
  productId: string
  upc: string | null
  brand: string | null
  name: string
  size: string | null
  imageThumb: string | null
  imageMedium: string | null
  imageLarge: string | null
}

export const MIN_QUERY = 2
export const MAX_QUERY = 80
const MAX_IDS = 40

async function call(params: URLSearchParams, signal?: AbortSignal): Promise<{ items: KrogerProduct[]; total: number }> {
  const { data, error } = await supabase.functions.invoke(`kroger-search?${params}`, { method: 'GET', signal })
  if (error) throw error
  if (!data || !Array.isArray(data.items)) throw new Error('Unexpected response from Fry\'s search')
  return data
}

/** One page (12) of search results for `query`, starting at `start`. */
export function searchProducts(query: string, start = 0, signal?: AbortSignal) {
  const params = new URLSearchParams({ q: query.trim().slice(0, MAX_QUERY) })
  if (start > 0) params.set('start', String(start))
  return call(params, signal)
}

/** Current details for saved products, by product ID. Missing IDs are simply absent. */
export async function fetchProducts(ids: string[], signal?: AbortSignal): Promise<Map<string, KrogerProduct>> {
  const unique = [...new Set(ids.filter((id) => /^\d{8,14}$/.test(id)))]
  const found = new Map<string, KrogerProduct>()
  for (let i = 0; i < unique.length; i += MAX_IDS) {
    const params = new URLSearchParams({ productIds: unique.slice(i, i + MAX_IDS).join(',') })
    const { items } = await call(params, signal)
    for (const p of items) found.set(p.productId, p)
  }
  return found
}

/** "Jif Extra Crunchy Peanut Butter" with brand "Jif" doesn't need the brand twice. */
export function brandIsInName(brand: string | null, name: string) {
  return !brand || name.toLowerCase().includes(brand.toLowerCase())
}
