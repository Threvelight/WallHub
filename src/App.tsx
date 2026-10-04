import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'
import { supabaseConfigured } from './lib/supabase'
import AuthPage from './pages/AuthPage'
import OnboardingPage from './pages/OnboardingPage'
import ListPage from './pages/ListPage'
import RecipesPage from './pages/RecipesPage'
import RecipeEditor from './pages/RecipeEditor'
import FavoritesPage from './pages/FavoritesPage'
import SettingsPage from './pages/SettingsPage'
import { Toaster } from './components/Toast'

const tabs = [
  { to: '/', label: 'List', icon: '🛒' },
  { to: '/recipes', label: 'Recipes', icon: '📖' },
  { to: '/favorites', label: 'Favorites', icon: '⭐' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
]

export default function App() {
  const { loading, session, member, household } = useAuth()

  if (!supabaseConfigured) {
    return (
      <div className="centered">
        <div className="card narrow">
          <h1>WallHub</h1>
          <p>
            Supabase isn't configured. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (see
            README).
          </p>
        </div>
      </div>
    )
  }
  if (loading) return <div className="centered muted">Loading…</div>
  if (!session) return <AuthPage />
  if (!member || !household) return <OnboardingPage />

  return (
    <div className="shell">
      <nav className="tabs" aria-label="Main">
        <div className="brand">WallHub</div>
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.to === '/'} className="tab">
            <span className="tab-icon" aria-hidden>
              {t.icon}
            </span>
            <span>{t.label}</span>
          </NavLink>
        ))}
      </nav>
      <main className="content">
        <Routes>
          <Route path="/" element={<ListPage />} />
          <Route path="/recipes" element={<RecipesPage />} />
          <Route path="/recipes/new" element={<RecipeEditor />} />
          <Route path="/recipes/:id" element={<RecipeEditor />} />
          <Route path="/favorites" element={<FavoritesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <Toaster />
    </div>
  )
}
