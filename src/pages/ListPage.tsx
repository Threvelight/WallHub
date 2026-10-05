import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type CollisionDetection,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
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
import { clearOrders, loadOrder, saveOrder } from '../lib/order'
import { errorMessage, supabase } from '../lib/supabase'
import type { GroceryItem, GroceryList } from '../lib/types'
import ItemEditor, { CategorySelect } from '../components/ItemEditor'
import { toast } from '../components/Toast'
import UpcomingEvents from '../components/UpcomingEvents'
import FrysSearch from '../components/FrysSearch'
import { brandIsInName, type KrogerProduct } from '../lib/kroger'
import { useProductPictures } from '../lib/useProductPictures'
import ProductImage from '../components/ProductImage'

type ListState = { list: GroceryList | null; items: GroceryItem[] }
/** One category section of the to-buy list, as item ids in display order. */
type Group = { id: string; name: string; ids: string[] }

const OTHER = 'other'
const groupDropId = (groupId: string) => `group:${groupId}`

// Whatever is under the finger wins (an item over its section); in the gaps
// between sections, the nearest target.
const collisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  if (hits.length) return [hits.find((h) => !String(h.id).startsWith('group:')) ?? hits[0]]
  return closestCorners(args)
}

export default function ListPage() {
  const { household, member, refresh } = useAuth()
  // Only the household owner finalizes the list (finish_list enforces it too).
  const isOwner = member?.role === 'owner'
  const OWNER_ONLY = 'Only the household owner can finalize the list'
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

  const toBuy = useMemo(() => data.items.filter((i) => !i.checked), [data.items])
  const itemById = useMemo(() => new Map(data.items.map((i) => [i.id, i])), [data.items])
  const pictures = useProductPictures(data.items.flatMap((i) => (i.kroger_product_id ? [i.kroger_product_id] : [])))
  const productIdsToBuy = useMemo(() => new Set(toBuy.flatMap((i) => (i.kroger_product_id ? [i.kroger_product_id] : []))), [toBuy])

  // Custom order for this list on this device (drag-and-drop); empty = alphabetical.
  const listId = data.list?.id
  const [order, setOrder] = useState<string[]>([])
  useEffect(() => {
    if (!listId) return
    clearOrders(listId)
    setOrder(loadOrder(listId))
  }, [listId])

  // Category sections, alphabetical. Within a section, dragged items keep their
  // custom position; the rest follow alphabetically.
  const groupIdOf = useMemo(() => {
    const ids = new Set(categories.map((c) => c.id))
    const otherId = categories.find((c) => c.name === 'Other' && !c.is_custom)?.id ?? OTHER
    // Items with no (or a removed) category show under Other.
    return (item: GroceryItem) => (item.category_id && ids.has(item.category_id) ? item.category_id : otherId)
  }, [categories])
  const allGroups: Group[] = useMemo(() => {
    const rank = new Map(order.map((id, i) => [id, i]))
    const sections = categories.length ? categories.map((c) => ({ id: c.id, name: c.name })) : [{ id: OTHER, name: 'Other' }]
    return sections
      .map((c) => {
        const items = toBuy.filter((i) => groupIdOf(i) === c.id)
        items.sort(
          (a, b) =>
            (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) ||
            a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
        )
        return { ...c, ids: items.map((i) => i.id) }
      })
      .sort(byCategoryName)
  }, [toBuy, categories, order, groupIdOf])

  // While dragging, empty categories also show (as drop targets at the end) and
  // the layout follows the pointer; it is committed on drop.
  const [dragLayout, setDragLayout] = useState<Group[] | null>(null)
  const dragLayoutRef = useRef<Group[] | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  function setLayout(next: Group[] | null) {
    dragLayoutRef.current = next
    setDragLayout(next)
  }
  const groups = (dragLayout ?? allGroups.filter((g) => g.ids.length))
    .map((g) => ({ ...g, ids: g.ids.filter((id) => itemById.has(id)) }))

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function findGroup(layout: Group[], id: UniqueIdentifier) {
    return layout.find((g) => groupDropId(g.id) === id || g.ids.includes(String(id)))
  }

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id))
    // Empty categories go after the others so nothing above the finger shifts.
    setLayout([...allGroups.filter((g) => g.ids.length), ...allGroups.filter((g) => !g.ids.length)])
  }

  function onDragOver({ active, over }: DragOverEvent) {
    const layout = dragLayoutRef.current
    if (!layout || !over) return
    const from = findGroup(layout, active.id)
    const to = findGroup(layout, over.id)
    if (!from || !to || from === to) return
    const id = String(active.id)
    const overIndex = to.ids.indexOf(String(over.id))
    const at = overIndex >= 0 ? overIndex : to.ids.length
    setLayout(
      layout.map((g) =>
        g === from ? { ...g, ids: g.ids.filter((x) => x !== id) } : g === to ? { ...g, ids: [...g.ids.slice(0, at), id, ...g.ids.slice(at)] } : g,
      ),
    )
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    let layout = dragLayoutRef.current
    setLayout(null)
    setActiveId(null)
    if (!layout || !over || !listId) return
    const id = String(active.id)
    const group = findGroup(layout, id)
    if (!group) return
    const from = group.ids.indexOf(id)
    const to = group.ids.indexOf(String(over.id))
    if (to >= 0 && to !== from) layout = layout.map((g) => (g === group ? { ...g, ids: arrayMove(g.ids, from, to) } : g))

    const next = layout.flatMap((g) => g.ids)
    setOrder(next)
    saveOrder(listId, next)

    // Moving into another category changes the item's category for everyone.
    const item = itemById.get(id)
    if (item && group.id !== OTHER && groupIdOf(item) !== group.id) {
      const patch = { category_id: group.id }
      patchItem(id, patch)
      void run(async () => {
        must(await supabase.from('grocery_items').update(patch).eq('id', id).select())
        toast(`Moved ${item.name} to ${group.name}`)
      })
    }
  }

  function onDragCancel() {
    setLayout(null)
    setActiveId(null)
  }
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

  /** Adds a Fry's search result. Saves only its name, brand, size and product ID. */
  async function addProduct(p: KrogerProduct) {
    if (!data.list || !hid) return
    const n = p.name.trim() || [p.brand, p.size].filter(Boolean).join(' ')
    if (productIdsToBuy.has(p.productId)) {
      toast(`${n} is already on the list`)
      return
    }
    // Filed where this name went last time, otherwise under Other.
    const remembered = categoryMemory.get(normalize(n))
    const other = categories.find((c) => c.name === 'Other' && !c.is_custom)?.id
    const categoryId = (remembered && categories.some((c) => c.id === remembered) ? remembered : other) ?? fallbackCategory
    const row = {
      household_id: hid,
      list_id: data.list.id,
      name: n,
      quantity: null,
      notes: null,
      category_id: categoryId || null,
      added_by: member?.id ?? null,
      kroger_product_id: p.productId,
      brand: p.brand?.trim() || null,
      size: p.size?.trim() || null,
    }
    await run(async () => {
      const inserted = must(await supabase.from('grocery_items').insert(row).select().single()) as GroceryItem
      setData((d) => (d.items.some((i) => i.id === inserted.id) ? d : { ...d, items: [...d.items, inserted] }))
      toast(`Added ${n}${row.size ? ` (${row.size})` : ''}`)
      // A favorite saved before it had a Fry's product picks this one up.
      const fav = favorites.find((f) => !f.kroger_product_id && normalize(f.name) === normalize(n))
      if (fav) {
        await supabase
          .from('favorites')
          .update({ kroger_product_id: row.kroger_product_id, brand: row.brand, size: row.size })
          .eq('id', fav.id)
          .is('kroger_product_id', null)
      }
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
            .insert({
              household_id: hid,
              name: item.name,
              quantity: item.quantity,
              notes: null,
              category: item.category,
              created_by: member?.id,
              kroger_product_id: item.kroger_product_id,
              brand: item.brand,
              size: item.size,
            })
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
    setBusy(true)
    try {
      must(await supabase.rpc('finish_list'))
      clearOrders()
      setOrder([])
      await reload()
      toast('List finalized. Fresh list started.')
    } catch (e) {
      if (errorMessage(e).includes(OWNER_ONLY)) {
        // Their role changed while the page was open: say so, leave the list as
        // it is, and pick up the new role (which hides the button).
        toast(OWNER_ONLY)
        void refresh()
      } else {
        toast(errorMessage(e))
        void reload()
      }
    } finally {
      setBusy(false)
    }
  }

  async function loadLastWeek() {
    await run(async () => {
      const added = await rpcCount('load_history')
      // Loading a list resets any custom order back to alphabetical.
      clearOrders()
      setOrder([])
      await reload()
      toast(added ? `Added ${added} item${added === 1 ? '' : 's'} from last week` : 'Everything from last week is already on the list')
    })
  }

  return (
    <div className="page">
      <UpcomingEvents />
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

      <FrysSearch onAdd={addProduct} isOnList={(id) => productIdsToBuy.has(id)} />

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

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        {groups.map((group) => (
          <CategorySection key={group.id} group={group} dragging={!!activeId}>
            <SortableContext items={group.ids} strategy={verticalListSortingStrategy}>
              {group.ids.map((id) => {
                const item = itemById.get(id)!
                return (
                  <SortableItemRow
                    key={id}
                    item={item}
                    picture={item.kroger_product_id ? pictures.get(item.kroger_product_id) : null}
                    by={item.added_by ? memberName.get(item.added_by) : undefined}
                    isFavorite={favoriteNames.has(normalize(item.name))}
                    onToggle={() => toggle(item)}
                    onEdit={() => setEditing(item)}
                    onFavorite={() => toggleFavorite(item)}
                  />
                )
              })}
            </SortableContext>
          </CategorySection>
        ))}
        <DragOverlay>
          {activeId && itemById.has(activeId) ? (
            <ul className="items">
              <ItemRow
                item={itemById.get(activeId)!}
                picture={pictures.get(itemById.get(activeId)!.kroger_product_id ?? '')}
                isFavorite={favoriteNames.has(normalize(itemById.get(activeId)!.name))}
                className="overlay"
                handle={<span className="drag-handle"><GripIcon /></span>}
                onToggle={() => {}}
                onEdit={() => {}}
                onFavorite={() => {}}
              />
            </ul>
          ) : null}
        </DragOverlay>
      </DndContext>

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
                picture={item.kroger_product_id ? pictures.get(item.kroger_product_id) : null}
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

      {isOwner && data.items.length > 0 && (
        <div className="finish">
          <button className="primary wide" onClick={finishTrip} disabled={busy}>
            ✓ Finalize list
          </button>
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

function CategorySection({ group, dragging, children }: { group: Group; dragging: boolean; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: groupDropId(group.id) })
  return (
    <section ref={setNodeRef} className={`category-group ${isOver ? 'drop-over' : ''}`}>
      <h2 className="category-head">{group.name}</h2>
      <ul className="items">
        {children}
        {dragging && !group.ids.length && <li className="drop-hint">Drop here</li>}
      </ul>
    </section>
  )
}

type RowProps = {
  item: GroceryItem
  /** Live Fry's picture, when the item came from Fry's search and Fry's still has it. */
  picture?: string | null
  by?: string
  isFavorite: boolean
  onToggle: () => void
  onEdit: () => void
  onFavorite: () => void
}

function SortableItemRow(props: RowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: props.item.id,
  })
  return (
    <ItemRow
      {...props}
      rowRef={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={isDragging ? 'dragging' : ''}
      handle={
        <button type="button" className="drag-handle" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Reorder ${props.item.name}`}>
          <GripIcon />
        </button>
      }
    />
  )
}

function GripIcon() {
  return (
    <svg width="14" height="20" viewBox="0 0 14 20" aria-hidden="true">
      {[4, 10, 16].flatMap((y) => [4, 10].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" fill="currentColor" />))}
    </svg>
  )
}

function ItemRow({
  item,
  picture,
  by,
  isFavorite,
  onToggle,
  onEdit,
  onFavorite,
  handle,
  rowRef,
  style,
  className = '',
}: RowProps & { handle?: ReactNode; rowRef?: (el: HTMLElement | null) => void; style?: CSSProperties; className?: string }) {
  return (
    <li ref={rowRef} style={style} className={`item ${item.checked ? 'checked' : ''} ${className}`}>
      {handle}
      <button className="check" onClick={onToggle} aria-label={item.checked ? `Uncheck ${item.name}` : `Check off ${item.name}`}>
        {item.checked ? '✓' : ''}
      </button>
      {picture && <ProductImage src={picture} className="item-img" hideMissing />}
      <button className="item-body" onClick={onEdit}>
        <span className="item-name">
          <span>
            {!brandIsInName(item.brand, item.name) && <strong>{item.brand} </strong>}
            {item.name}
            {item.size && <span className="item-size"> · {item.size}</span>}
          </span>
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
