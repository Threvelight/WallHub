// The family note board on Today: one shared note per household, kept only in
// the family_note table (not in backups or browser storage).

import { supabase } from './supabase'
import type { FamilyNote } from './types'

export const NOTE_MAX = 500

export async function getNote(): Promise<FamilyNote | null> {
  const { data, error } = await supabase.from('family_note').select('*').maybeSingle()
  if (error) throw new Error(error.message)
  return data as FamilyNote | null
}

/** Saves the note. The column defaults only apply on first insert, so who and when are set every time. */
export async function saveNote(householdId: string, userId: string, body: string): Promise<FamilyNote> {
  const { data, error } = await supabase
    .from('family_note')
    .upsert(
      { household_id: householdId, body, updated_by: userId, updated_at: new Date().toISOString() },
      { onConflict: 'household_id' },
    )
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as FamilyNote
}

/** "7:42 PM" today, "Yesterday 7:42 PM", otherwise "Oct 3, 7:42 PM". */
export function formatChanged(iso: string, now = new Date()) {
  const d = new Date(iso)
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (sameDay(d, now)) return time
  const y = new Date(now)
  y.setDate(y.getDate() - 1)
  if (sameDay(d, y)) return `yesterday ${time}`
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`
}
