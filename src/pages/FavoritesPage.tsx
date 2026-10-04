import { useMemo, useState, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'
import { getActiveList, getFavorites, getItems, must, rpcCount } from '../lib/data'
import { normalize, useLiveQuery } from '../lib/live'
import { errorMessage, supabase } from '../lib/supabase'
import type { Favorite } from '../lib/types'
import ItemEditor from '../components/ItemEditor'
import { toast } from '../components/Toast'

export default function FavoritesPage() {
  const { household, member } = useAuth()
  const hid = household?.id
  const { data: favorites, setData, loading, error } = useLiveQuery('favorites', hid, ['favorites'], getFavorites, [])
  const { data: onList } = useLiveQuery(
    'favorites-onlist',
    hid,
    ['grocery_items', 'grocery_lists'],
    async () => {
      const list = await getActiveList()
      return new Set((await getItems(list.id)).filter((i) => !i.checked).map((i) => normalize(i.name)))
    },
    new Set<string>(),
  )
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('')
  const [editing, setEditing] = useState<Favorite | null>(null)
  const [busy, setBusy] = useState(false)

  const notOnList = useMemo(() => favorites.filter((f) => !onList.has(normalize(f.name))), [favorites, onList])

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

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Favorites</h1>
          <p className="muted small">Weekly staples. Tap the ★ on any list item to save it here.</p>
        </div>
        <div className="row wrap">
          {selected.size > 0 ? (
            <button className="primary" disabled={busy} onClick={() => addToList([...selected])}>
              Add {selected.size} selected
            </button>
          ) : (
            <button className="primary" disabled={busy || !notOnList.length} onClick={() => addToList(null)}>
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

      <ul className="items">
        {favorites.map((f) => {
          const already = onList.has(normalize(f.name))
          return (
            <li key={f.id} className={`item ${selected.has(f.id) ? 'selected' : ''}`}>
              <button
                className={`check square ${selected.has(f.id) ? 'on' : ''}`}
                onClick={() => toggleSelect(f.id)}
                disabled={already}
                aria-label={`Select ${f.name}`}
              >
                {selected.has(f.id) ? '✓' : ''}
              </button>
              <button className="item-body" onClick={() => setEditing(f)}>
                <span className="item-name">
                  {f.name}
                  {f.quantity && <span className="qty-pill">{f.quantity}</span>}
                </span>
                {(f.notes || already) && (
                  <span className="item-meta">
                    {f.notes}
                    {f.notes && already ? ' · ' : ''}
                    {already && <span className="on-list">on the list</span>}
                  </span>
                )}
              </button>
              <button className="small" disabled={already || busy} onClick={() => addToList([f.id])}>
                + Add
              </button>
            </li>
          )
        })}
      </ul>

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
