import { useMemo, useRef, useState, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'
import {
  byCategoryName,
  defaultCategoryId,
  getActiveList,
  getCategories,
  getCategoryMemory,
  getFavorites,
  getHistory,
  getItems,
  getMembers,
  must,
  rpcCount,
} from '../lib/data'
import { normalize, useLiveQuery } from '../lib/live'
import { errorMessage, supabase } from '../lib/supabase'
import type { GroceryItem, GroceryList } from '../lib/types'
import ItemEditor, { CategorySelect } from '../components/ItemEditor'
import { toast } from '../components/Toast'

type ListState = { list: GroceryList | null; items: GroceryItem[] }

export default function ListPage() {
  const { household, member } = useAuth()
  const hid = household?.id

  const { data, setData, loading, error, reload } = useLiveQuery<ListState>(
    'list',
    hid,
    ['grocery_items', 'grocery_lists'],
    async () => {
      const list = await getActiveList()
      return { list, items: await getItems(list.id) }
    },
    { list: null, items: [] },
  )
  const { data: favorites } = useLiveQuery('list-favs', hid, ['favorites'], getFavorites, [])
  const { data: history } = useLiveQuery('list-history', hid, ['list_history'], getHistory, [])
  const { data: members } = useLiveQuery('list-members', hid, ['users'], getMembers, [])
  const { data: categories } = useLiveQuery('list-categories', hid, ['categories'], getCategories, [])
  const { data: categoryMemory } = useLiveQuery('list-category-memory', hid, ['grocery_items'], getCategoryMemory, new Map<string, string>())

  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('')
  // Category for the next item: follows what this item was filed under last time,
  // until the user picks one themselves.
  const [pickedCategory, setPickedCategory] = useState<string | null>(null)
  const [editing, setEditing] = useState<GroceryItem | null>(null)
  const [busy, setBusy] = useState(false)
  const nameInput = useRef<HTMLInputElement>(null)

  const memberName = useMemo(() => new Map(members.map((m) => [m.id, m.display_name])), [members])
  const favoriteNames = useMemo(() => new Set(favorites.map((f) => normalize(f.name))), [favorites])
  const suggestions = useMemo(() => {
    const names = new Map<string, string>()
    for (const f of favorites) names.set(normalize(f.name), f.name)
    for (const h of history) for (const i of h.items) if (!names.has(normalize(i.name))) names.set(normalize(i.name), i.name)
    return [...names.values()].sort((a, b) => a.localeCompare(b))
  }, [favorites, history])

  const fallbackCategory = defaultCategoryId(categories)
  const rememberedCategory = categoryMemory.get(normalize(name))
  const newItemCategory =
    pickedCategory ?? (rememberedCategory && categories.some((c) => c.id === rememberedCategory) ? rememberedCategory : fallbackCategory)

  const toBuy = data.items.filter((i) => !i.checked)
  const groups = useMemo(() => {
    const byId = new Map(categories.map((c) => [c.id, c]))
    const map = new Map<string, { name: string; items: GroceryItem[] }>()
    for (const item of toBuy) {
      // Items whose category was removed show under Other.
      const groupName = (item.category_id && byId.get(item.category_id)?.name) || 'Other'
      const key = groupName.toLowerCase()
      if (!map.has(key)) map.set(key, { name: groupName, items: [] })
      map.get(key)!.items.push(item)
    }
    return [...map.values()].sort(byCategoryName)
  }, [toBuy, categories])
  const inCart = data.items.filter((i) => i.checked)

  function patchItem(id: string, patch: Partial<GroceryItem>) {
    setData((d) => ({ ...d, items: d.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }))
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toast(errorMessage(e))
      void reload()
    } finally {
      setBusy(false)
    }
  }

  async function addItem(e: FormEvent) {
    e.preventDefault()
    const n = name.trim()
    if (!n || !data.list || !hid) return
    const existing = toBuy.find((i) => normalize(i.name) === normalize(n))
    if (existing) {
      toast(`${existing.name} is already on the list`)
      setName('')
      return
    }
    // Pre-fill quantity from a favorite with the same name when none was typed.
    const fav = favorites.find((f) => normalize(f.name) === normalize(n))
    const row = {
      household_id: hid,
      list_id: data.list.id,
      name: n,
      quantity: quantity.trim() || fav?.quantity || null,
      notes: fav?.notes ?? null,
      category: fav?.category ?? null,
      category_id: newItemCategory || null,
      added_by: member?.id ?? null,
    }
    setName('')
    setQuantity('')
    setPickedCategory(null)
    nameInput.current?.focus()
    await run(async () => {
      const inserted = must(await supabase.from('grocery_items').insert(row).select().single()) as GroceryItem
      setData((d) => (d.items.some((i) => i.id === inserted.id) ? d : { ...d, items: [...d.items, inserted] }))
    })
  }

  async function toggle(item: GroceryItem) {
    const checked = !item.checked
    const patch = { checked, checked_at: checked ? new Date().toISOString() : null, checked_by: checked ? member?.id ?? null : null }
    patchItem(item.id, patch)
    await run(async () => {
      must(await supabase.from('grocery_items').update(patch).eq('id', item.id).select())
    })
  }

  async function remove(item: GroceryItem) {
    setData((d) => ({ ...d, items: d.items.filter((i) => i.id !== item.id) }))
    await run(async () => {
      must(await supabase.from('grocery_items').delete().eq('id', item.id).select())
    })
  }

  async function toggleFavorite(item: GroceryItem) {
    if (!hid) return
    const fav = favorites.find((f) => normalize(f.name) === normalize(item.name))
    await run(async () => {
      if (fav) {
        must(await supabase.from('favorites').delete().eq('id', fav.id).select())
        toast(`Removed ${item.name} from favorites`)
      } else {
        must(
          await supabase
            .from('favorites')
            .insert({ household_id: hid, name: item.name, quantity: item.quantity, notes: null, category: item.category, created_by: member?.id })
            .select(),
        )
        toast(`⭐ ${item.name} saved to favorites`)
      }
    })
  }

  async function finishTrip() {
    if (!data.items.length) return
    const carry = toBuy.length
    const msg =
      `Finalize list? This saves the list to history and starts a fresh list.` +
      (carry ? ` ${carry} unchecked item${carry === 1 ? '' : 's'} will carry over.` : '')
    if (!confirm(msg)) return
    await run(async () => {
      must(await supabase.rpc('finish_list'))
      await reload()
      toast('List finalized. Fresh list started.')
    })
  }

  async function loadLastWeek() {
    await run(async () => {
      const added = await rpcCount('load_history')
      await reload()
      toast(added ? `Added ${added} item${added === 1 ? '' : 's'} from last week` : 'Everything from last week is already on the list')
    })
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Grocery list</h1>
          <p className="muted small">
            {toBuy.length} to buy{inCart.length ? ` · ${inCart.length} in cart` : ''}
          </p>
        </div>
        <div className="row wrap">
          <button onClick={loadLastWeek} disabled={busy || !history.length} title={history.length ? history[0].name : 'No past lists yet'}>
            ↺ Load last week
          </button>
        </div>
      </header>

      <form className="add-bar" onSubmit={addItem}>
        <input
          ref={nameInput}
          className="grow"
          placeholder="Add an item…"
          list="item-suggestions"
          enterKeyHint="done"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input className="qty" placeholder="Qty" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        <div className="add-bar-row">
          <CategorySelect className="grow" categories={categories} value={newItemCategory} onChange={setPickedCategory} />
          <button className="primary" disabled={!name.trim()}>
            Add
          </button>
        </div>
        <datalist id="item-suggestions">
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </form>

      {error && <p className="error">{error}</p>}
      {loading && !data.list && <p className="muted">Loading…</p>}

      {!loading && !data.items.length && (
        <div className="empty">
          <p>The list is empty.</p>
          <p className="muted small">
            Type above, load last week's list, or add from Favorites and Recipes.
          </p>
        </div>
      )}

      {groups.map((group) => (
        <section key={group.name} className="category-group">
          <h2 className="category-head">{group.name}</h2>
          <ul className="items">
            {group.items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                by={item.added_by ? memberName.get(item.added_by) : undefined}
                isFavorite={favoriteNames.has(normalize(item.name))}
                onToggle={() => toggle(item)}
                onEdit={() => setEditing(item)}
                onFavorite={() => toggleFavorite(item)}
              />
            ))}
          </ul>
        </section>
      ))}

      {inCart.length > 0 && (
        <>
          <div className="section-head">
            <h2>In the cart</h2>
          </div>
          <ul className="items done">
            {inCart.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                by={item.checked_by ? memberName.get(item.checked_by) : undefined}
                isFavorite={favoriteNames.has(normalize(item.name))}
                onToggle={() => toggle(item)}
                onEdit={() => setEditing(item)}
                onFavorite={() => toggleFavorite(item)}
              />
            ))}
          </ul>
        </>
      )}

      {data.items.length > 0 && (
        <div className="finish">
          <button className="primary wide" onClick={finishTrip} disabled={busy}>
            ✓ Finalize list
          </button>
          <p className="muted small">Saves this week's list so you can load it next week.</p>
        </div>
      )}

      {editing && (
        <ItemEditor
          title="Edit item"
          initial={{
            name: editing.name,
            quantity: editing.quantity ?? '',
            notes: editing.notes ?? '',
            categoryId: editing.category_id ?? defaultCategoryId(categories.filter((c) => c.name === 'Other')),
          }}
          categories={categories}
          onClose={() => setEditing(null)}
          onDelete={() => remove(editing)}
          onSave={async (f) => {
            const patch = { name: f.name, quantity: f.quantity || null, notes: f.notes || null, category_id: f.categoryId || null }
            patchItem(editing.id, patch)
            await run(async () => {
              must(await supabase.from('grocery_items').update(patch).eq('id', editing.id).select())
            })
          }}
        />
      )}
    </div>
  )
}

function ItemRow({
  item,
  by,
  isFavorite,
  onToggle,
  onEdit,
  onFavorite,
}: {
  item: GroceryItem
  by?: string
  isFavorite: boolean
  onToggle: () => void
  onEdit: () => void
  onFavorite: () => void
}) {
  return (
    <li className={`item ${item.checked ? 'checked' : ''}`}>
      <button className="check" onClick={onToggle} aria-label={item.checked ? `Uncheck ${item.name}` : `Check off ${item.name}`}>
        {item.checked ? '✓' : ''}
      </button>
      <button className="item-body" onClick={onEdit}>
        <span className="item-name">
          {item.name}
          {item.quantity && <span className="qty-pill">{item.quantity}</span>}
        </span>
        {(item.notes || by) && (
          <span className="item-meta">
            {item.notes}
            {item.notes && by ? ' · ' : ''}
            {by && <span className="by">{by}</span>}
          </span>
        )}
      </button>
      <button className={`star ${isFavorite ? 'on' : ''}`} onClick={onFavorite} aria-label={isFavorite ? 'Remove from favorites' : 'Save as favorite'}>
        {isFavorite ? '★' : '☆'}
      </button>
    </li>
  )
}
