// Household backup: a JSON file people download from Settings and can import
// back. Import only adds what's missing; it never changes or deletes data.
// The weekly email (supabase/functions/weekly-backup) sends single lists in the
// same list shape, and Import accepts those files too.

import { supabase } from './supabase'
import type { HistoryItem } from './types'

export const BACKUP_FORMAT = 'wallhub-backup'
export const LIST_FORMAT = 'wallhub-list'
export const BACKUP_VERSION = 1

export type BackupList = {
  name: string
  finalized_at: string
  item_count: number
  items: HistoryItem[]
}

export type BackupRecipe = {
  name: string
  description: string | null
  servings: number | null
  instructions: string | null
  ingredients: { name: string; quantity: string | null; notes: string | null }[]
}

export type Backup = {
  format: typeof BACKUP_FORMAT
  version: number
  exported_at: string
  household: { name: string }
  lists: BackupList[]
  current_list: { items: HistoryItem[] }
  favorites: { name: string; quantity: string | null; notes: string | null }[]
  recipes: BackupRecipe[]
  categories: { name: string; is_custom: boolean }[]
}

/** A single finalized list, as attached to the weekly backup email. */
export type ListFile = {
  format: typeof LIST_FORMAT
  version: number
  household: { name: string }
  list: BackupList
}

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data as T
}

/** YYYY-MM-DD in the device's time zone. */
export function localDate(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const key = (s: string) => s.trim().toLowerCase()
const listKey = (l: { name: string; finalized_at: string }) => `${key(l.name)}|${new Date(l.finalized_at).toISOString()}`

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export async function buildBackup(householdName: string): Promise<Backup> {
  const [history, list, favorites, recipes, categories] = await Promise.all([
    supabase.from('list_history').select('name, items, item_count, created_at').order('created_at'),
    supabase.from('grocery_lists').select('id').eq('status', 'active').maybeSingle(),
    supabase.from('favorites').select('name, quantity, notes').order('name'),
    supabase
      .from('recipes')
      .select('name, description, servings, instructions, recipe_ingredients(name, quantity, notes, position)')
      .order('name')
      .order('position', { referencedTable: 'recipe_ingredients' }),
    supabase.from('categories').select('id, name, is_custom').order('name'),
  ])
  const cats = must(categories) as { id: string; name: string; is_custom: boolean }[]
  const catName = new Map(cats.map((c) => [c.id, c.name]))

  const active = must(list) as { id: string } | null
  const current = active
    ? (must(
        await supabase
          .from('grocery_items')
          .select('name, quantity, notes, category_id, checked')
          .eq('list_id', active.id)
          .order('created_at'),
      ) as { name: string; quantity: string | null; notes: string | null; category_id: string | null; checked: boolean }[])
    : []

  type HistoryRow = { name: string; items: HistoryItem[]; item_count: number; created_at: string }
  type RecipeRow = Omit<BackupRecipe, 'ingredients'> & { recipe_ingredients: BackupRecipe['ingredients'] }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exported_at: new Date().toISOString(),
    household: { name: householdName },
    lists: (must(history) as HistoryRow[]).map((h) => ({
      name: h.name,
      finalized_at: h.created_at,
      item_count: h.item_count,
      items: h.items,
    })),
    current_list: {
      items: current.map((i) => ({
        name: i.name,
        quantity: i.quantity,
        notes: i.notes,
        category: (i.category_id && catName.get(i.category_id)) || null,
        checked: i.checked,
      })),
    },
    favorites: must(favorites) as Backup['favorites'],
    recipes: (must(recipes) as RecipeRow[]).map(({ recipe_ingredients, ...r }) => ({
      ...r,
      ingredients: recipe_ingredients.map(({ name, quantity, notes }) => ({ name, quantity, notes })),
    })),
    categories: cats.map(({ name, is_custom }) => ({ name, is_custom })),
  }
}

export function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

function readItems(v: unknown): HistoryItem[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((i) => i && str(i.name))
    .map((i) => ({
      name: str(i.name)!,
      quantity: str(i.quantity),
      notes: str(i.notes),
      category: str(i.category),
      checked: !!i.checked,
      // Fry's items keep the exact product (lists from before Fry's search have none).
      ...(str(i.kroger_product_id) ? { kroger_product_id: str(i.kroger_product_id), brand: str(i.brand), size: str(i.size) } : {}),
    }))
}

function readList(v: unknown): BackupList | null {
  const l = v as Record<string, unknown> | null
  const name = str(l?.name)
  const at = str(l?.finalized_at)
  if (!name || !at || isNaN(Date.parse(at))) return null
  const items = readItems(l!.items)
  return { name, finalized_at: new Date(at).toISOString(), item_count: items.length, items }
}

