import { useEffect } from 'react'
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './lib/auth'
import { supabaseConfigured } from './lib/supabase'
import AuthPage from './pages/AuthPage'
import OnboardingPage from './pages/OnboardingPage'
import TodayPage from './pages/TodayPage'
import ListPage from './pages/ListPage'
import CalendarPage from './pages/CalendarPage'
import RecipesPage from './pages/RecipesPage'
import RecipeEditor from './pages/RecipeEditor'
import FavoritesPage from './pages/FavoritesPage'
import SettingsPage from './pages/SettingsPage'
import CategoriesPage from './pages/CategoriesPage'
import { Toaster } from './components/Toast'

const tabs = [
  { to: '/', label: 'Today', icon: '🏠' },
  { to: '/list', label: 'List', icon: '🛒' },
  { to: '/calendar', label: 'Calendar', icon: '📅' },
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

  return <Shell />
}

/**
 * On phones the page itself never scrolls: the content area above the tab bar does (see
 * styles.css), so the bar can't drift or rubber-band with the page.
 */
function useLockedPage() {
  useEffect(() => {
    const root = document.documentElement
    root.classList.add('app-shell')
    // iOS may still pan the locked page to show a text field above the keyboard. Once the
    // keyboard closes (focus leaves the field and doesn't move to another), put it back.
    let timer: ReturnType<typeof setTimeout>
    const onFocusOut = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const el = document.activeElement
        if (el?.matches('input, textarea, select')) return
        if (window.scrollX || window.scrollY) window.scrollTo(0, 0)
      }, 100)
    }
    document.addEventListener('focusout', onFocusOut)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('focusout', onFocusOut)
      root.classList.remove('app-shell')
    }
  }, [])
}

function Shell() {
  useLockedPage()
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
          <Route path="/" element={<TodayPage />} />
          <Route path="/today" element={<ToToday />} />
          <Route path="/list" element={<ListPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/recipes" element={<RecipesPage />} />
          <Route path="/recipes/new" element={<RecipeEditor />} />
          <Route path="/recipes/:id" element={<RecipeEditor />} />
          <Route path="/favorites" element={<FavoritesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/categories" element={<CategoriesPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <Toaster />
    </div>
  )
}

/** /today is another name for the Today screen; its ?query (e.g. ?night=1) carries over. */
function ToToday() {
  const { search } = useLocation()
  return <Navigate to={{ pathname: '/', search }} replace />
}
