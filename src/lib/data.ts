import { supabase } from './supabase'
import type { Category, Favorite, GroceryItem, GroceryList, ListHistory, Member, Recipe, RecipeIngredient } from './types'

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data as T
}

export async function getActiveList(): Promise<GroceryList> {
  return must(await supabase.rpc('ensure_active_list')) as GroceryList
}

export async function getItems(listId: string): Promise<GroceryItem[]> {
  return must(
    await supabase.from('grocery_items').select('*').eq('list_id', listId).order('created_at', { ascending: true }),
  )
}

export async function getFavorites(): Promise<Favorite[]> {
  return must(await supabase.from('favorites').select('*').order('name'))
}

export async function getRecipes(): Promise<(Recipe & { recipe_ingredients: RecipeIngredient[] })[]> {
  return must(
    await supabase
      .from('recipes')
      .select('*, recipe_ingredients(*)')
      .order('name')
      .order('position', { referencedTable: 'recipe_ingredients' }),
  )
}

export async function getHistory(): Promise<ListHistory[]> {
  return must(await supabase.from('list_history').select('*').order('created_at', { ascending: false }).limit(12))
}

export async function getMembers(): Promise<Member[]> {
  return must(await supabase.from('users').select('*').order('created_at'))
}

export async function getCategories(): Promise<Category[]> {
  const rows: Category[] = must(await supabase.from('categories').select('*'))
  return rows.sort(byCategoryName)
}

/** Alphabetical, case-insensitive: the order categories appear everywhere. */
export function byCategoryName(a: { name: string }, b: { name: string }) {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}

/** Most recent category used for each item name, so "Milk" defaults to Dairy next time. */
export async function getCategoryMemory(): Promise<Map<string, string>> {
  const rows: { name: string; category_id: string }[] = must(
    await supabase
      .from('grocery_items')
      .select('name, category_id')
      .not('category_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1000),
  )
  const memory = new Map<string, string>()
  for (const r of rows) {
    const key = r.name.trim().toLowerCase()
    if (!memory.has(key)) memory.set(key, r.category_id)
  }
  return memory
}

/** Category a new item starts in: Produce when present, otherwise the first one. */
export function defaultCategoryId(categories: Category[]): string {
  return (categories.find((c) => c.name === 'Produce' && !c.is_custom) ?? categories[0])?.id ?? ''
}

export async function rpcCount(fn: string, args?: Record<string, unknown>): Promise<number> {
  return must(await supabase.rpc(fn, args)) as number
}

export { must }
