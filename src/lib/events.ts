// Family calendar: dates are plain local days (YYYY-MM-DD) and times are wall-clock
// times without a zone, so an event at 3:00 PM shows as 3:00 PM on every device.

import { must } from './data'
import { supabase } from './supabase'
import type { CalendarEvent } from './types'

export const EVENT_TYPES = ['Grocery', 'Appointment', 'Birthday', 'Family Event', 'Dinner', 'Trip', 'Other'] as const

/** CSS class for an event type's color; custom types share Other's. */
export function typeClass(type: string | null) {
  if (!type) return 'type-none'
  const preset = EVENT_TYPES.find((t) => t.toLowerCase() === type.trim().toLowerCase())
  return `type-${(preset ?? 'Other').toLowerCase().replace(' ', '-')}`
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0')

/** YYYY-MM-DD for a local Date. */
export function ymd(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Local Date (midnight) for a YYYY-MM-DD string. */
export function parseYmd(s: string) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(s: string, n: number) {
  const d = parseYmd(s)
  d.setDate(d.getDate() + n)
  return ymd(d)
}

export const today = () => ymd(new Date())

/** Whole calendar days from `from` to `to` (both YYYY-MM-DD), counted on local dates. */
export function daysBetween(from: string, to: string) {
  return Math.round((parseYmd(to).getTime() - parseYmd(from).getTime()) / 86_400_000)
}

/** True when an event's type is `type`, ignoring case and spaces around it. */
export const isType = (e: Pick<CalendarEvent, 'event_type'>, type: string) =>
  (e.event_type ?? '').trim().toLowerCase() === type.toLowerCase()

/** The 6 weeks (Sunday first) shown for the month containing `month` (YYYY-MM-01). */
export function monthGrid(month: string) {
  const first = parseYmd(month)
  const start = ymd(new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay()))
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}

export function shiftMonth(month: string, n: number) {
  const d = parseYmd(month)
  return ymd(new Date(d.getFullYear(), d.getMonth() + n, 1))
}

export const monthOf = (s: string) => `${s.slice(0, 7)}-01`

export function formatMonth(month: string) {
  return parseYmd(month).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

/** "Tue, Oct 7" */
export function formatDate(s: string) {
  return parseYmd(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

/** "Tuesday, October 7, 2026" */
export function formatLongDate(s: string) {
  return parseYmd(s).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

/** "3:00 PM" for "15:00:00". */
export function formatTime(t: string) {
  const [h, m] = t.split(':').map(Number)
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/** "Dentist - Tue, Oct 7 at 3:00 PM", or without " at …" for all-day events. */
export function eventSummary(e: Pick<CalendarEvent, 'title' | 'date' | 'time'>) {
  return `${e.title} - ${formatDate(e.date)}${e.time ? ` at ${formatTime(e.time)}` : ''}`
}

/** All-day events first, then by time, then by title. */
export function byStart(a: CalendarEvent, b: CalendarEvent) {
  return (
    a.date.localeCompare(b.date) ||
    (a.time ?? '').localeCompare(b.time ?? '') ||
    a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
  )
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

/** Events from `from` to `to`, inclusive. */
export async function getEvents(from: string, to: string): Promise<CalendarEvent[]> {
  const rows: CalendarEvent[] = must(
    await supabase.from('events').select('*').gte('date', from).lte('date', to).order('date'),
  )
  return rows.sort(byStart)
}

export type EventFields = {
  title: string
  date: string
  time: string
  description: string
  eventType: string
}

export async function saveEvent(householdId: string, f: EventFields, id?: string) {
  const row = {
    title: f.title.trim(),
    date: f.date,
    time: f.time || null,
    description: f.description.trim() || null,
    event_type: f.eventType.trim() || null,
  }
  if (id) {
    const updated = must(await supabase.from('events').update(row).eq('id', id).select('id')) as unknown[]
    if (!updated.length) throw new Error('That event was deleted on another device.')
  } else must(await supabase.from('events').insert({ ...row, household_id: householdId }).select('id'))
}

export async function deleteEvent(id: string) {
  must(await supabase.from('events').delete().eq('id', id).select('id'))
}
