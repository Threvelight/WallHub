import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Household, Member } from './types'

type AuthState = {
  loading: boolean
  session: Session | null
  member: Member | null
  household: Household | null
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [member, setMember] = useState<Member | null>(null)
  const [household, setHousehold] = useState<Household | null>(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) {
      setMember(null)
      setHousehold(null)
      return
    }
    const { data: m } = await supabase.from('users').select('*').eq('id', s.user.id).maybeSingle()
    setMember((m as Member | null) ?? null)
    if (m) {
      const { data: h } = await supabase.from('households').select('*').eq('id', m.household_id).single()
      setHousehold((h as Household | null) ?? null)
    } else {
      setHousehold(null)
    }
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      await loadProfile(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      // Defer DB calls out of the auth callback (supabase-js recommendation).
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        setTimeout(() => void loadProfile(s), 0)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [loadProfile])

  const value: AuthState = {
    loading,
    session,
    member,
    household,
    refresh: () => loadProfile(session),
    signOut: async () => {
      await supabase.auth.signOut()
    },
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}
