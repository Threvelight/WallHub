import { useState, type FormEvent } from 'react'
import { EVENT_TYPES, formatLongDate, formatTime, typeClass, type EventFields } from '../lib/events'
import type { CalendarEvent } from '../lib/types'

const isPreset = (t: string) => EVENT_TYPES.some((p) => p === t)

/** Create or edit an event. */
export function EventForm({
  initial,
  editing,
  onSave,
  onClose,
}: {
  initial: EventFields
  editing: boolean
  onSave: (f: EventFields) => Promise<void>
  onClose: () => void
}) {
  const [f, setF] = useState(initial)
  // A type that isn't a preset shows as Other plus its own name.
  const [preset, setPreset] = useState(!f.eventType ? '' : isPreset(f.eventType) ? f.eventType : 'Other')
  const [custom, setCustom] = useState(f.eventType && !isPreset(f.eventType) ? f.eventType : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!f.title.trim() || !f.date) return
    setBusy(true)
    setError(null)
    try {
      await onSave({ ...f, eventType: preset === 'Other' ? custom.trim() || 'Other' : preset })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <form className="sheet stack" onClick={(e) => e.stopPropagation()} onSubmit={submit} aria-label={editing ? 'Edit event' : 'New event'}>
        <h2>{editing ? 'Edit event' : 'New event'}</h2>
        <label>
          Title
          <input autoFocus={!editing} required value={f.title} placeholder="e.g. Dentist, Mom's birthday" onChange={(e) => setF({ ...f, title: e.target.value })} />
        </label>
        <div className="row date-time">
          <label className="grow">
            Date
            <input type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          </label>
          <label className="grow">
            <span>Time <span className="optional">(optional)</span></span>
            <span className="time-field">
              <input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} />
              {f.time && (
                <button type="button" className="icon" aria-label="Clear time" onClick={() => setF({ ...f, time: '' })}>
                  ×
                </button>
              )}
            </span>
          </label>
        </div>
        <label>
          <span>Type <span className="optional">(optional)</span></span>
          <select value={preset} onChange={(e) => setPreset(e.target.value)} aria-label="Event type">
            <option value="">None</option>
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        {preset === 'Other' && (
          <label>
            <span>Type name <span className="optional">(optional)</span></span>
            <input value={custom} placeholder="e.g. School, Sports" maxLength={40} onChange={(e) => setCustom(e.target.value)} />
          </label>
        )}
        <label>
          <span>Description <span className="optional">(optional)</span></span>
          <textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="row">
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy || !f.title.trim() || !f.date}>
            Save
          </button>
        </div>
      </form>
    </div>
  )
}

/** Everything about one event, with Edit and Delete. */
export function EventDetails({
  event,
  creator,
  onEdit,
  onDelete,
  onClose,
}: {
  event: CalendarEvent
  creator: string | undefined
  onEdit: () => void
  onDelete: () => Promise<void>
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const stamp = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  const edited = new Date(event.updated_at).getTime() - new Date(event.created_at).getTime() > 60_000

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet stack" role="dialog" aria-label={event.title} onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2 className="grow event-title">{event.title}</h2>
          <button className="icon" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="event-facts">
          <p>
            <strong>{formatLongDate(event.date)}</strong>
          </p>
          <p>{event.time ? formatTime(event.time) : 'All day'}</p>
          {event.event_type && (
            <p>
              <span className={`type-chip ${typeClass(event.event_type)}`}>{event.event_type}</span>
            </p>
          )}
        </div>
        {event.description && <p className="event-description">{event.description}</p>}
        <p className="muted small">
          Added by {creator ?? 'a former member'} on {stamp(event.created_at)}
          {edited ? ` · edited ${stamp(event.updated_at)}` : ''}
        </p>
        <div className="row">
          <button
            className="danger"
            disabled={busy}
            onClick={async () => {
              if (!confirm(`Delete "${event.title}"?`)) return
              setBusy(true)
              try {
                await onDelete()
              } finally {
                setBusy(false)
              }
            }}
          >
            Delete
          </button>
          <span className="spacer" />
          <button onClick={onClose}>Close</button>
          <button className="primary" onClick={onEdit}>
            Edit
          </button>
        </div>
      </div>
    </div>
  )
}

/** A day's events, from tapping a date that has some. */
export function DaySheet({
  date,
  events,
  onOpen,
  onAdd,
  onClose,
}: {
  date: string
  events: CalendarEvent[]
  onOpen: (e: CalendarEvent) => void
  onAdd: () => void
  onClose: () => void
}) {
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet stack" role="dialog" aria-label={formatLongDate(date)} onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2 className="grow">{formatLongDate(date)}</h2>
          <button className="icon" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <ul className="day-events">
          {events.map((e) => (
            <li key={e.id}>
              <button className={`day-event ${typeClass(e.event_type)}`} onClick={() => onOpen(e)}>
                <span className="day-event-time">{e.time ? formatTime(e.time) : 'All day'}</span>
                <span className="day-event-title">{e.title}</span>
                {e.event_type && <span className="muted small">{e.event_type}</span>}
              </button>
            </li>
          ))}
        </ul>
        <button className="primary wide" onClick={onAdd}>
          + Add event
        </button>
      </div>
    </div>
  )
}
