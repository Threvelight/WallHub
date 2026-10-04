import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { getActiveList, getCategories, getItems, must } from '../lib/data'
import { normalize, useLiveQuery } from '../lib/live'
import { errorMessage, supabase } from '../lib/supabase'
import type { Category } from '../lib/types'
import { toast } from '../components/Toast'

export default function CategoriesPage() {
  const { household, member } = useAuth()
  const hid = household?.id
  const { data: categories, setData } = useLiveQuery('categories', hid, ['categories'], getCategories, [])
  // Categories used on the current list can't be deleted.
  const { data: inUse } = useLiveQuery(
    'categories-in-use',
    hid,
    ['grocery_items', 'grocery_lists'],
    async () => {
      const list = await getActiveList()
      return new Set((await getItems(list.id)).map((i) => i.category_id).filter((id): id is string => !!id))
    },
    new Set<string>(),
  )
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  if (member?.role !== 'owner') {
    return (
      <div className="page stack">
        <Link to="/settings" className="muted small">
          ← Settings
        </Link>
        <h1>Categories</h1>
        <p className="muted">Only the household owner can manage categories.</p>
      </div>
    )
  }

  async function add(e: FormEvent) {
    e.preventDefault()
    const n = name.trim()
    if (!n || !hid) return
    if (categories.some((c) => normalize(c.name) === normalize(n))) {
      toast(`${n} already exists`)
      return
    }
    setBusy(true)
    try {
      const sortOrder = Math.max(0, ...categories.map((c) => c.sort_order)) + 1
      const c = must(
        await supabase
          .from('categories')
          .insert({ household_id: hid, name: n, is_custom: true, sort_order: sortOrder })
          .select()
          .single(),
      ) as Category
      setData((cs) => (cs.some((x) => x.id === c.id) ? cs : [...cs, c].sort((a, b) => a.name.localeCompare(b.name))))
      setName('')
      toast(`Added ${n}`)
    } catch (err) {
      toast(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove(c: Category) {
    if (!confirm(`Delete the “${c.name}” category?`)) return
    try {
      const deleted = must(await supabase.from('categories').delete().eq('id', c.id).select()) as Category[]
      if (!deleted.length) throw new Error(`Couldn't delete ${c.name}`)
      setData((cs) => cs.filter((x) => x.id !== c.id))
    } catch (err) {
      toast(errorMessage(err))
    }
  }

  return (
    <div className="page stack">
      <header className="page-head">
        <div>
          <Link to="/settings" className="muted small">
            ← Settings
          </Link>
          <h1>Categories</h1>
          <p className="muted small">The list is grouped by these. Standard categories can't be changed.</p>
        </div>
      </header>

      <form className="row" onSubmit={add}>
        <input className="grow" placeholder="New category, e.g. Spices" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="primary" disabled={busy || !name.trim()}>
          + Add
        </button>
      </form>

      <ul className="category-list">
        {categories.map((c) => (
          <li key={c.id} className={`category-row ${c.is_custom ? '' : 'standard'}`}>
            <span className="grow">{c.name}</span>
            {!c.is_custom ? (
              <span className="small">Standard</span>
            ) : inUse.has(c.id) ? (
              <span className="small muted">In use</span>
            ) : (
              <button className="small danger" onClick={() => remove(c)}>
                Delete
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
