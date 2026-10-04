import { useState, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'
import { errorMessage, supabase } from '../lib/supabase'

export default function OnboardingPage() {
  const { refresh, signOut, session } = useAuth()
  const presetCode = new URLSearchParams(location.search).get('code') ?? ''
  const [mode, setMode] = useState<'create' | 'join'>(presetCode ? 'join' : 'create')
  const [householdName, setHouseholdName] = useState('')
  const [code, setCode] = useState(presetCode)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { error } =
        mode === 'create'
          ? await supabase.rpc('create_household', { household_name: householdName, member_name: name })
          : await supabase.rpc('join_household', { code, member_name: name })
      if (error) throw error
      history.replaceState(null, '', '/')
      await refresh()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="centered">
      <form className="card narrow stack" onSubmit={submit}>
        <div>
          <h1>Welcome</h1>
          <p className="muted">Signed in as {session?.user.email}.</p>
        </div>
        <div className="segmented">
          <button type="button" className={mode === 'create' ? 'on' : ''} onClick={() => setMode('create')}>
            Start a household
          </button>
          <button type="button" className={mode === 'join' ? 'on' : ''} onClick={() => setMode('join')}>
            Join with a code
          </button>
        </div>
        {mode === 'create' ? (
          <label>
            Household name
            <input required placeholder="The Smith House" value={householdName} onChange={(e) => setHouseholdName(e.target.value)} />
          </label>
        ) : (
          <label>
            Invite code
            <input
              required
              autoCapitalize="characters"
              placeholder="From Settings on the first account"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </label>
        )}
        <label>
          Your name
          <input required placeholder="What the family calls you" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'create' ? 'Create household' : 'Join household'}
        </button>
        <button type="button" className="link" onClick={() => void signOut()}>
          Sign out
        </button>
      </form>
    </div>
  )
}
