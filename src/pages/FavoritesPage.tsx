import { useMemo, useState, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'
import { getActiveList, getFavorites, getItems, must, rpcCount } from '../lib/data'
import { normalize, useLiveQuery } from '../lib/live'
import { errorMessage, supabase } from '../lib/supabase'
import type { Favorite } from '../lib/types'
import { brandIsInName } from '../lib/kroger'
import { useProductPictures } from '../lib/useProductPictures'
import ItemEditor from '../components/ItemEditor'
import ProductImage from '../components/ProductImage'
import { toast } from '../components/Toast'

/** Unchecked items on the active list, by name and by Fry's product (the rule add_favorites_to_list uses). */
type OnList = { names: Set<string>; productIds: Set<string> }

export default function FavoritesPage() {
  const { household, member } = useAuth()
  const hid = household?.id
  const { data: favorites, setData, loading, error } = useLiveQuery('favorites', hid, ['favorites'], getFavorites, [])
  const { data: onList } = useLiveQuery<OnList>(
    'favorites-onlist',
    hid,
    ['grocery_items', 'grocery_lists'],
    async () => {
      const list = await getActiveList()
      const items = (await getItems(list.id)).filter((i) => !i.checked)
      return {
        names: new Set(items.map((i) => normalize(i.name))),
        productIds: new Set(items.flatMap((i) => (i.kroger_product_id ? [i.kroger_product_id] : []))),
      }
    },
    { names: new Set(), productIds: new Set() },
  )
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('')
  const [editing, setEditing] = useState<Favorite | null>(null)
  const [busy, setBusy] = useState(false)

  const [onListFavs, notOnList] = useMemo(() => {
    const on: Favorite[] = []
    const off: Favorite[] = []
    for (const f of favorites) {
      const listed = onList.names.has(normalize(f.name)) || (!!f.kroger_product_id && onList.productIds.has(f.kroger_product_id))
      ;(listed ? on : off).push(f)
    }
    return [on, off]
  }, [favorites, onList])
  // A selected favorite that lands on the list (here or on another device) drops out of the selection.
  const picked = notOnList.filter((f) => selected.has(f.id)).map((f) => f.id)
  const pictures = useProductPictures(favorites.flatMap((f) => (f.kroger_product_id ? [f.kroger_product_id] : [])))

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toast(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function addFavorite(e: FormEvent) {
    e.preventDefault()
    const n = name.trim()
    if (!n || !hid) return
    if (favorites.some((f) => normalize(f.name) === normalize(n))) {
      toast(`${n} is already a favorite`)
      return
    }
    setName('')
    setQuantity('')
    await run(async () => {
      const f = must(
        await supabase
          .from('favorites')
          .insert({ household_id: hid, name: n, quantity: quantity.trim() || null, created_by: member?.id })
          .select()
          .single(),
      ) as Favorite
      setData((fs) => (fs.some((x) => x.id === f.id) ? fs : [...fs, f].sort((a, b) => a.name.localeCompare(b.name))))
    })
  }

  async function addToList(ids: string[] | null) {
    await run(async () => {
      const added = await rpcCount('add_favorites_to_list', { favorite_ids: ids })
      setSelected(new Set())
      toast(added ? `Added ${added} item${added === 1 ? '' : 's'} to the list` : 'Those are already on the list')
    })
  }

  function toggleSelect(id: string) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function row(f: Favorite, already: boolean) {
    const isSelected = !already && selected.has(f.id)
    const picture = f.kroger_product_id ? pictures.get(f.kroger_product_id) : null
    return (
      <li key={f.id} className={`item ${isSelected ? 'selected' : ''}`}>
        {!already && (
          <button className={`check square ${isSelected ? 'on' : ''}`} onClick={() => toggleSelect(f.id)} aria-label={`Select ${f.name}`}>
            {isSelected ? '✓' : ''}
          </button>
        )}
        {picture && <ProductImage src={picture} className="item-img" hideMissing />}
        <button className="item-body" onClick={() => setEditing(f)}>
          <span className="item-name">
            <span>
              {!brandIsInName(f.brand, f.name) && <strong>{f.brand} </strong>}
              {f.name}
              {f.size && <span className="item-size"> · {f.size}</span>}
            </span>
            {f.quantity && <span className="qty-pill">{f.quantity}</span>}
          </span>
          {f.notes && <span className="item-meta">{f.notes}</span>}
        </button>
        {already ? (
          <span className="on-list fav-on-list">✓ On list</span>
        ) : (
          <button className="small" disabled={busy} onClick={() => addToList([f.id])}>
            + Add
          </button>
        )}
      </li>
    )
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Favorites</h1>
          <p className="muted small">Weekly staples. Tap the ★ on any list item to save it here.</p>
        </div>
        <div className="row wrap">
          {picked.length > 0 ? (
            <button className="primary" disabled={busy} onClick={() => addToList(picked)}>
              Add {picked.length} selected
            </button>
          ) : (
            <button className="primary" disabled={busy || !notOnList.length} onClick={() => addToList(notOnList.map((f) => f.id))}>
              Add all {notOnList.length || ''} to list
            </button>
          )}
        </div>
      </header>

      <form className="add-bar" onSubmit={addFavorite}>
        <input className="grow" placeholder="Add a staple…" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="qty" placeholder="Qty" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        <button className="primary" disabled={!name.trim()}>
          Save
        </button>
      </form>

      {error && <p className="error">{error}</p>}
      {loading && !favorites.length && <p className="muted">Loading…</p>}
      {!loading && !favorites.length && (
        <div className="empty">
          <p>No favorites yet.</p>
          <p className="muted small">Add milk, eggs, bread… whatever you buy every week.</p>
        </div>
      )}

      {favorites.length > 0 && !notOnList.length && (
        <p className="muted all-on-list">Every favorite is already on the list. Nice!</p>
      )}

      {onListFavs.length > 0 && (
        <>
          <div className="section-head">
            <h2>On the current list ({onListFavs.length})</h2>
          </div>
          <ul className="items">{onListFavs.map((f) => row(f, true))}</ul>
        </>
      )}

      {notOnList.length > 0 && (
        <>
          <div className="section-head">
            <h2>Not on the current list ({notOnList.length})</h2>
          </div>
          <ul className="items">{notOnList.map((f) => row(f, false))}</ul>
        </>
      )}

      {editing && (
        <ItemEditor
          title="Edit favorite"
          initial={{ name: editing.name, quantity: editing.quantity ?? '', notes: editing.notes ?? '' }}
          onClose={() => setEditing(null)}
          onDelete={() =>
            run(async () => {
              setData((fs) => fs.filter((x) => x.id !== editing.id))
              must(await supabase.from('favorites').delete().eq('id', editing.id).select())
            })
          }
          onSave={(v) =>
            run(async () => {
              must(
                await supabase
                  .from('favorites')
                  .update({ name: v.name, quantity: v.quantity || null, notes: v.notes || null })
                  .eq('id', editing.id)
                  .select(),
              )
            })
          }
        />
      )}
    </div>
  )
}
