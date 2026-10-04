import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { getRecipes, rpcCount } from '../lib/data'
import { useLiveQuery } from '../lib/live'
import { errorMessage } from '../lib/supabase'
import { toast } from '../components/Toast'

export default function RecipesPage() {
  const { household } = useAuth()
  const { data: recipes, loading, error } = useLiveQuery('recipes', household?.id, ['recipes', 'recipe_ingredients'], getRecipes, [])
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState<string | null>(null)

  const q = query.trim().toLowerCase()
  const shown = q
    ? recipes.filter(
        (r) => r.name.toLowerCase().includes(q) || r.recipe_ingredients.some((i) => i.name.toLowerCase().includes(q)),
      )
    : recipes

  async function addToList(id: string, name: string) {
    setAdding(id)
    try {
      const added = await rpcCount('add_recipe_to_list', { rid: id })
      toast(added ? `Added ${added} item${added === 1 ? '' : 's'} for ${name}` : `Everything for ${name} is already on the list`)
    } catch (e) {
      toast(errorMessage(e))
    } finally {
      setAdding(null)
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Recipes</h1>
          <p className="muted small">Tap “Add to list” to put a recipe's ingredients on this week's list.</p>
        </div>
        <Link className="button primary" to="/recipes/new">
          + New recipe
        </Link>
      </header>

      {recipes.length > 4 && (
        <input className="search" placeholder="Search recipes or ingredients" value={query} onChange={(e) => setQuery(e.target.value)} />
      )}
      {error && <p className="error">{error}</p>}
      {loading && !recipes.length && <p className="muted">Loading…</p>}
      {!loading && !recipes.length && (
        <div className="empty">
          <p>No recipes yet.</p>
          <p className="muted small">Create one once, then add all its ingredients with one tap every week.</p>
        </div>
      )}

      <div className="grid">
        {shown.map((r) => (
          <article key={r.id} className="card recipe">
            <Link to={`/recipes/${r.id}`} className="recipe-link">
              <h3>{r.name}</h3>
              {r.description && <p className="muted small">{r.description}</p>}
              <p className="small ingredients-preview">
                {r.recipe_ingredients.length
                  ? r.recipe_ingredients.map((i) => i.name).join(', ')
                  : 'No ingredients yet'}
              </p>
            </Link>
            <button
              className="primary"
              disabled={adding === r.id || !r.recipe_ingredients.length}
              onClick={() => addToList(r.id, r.name)}
            >
              {adding === r.id ? 'Adding…' : `Add ${r.recipe_ingredients.length} to list`}
            </button>
          </article>
        ))}
      </div>
    </div>
  )
}
