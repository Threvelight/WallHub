export type Household = {
  id: string
  name: string
  invite_code: string
  created_at: string
}

export type Member = {
  id: string
  household_id: string
  display_name: string
  role: 'owner' | 'member'
  created_at: string
}

export type GroceryList = {
  id: string
  household_id: string
  name: string
  status: 'active' | 'completed'
  created_at: string
  completed_at: string | null
}

export type GroceryItem = {
  id: string
  household_id: string
  list_id: string
  name: string
  quantity: string | null
  notes: string | null
  category: string | null
  category_id: string | null
  checked: boolean
  checked_at: string | null
  checked_by: string | null
  recipe_id: string | null
  added_by: string | null
  created_at: string
  /** Set when the item was picked from Fry's search. */
  kroger_product_id: string | null
  brand: string | null
  size: string | null
}

export type Recipe = {
  id: string
  household_id: string
  name: string
  description: string | null
  servings: number | null
  instructions: string | null
  created_at: string
  updated_at: string
}

export type RecipeIngredient = {
  id: string
  household_id: string
  recipe_id: string
  name: string
  quantity: string | null
  notes: string | null
  position: number
}

export type Favorite = {
  id: string
  household_id: string
  name: string
  quantity: string | null
  notes: string | null
  category: string | null
  created_at: string
  /** Set when the favorite is a Fry's product; its picture is fetched live. */
  kroger_product_id: string | null
  brand: string | null
  size: string | null
}

export type HistoryItem = {
  name: string
  quantity: string | null
  notes: string | null
  category: string | null
  checked: boolean
  /** Fry's product fields; absent in snapshots taken before Fry's search. */
  kroger_product_id?: string | null
  brand?: string | null
  size?: string | null
}

export type ListHistory = {
  id: string
  household_id: string
  list_id: string | null
  name: string
  items: HistoryItem[]
  item_count: number
  created_at: string
}

export type Category = {
  id: string
  household_id: string
  name: string
  is_custom: boolean
  sort_order: number
  created_at: string
}

export type CalendarEvent = {
  id: string
  household_id: string
  title: string
  description: string | null
  /** YYYY-MM-DD */
  date: string
  /** HH:MM:SS, or null for an all-day event */
  time: string | null
  event_type: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

/** The household's one shared note on the Today screen. */
export type FamilyNote = {
  household_id: string
  body: string
  updated_by: string | null
  updated_at: string
}
