import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { getMembers } from '../lib/data'
import {
  deleteEvent,
  formatMonth,
  formatTime,
  getEvents,
  monthGrid,
  monthOf,
  saveEvent,
  shiftMonth,
  today,
  typeClass,
  type EventFields,
} from '../lib/events'
import { useLiveQuery } from '../lib/live'
import type { CalendarEvent, Member } from '../lib/types'
import { DaySheet, EventDetails, EventForm } from '../components/EventSheets'
import { toast } from '../components/Toast'

type Sheet =
  | { kind: 'day'; date: string }
  | { kind: 'details'; id: string; fromDay?: string }
  | { kind: 'form'; date: string; event?: CalendarEvent; fromDay?: string }

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MAX_LABELS = 2

export default function CalendarPage() {
  const { household } = useAuth()
  const hid = household?.id
  const [params, setParams] = useSearchParams()
  const linkedDate = params.get('date')
  const linkedEvent = params.get('event')

  const [month, setMonth] = useState(() => monthOf(linkedDate ?? today()))
  const days = useMemo(() => monthGrid(month), [month])
  const [sheet, setSheet] = useState<Sheet | null>(null)

  const from = days[0]
  const { data, loading, error, reload } = useLiveQuery<{ from: string; events: CalendarEvent[] }>(
    `events:${from}`,
    hid,
    ['events'],
    async () => ({ from, events: await getEvents(from, days[days.length - 1]) }),
    { from: '', events: [] },
  )
  // Right after a month change the previous month's rows are still here.
  const ready = !loading && data.from === from
  const events = data.from === from ? data.events : []
  const { data: members } = useLiveQuery<Member[]>('members', hid, ['users'], getMembers, [])
  const memberName = useMemo(() => new Map(members.map((m) => [m.id, m.display_name])), [members])

  const byDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const e of events) map.set(e.date, [...(map.get(e.date) ?? []), e])
    return map
  }, [events])

  // Arriving from the upcoming banner: show that month and open the event.
  useEffect(() => {
    if (!linkedDate) return
    const target = monthOf(linkedDate)
    if (target !== month) {
      setMonth(target)
      return
    }
    if (!ready) return
    if (linkedEvent && events.some((e) => e.id === linkedEvent)) setSheet({ kind: 'details', id: linkedEvent })
    else if (byDate.has(linkedDate)) setSheet({ kind: 'day', date: linkedDate })
    setParams({}, { replace: true })
  }, [linkedDate, linkedEvent, month, ready, events, byDate, setParams])

  // An open event deleted on another device closes its sheet.
  const detailsEvent = sheet?.kind === 'details' ? events.find((e) => e.id === sheet.id) : undefined
  useEffect(() => {
    if (sheet?.kind === 'details' && ready && !detailsEvent) {
      setSheet(sheet.fromDay ? { kind: 'day', date: sheet.fromDay } : null)
      toast('That event was deleted')
    }
  }, [sheet, detailsEvent, ready])

  function openDate(date: string) {
    setSheet(byDate.has(date) ? { kind: 'day', date } : { kind: 'form', date })
  }

  async function save(f: EventFields, id?: string) {
    if (!hid) return
    await saveEvent(hid, f, id)
    setSheet(null)
    toast(id ? 'Event updated' : 'Event added')
    if (monthOf(f.date) !== month) setMonth(monthOf(f.date))
    void reload()
  }

  const now = today()
  const daySheetEvents = sheet?.kind === 'day' ? (byDate.get(sheet.date) ?? []) : []

  return (
    <div className="page">
      <header className="page-head">
        <h1>Calendar</h1>
        <button className="primary" onClick={() => setSheet({ kind: 'form', date: month.slice(0, 7) === now.slice(0, 7) ? now : month })}>
          + Add event
        </button>
      </header>

      <div className="month-nav">
        <button className="icon" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
          ‹
        </button>
        <h2 className="grow center">{formatMonth(month)}</h2>
        <button className="icon" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>
          ›
        </button>
        <button className="small" disabled={monthOf(now) === month} onClick={() => setMonth(monthOf(now))}>
          Today
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="month" role="grid" aria-label={formatMonth(month)} aria-busy={!ready}>
        {WEEKDAYS.map((d) => (
          <div key={d} className="weekday" role="columnheader">
            {d}
          </div>
        ))}
        {days.map((date) => {
          const list = byDate.get(date) ?? []
          const outside = date.slice(0, 7) !== month.slice(0, 7)
          return (
            <button
              key={date}
              role="gridcell"
              className={`day${outside ? ' outside' : ''}${date === now ? ' today' : ''}${list.length ? ' has-events' : ''}`}
              aria-label={`${date}${list.length ? `, ${list.length} event${list.length === 1 ? '' : 's'}` : ''}`}
              onClick={() => openDate(date)}
            >
              <span className="day-num">{Number(date.slice(8))}</span>
              <span className="day-labels">
                {list.slice(0, MAX_LABELS).map((e) => (
                  <span key={e.id} className={`day-label ${typeClass(e.event_type)}`}>
                    {e.time && <span className="day-label-time">{formatTime(e.time).replace(':00', '').replace(' ', '').toLowerCase()} </span>}
                    {e.title}
                  </span>
                ))}
                {list.length > MAX_LABELS && <span className="day-more">+{list.length - MAX_LABELS} more</span>}
              </span>
              <span className="day-dots" aria-hidden>
                {list.slice(0, 3).map((e) => (
                  <span key={e.id} className={`dot ${typeClass(e.event_type)}`} />
                ))}
              </span>
            </button>
          )
        })}
      </div>
      <p className="muted small center calendar-hint">Tap a date to see its events or add one.</p>

      {sheet?.kind === 'day' && (
        <DaySheet
          date={sheet.date}
          events={daySheetEvents}
          onOpen={(e) => setSheet({ kind: 'details', id: e.id, fromDay: sheet.date })}
          onAdd={() => setSheet({ kind: 'form', date: sheet.date, fromDay: sheet.date })}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === 'details' && detailsEvent && (
        <EventDetails
          event={detailsEvent}
          creator={detailsEvent.created_by ? memberName.get(detailsEvent.created_by) : undefined}
          onEdit={() => setSheet({ kind: 'form', date: detailsEvent.date, event: detailsEvent, fromDay: sheet.fromDay })}
          onDelete={async () => {
            await deleteEvent(detailsEvent.id)
            setSheet(null)
            toast('Event deleted')
            void reload()
          }}
          onClose={() => setSheet(sheet.fromDay && byDate.has(sheet.fromDay) ? { kind: 'day', date: sheet.fromDay } : null)}
        />
      )}
      {sheet?.kind === 'form' && (
        <EventForm
          key={sheet.event?.id ?? sheet.date}
          editing={!!sheet.event}
          initial={
            sheet.event
              ? {
                  title: sheet.event.title,
                  date: sheet.event.date,
                  time: sheet.event.time?.slice(0, 5) ?? '',
                  description: sheet.event.description ?? '',
                  eventType: sheet.event.event_type ?? '',
                }
              : { title: '', date: sheet.date, time: '', description: '', eventType: '' }
          }
          onSave={(f) => save(f, sheet.event?.id)}
          onClose={() =>
            setSheet(
              sheet.event
                ? { kind: 'details', id: sheet.event.id, fromDay: sheet.fromDay }
                : sheet.fromDay && byDate.has(sheet.fromDay)
                  ? { kind: 'day', date: sheet.fromDay }
                  : null,
            )
          }
        />
      )}
    </div>
  )
}