/** Reads a backup or single-list file. Throws a readable error for anything else. */
export function parseBackupFile(text: string): Omit<Backup, 'current_list' | 'exported_at'> & { exported_at: string | null } {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error("That file isn't valid JSON.")
  }
  const household = { name: str((raw?.household as { name?: unknown })?.name) ?? '' }
  if (raw?.format === LIST_FORMAT) {
    const list = readList(raw.list)
    if (!list) throw new Error('That list file is missing its name or date.')
    return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exported_at: null, household, lists: [list], favorites: [], recipes: [], categories: [] }
  }
  if (raw?.format !== BACKUP_FORMAT) throw new Error("That doesn't look like a WallHub backup file.")
  if (typeof raw.version !== 'number' || raw.version > BACKUP_VERSION)
    throw new Error('That backup was made by a newer version of WallHub.')

  const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : [])
  return {
    format: BACKUP_FORMAT,
    version: raw.version,
    exported_at: str(raw.exported_at),
    household,
    lists: arr(raw.lists).map(readList).filter((l): l is BackupList => !!l),
    favorites: arr(raw.favorites)
      .filter((f) => str(f.name))
      .map((f) => ({ name: str(f.name)!, quantity: str(f.quantity), notes: str(f.notes) })),
    recipes: arr(raw.recipes)
      .filter((r) => str(r.name))
      .map((r) => ({
        name: str(r.name)!,
        description: str(r.description),
        servings: typeof r.servings === 'number' && r.servings > 0 ? Math.round(r.servings) : null,
        instructions: str(r.instructions),
        ingredients: arr(r.ingredients)
          .filter((i) => str(i.name))
          .map((i) => ({ name: str(i.name)!, quantity: str(i.quantity), notes: str(i.notes) })),
      })),
    categories: arr(raw.categories)
      .filter((c) => str(c.name))
      .map((c) => ({ name: str(c.name)!, is_custom: !!c.is_custom })),
  }
}

export type ImportPlan = {
  lists: BackupList[]
  favorites: Backup['favorites']
  recipes: BackupRecipe[]
  categories: string[]
  skipped: { lists: number; favorites: number; recipes: number }
}

/** What an import would add, given what the household already has. Pure, for testing. */
export function planImport(
  file: ReturnType<typeof parseBackupFile>,
  existing: { lists: { name: string; finalized_at: string }[]; favorites: string[]; recipes: string[]; categories: string[] },
  canAddCategories: boolean,
): ImportPlan {
  const have = {
    lists: new Set(existing.lists.map(listKey)),
    favorites: new Set(existing.favorites.map(key)),
    recipes: new Set(existing.recipes.map(key)),
    categories: new Set(existing.categories.map(key)),
  }
  // Also dedupe within the file itself.
  const take = <T>(rows: T[], id: (r: T) => string, seen: Set<string>) =>
    rows.filter((r) => {
      const k = id(r)
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
  const lists = take(file.lists, listKey, have.lists)
  const favorites = take(file.favorites, (f) => key(f.name), have.favorites)
  const recipes = take(file.recipes, (r) => key(r.name), have.recipes)
  const categories = canAddCategories
    ? take(file.categories.filter((c) => c.is_custom), (c) => key(c.name), have.categories).map((c) => c.name)
    : []
  return {
    lists,
    favorites,
    recipes,
    categories,
    skipped: {
      lists: file.lists.length - lists.length,
      favorites: file.favorites.length - favorites.length,
      recipes: file.recipes.length - recipes.length,
    },
  }
}

export async function loadExisting() {
  const [lists, favorites, recipes, categories] = await Promise.all([
    supabase.from('list_history').select('name, created_at'),
    supabase.from('favorites').select('name'),
    supabase.from('recipes').select('name'),
    supabase.from('categories').select('name'),
  ])
  return {
    lists: (must(lists) as { name: string; created_at: string }[]).map((l) => ({ name: l.name, finalized_at: l.created_at })),
    favorites: (must(favorites) as { name: string }[]).map((f) => f.name),
    recipes: (must(recipes) as { name: string }[]).map((r) => r.name),
    categories: (must(categories) as { name: string }[]).map((c) => c.name),
  }
}

export async function applyImport(plan: ImportPlan, householdId: string, memberId: string | null) {
  if (plan.categories.length) {
    must(
      await supabase
        .from('categories')
        .insert(plan.categories.map((name) => ({ household_id: householdId, name, is_custom: true })))
        .select('id'),
    )
  }
  if (plan.lists.length) {
    must(
      await supabase
        .from('list_history')
        .insert(
          plan.lists.map((l) => ({
            household_id: householdId,
            name: l.name,
            items: l.items,
            item_count: l.items.length,
            created_at: l.finalized_at,
            created_by: memberId,
          })),
        )
        .select('id'),
    )
  }
  if (plan.favorites.length) {
    must(
      await supabase
        .from('favorites')
        .insert(plan.favorites.map((f) => ({ ...f, household_id: householdId, created_by: memberId })))
        .select('id'),
    )
  }
  for (const r of plan.recipes) {
    const { ingredients, ...recipe } = r
    const row = must(
      await supabase.from('recipes').insert({ ...recipe, household_id: householdId, created_by: memberId }).select('id').single(),
    ) as { id: string }
    if (ingredients.length) {
      must(
        await supabase
          .from('recipe_ingredients')
          .insert(ingredients.map((i, position) => ({ ...i, position, recipe_id: row.id, household_id: householdId })))
          .select('id'),
      )
    }
  }
}

export function describePlan(plan: ImportPlan) {
  const n = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`
  const adds = [
    plan.lists.length && n(plan.lists.length, 'list'),
    plan.favorites.length && n(plan.favorites.length, 'favorite'),
    plan.recipes.length && n(plan.recipes.length, 'recipe'),
    plan.categories.length && n(plan.categories.length, 'category').replace('categorys', 'categories'),
  ].filter(Boolean)
  const skipped = plan.skipped.lists + plan.skipped.favorites + plan.skipped.recipes
  return { adds: adds.join(', '), skipped }
}
