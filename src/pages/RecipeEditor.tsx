import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { must } from '../lib/data'
import { errorMessage, supabase } from '../lib/supabase'
import type { Recipe, RecipeIngredient } from '../lib/types'
import { toast } from '../components/Toast'

type Row = { key: string; name: string; quantity: string; notes: string }
const blankRow = (): Row => ({ key: crypto.randomUUID(), name: '', quantity: '', notes: '' })

export default function RecipeEditor() {
  const { id } = useParams()
  const isNew = !id
  const navigate = useNavigate()
  const { household, member } = useAuth()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [servings, setServings] = useState('')
  const [instructions, setInstructions] = useState('')
  const [rows, setRows] = useState<Row[]>([blankRow(), blankRow(), blankRow()])
  const [loading, setLoading] = useState(!isNew)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    void (async () => {
      try {
        const r = must(
          await supabase
            .from('recipes')
            .select('*, recipe_ingredients(*)')
            .eq('id', id)
            .order('position', { referencedTable: 'recipe_ingredients' })
            .single(),
        ) as Recipe & { recipe_ingredients: RecipeIngredient[] }
        setName(r.name)
        setDescription(r.description ?? '')
        setServings(r.servings ? String(r.servings) : '')
        setInstructions(r.instructions ?? '')
        setRows([
          ...r.recipe_ingredients.map((i) => ({ key: i.id, name: i.name, quantity: i.quantity ?? '', notes: i.notes ?? '' })),
          blankRow(),
        ])
      } catch (e) {
        setError(errorMessage(e))
      } finally {
        setLoading(false)
      }
    })()
  }, [id])

  function updateRow(key: string, patch: Partial<Row>) {
    setRows((rs) => {
      const next = rs.map((r) => (r.key === key ? { ...r, ...patch } : r))
      // Always keep one empty row at the bottom for fast entry.
      return next[next.length - 1].name.trim() ? [...next, blankRow()] : next
    })
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!household) return
    setBusy(true)
    setError(null)
    try {
      const fields = {
        name: name.trim(),
        description: description.trim() || null,
        servings: servings ? Number(servings) : null,
        instructions: instructions.trim() || null,
      }
      let recipeId = id
      if (isNew) {
        const r = must(
          await supabase
            .from('recipes')
            .insert({ ...fields, household_id: household.id, created_by: member?.id })
            .select()
            .single(),
        ) as Recipe
        recipeId = r.id
      } else {
        must(await supabase.from('recipes').update(fields).eq('id', id!).select())
        must(await supabase.from('recipe_ingredients').delete().eq('recipe_id', id!).select())
      }
      const ingredients = rows
        .filter((r) => r.name.trim())
        .map((r, position) => ({
          household_id: household.id,
          recipe_id: recipeId!,
          name: r.name.trim(),
          quantity: r.quantity.trim() || null,
          notes: r.notes.trim() || null,
          position,
        }))
      if (ingredients.length) must(await supabase.from('recipe_ingredients').insert(ingredients).select())
      toast(`Saved ${fields.name}`)
      navigate('/recipes')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!id || !confirm(`Delete the recipe “${name}”?`)) return
    setBusy(true)
    try {
      must(await supabase.from('recipes').delete().eq('id', id).select())
      navigate('/recipes')
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  if (loading) return <div className="page muted">Loading…</div>

  return (
    <form className="page stack" onSubmit={save}>
      <header className="page-head">
        <div>
          <Link to="/recipes" className="muted small">
            ← Recipes
          </Link>
          <h1>{isNew ? 'New recipe' : name || 'Recipe'}</h1>
        </div>
      </header>

      <div className="card stack">
        <label>
          Name
          <input required placeholder="Taco night" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="row">
          <label className="grow">
            Short description
            <input placeholder="Optional" value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label className="servings">
            Serves
            <input type="number" min={1} inputMode="numeric" value={servings} onChange={(e) => setServings(e.target.value)} />
          </label>
        </div>
      </div>

      <div className="card stack">
        <h2>Ingredients</h2>
        <p className="muted small">These go on the grocery list when you add the recipe. Items already on the list aren't duplicated.</p>
        {rows.map((r) => (
          <div key={r.key} className="ingredient-row">
            <input className="grow" placeholder="Ingredient" value={r.name} onChange={(e) => updateRow(r.key, { name: e.target.value })} />
            <input className="qty" placeholder="Qty" value={r.quantity} onChange={(e) => updateRow(r.key, { quantity: e.target.value })} />
            <button
              type="button"
              className="icon"
              aria-label="Remove ingredient"
              onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [blankRow()]))}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="card stack">
        <label>
          Instructions
          <textarea rows={6} placeholder="Optional" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        </label>
      </div>

      {error && <p className="error">{error}</p>}
      <div className="row">
        {!isNew && (
          <button type="button" className="danger" onClick={remove} disabled={busy}>
            Delete
          </button>
        )}
        <span className="spacer" />
        <Link className="button" to="/recipes">
          Cancel
        </Link>
        <button className="primary" disabled={busy || !name.trim()}>
          {busy ? 'Saving…' : 'Save recipe'}
        </button>
      </div>
    </form>
  )
}
