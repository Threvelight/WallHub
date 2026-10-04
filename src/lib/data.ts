import { supabase } from './supabase'
import type { Favorite, GroceryItem, GroceryList, ListHistory, Member, Recipe, RecipeIngredient } from './types'

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

export async function rpcCount(fn: string, args?: Record<string, unknown>): Promise<number> {
  return must(await supabase.rpc(fn, args)) as number
}

export { must }
