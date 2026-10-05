import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { addDays, eventSummary, getEvents, today, typeClass } from '../lib/events'
import { useLiveQuery } from '../lib/live'
import type { CalendarEvent } from '../lib/types'

const DAYS = 7
const MAX = 5

/** Quick look at today and the 6 days after it; tapping one opens it in the calendar. */
export default function UpcomingEvents() {
  const { household } = useAuth()
  const navigate = useNavigate()
  const start = today()
  const { data: events } = useLiveQuery<CalendarEvent[]>(
    `upcoming:${start}`,
    household?.id,
    ['events'],
    () => getEvents(start, addDays(start, DAYS - 1)),
    [],
  )
  if (!events.length) return null

  return (
    <section className="upcoming" aria-label="Upcoming events">
      <h2 className="upcoming-head">Next 7 days</h2>
      <ul>
        {events.slice(0, MAX).map((e) => (
          <li key={e.id}>
            <button className="upcoming-event" onClick={() => navigate(`/calendar?date=${e.date}&event=${e.id}`)}>
              <span className={`dot ${typeClass(e.event_type)}`} aria-hidden />
              <span className="grow">{eventSummary(e)}</span>
            </button>
          </li>
        ))}
      </ul>
      {events.length > MAX && (
        <button className="link small" onClick={() => navigate('/calendar')}>
          +{events.length - MAX} more in the calendar
        </button>
      )}
    </section>
  )
}
