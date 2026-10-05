import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../lib/auth";
import { getMembers } from "../lib/data";
import {
  addDays,
  byStart,
  daysBetween,
  deleteEvent,
  formatDate,
  formatTime,
  getEvents,
  isType,
  parseYmd,
  saveEvent,
  typeClass,
  ymd,
  type EventFields,
} from "../lib/events";
import { useLiveQuery } from "../lib/live";
import type { CalendarEvent, Member } from "../lib/types";
import { useWeather } from "../lib/weather";
import { EventDetails, EventForm } from "../components/EventSheets";
import { toast } from "../components/Toast";

/** How far ahead the countdown strip looks for the next birthday and trip. */
const COUNTDOWN_DAYS = 365;
const WEEK_DAYS = 7;

type Sheet =
  | { kind: "details"; id: string }
  | { kind: "form"; initial: EventFields; event?: CalendarEvent };

/**
 * The current time, ticking on each new minute and when the screen comes back
 * into view (an iPad that slept may have skipped ticks). "Today" is derived from
 * it, so the page rolls over at local midnight while it stays open.
 */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const d = new Date();
      setNow(d);
      timer = setTimeout(
        tick,
        60_000 - (d.getSeconds() * 1000 + d.getMilliseconds()) + 50,
      );
    };
    tick();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        clearTimeout(timer);
        tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return now;
}

function countdown(from: string, to: string) {
  const n = daysBetween(from, to);
  return n === 0 ? "Today!" : n === 1 ? "Tomorrow" : `in ${n} days`;
}

export default function TodayPage() {
  const { household } = useAuth();
  const hid = household?.id;
  const now = useNow();
  // The device's local calendar date; events' plain dates compare against it as text.
  const day = ymd(now);
  const { weather, failed } = useWeather();

  const { data, error, reload } = useLiveQuery<{
    day: string;
    events: CalendarEvent[];
  }>(
    `today:${day}`,
    hid,
    ["events"],
    async () => ({
      day,
      events: await getEvents(day, addDays(day, COUNTDOWN_DAYS)),
    }),
    { day: "", events: [] },
  );
  // Right after midnight the previous day's rows are still here until the refetch lands.
  const events = useMemo(
    () => (data.day === day ? data.events : []),
    [data, day],
  );
  const { data: members } = useLiveQuery<Member[]>(
    "members",
    hid,
    ["users"],
    getMembers,
    [],
  );
  const memberName = useMemo(
    () => new Map(members.map((m) => [m.id, m.display_name])),
    [members],
  );
  const [sheet, setSheet] = useState<Sheet | null>(null);

  const view = useMemo(() => {
    const todays = events.filter((e) => e.date === day);
    const weekEnd = addDays(day, WEEK_DAYS);
    const week = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      if (e.date > day && e.date <= weekEnd)
        week.set(e.date, [...(week.get(e.date) ?? []), e]);
    }
    return {
      dinners: todays.filter((e) => isType(e, "Dinner")),
      todays: todays.filter((e) => !isType(e, "Dinner")).sort(byStart),
      week: [...week.entries()],
      birthday: events.find((e) => isType(e, "Birthday")),
      trip: events.find((e) => isType(e, "Trip")),
    };
  }, [events, day]);

  // An open event deleted on another device closes its sheet.
  const detailsEvent =
    sheet?.kind === "details"
      ? events.find((e) => e.id === sheet.id)
      : undefined;
  useEffect(() => {
    if (sheet?.kind === "details" && data.day === day && !detailsEvent) {
      setSheet(null);
      toast("That event was deleted");
    }
  }, [sheet, detailsEvent, data.day, day]);

  async function save(f: EventFields, id?: string) {
    if (!hid) return;
    await saveEvent(hid, f, id);
    setSheet(null);
    toast(id ? "Event updated" : "Event added");
    void reload();
  }

  const open = (e: CalendarEvent) => setSheet({ kind: "details", id: e.id });
  const dayLabel = (d: string) =>
    d === addDays(day, 1) ? "Tomorrow" : formatDate(d);

  return (
    <div className="page today-page">
      <div className="today-grid">
        <div className="today-col">
          <section
            className="today-card today-clock"
            aria-label="Date and time"
          >
            <div className="clock-time">
              {now.toLocaleTimeString(undefined, {
                hour: "numeric",
                minute: "2-digit",
              })}
            </div>
            <div className="clock-date">
              {parseYmd(day).toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </div>
          </section>

          <section
            className="today-card today-weather"
            aria-label="Weather in Sierra Vista"
          >
            {weather ? (
              <>
                <span className="weather-icon" aria-hidden>
                  {weather.icon}
                </span>
                <div>
                  <div className="weather-temp">{weather.temp}°</div>
                  <div className="weather-label">{weather.label}</div>
                </div>
                <div className="weather-range">
                  <div>H {weather.high}°</div>
                  <div>L {weather.low}°</div>
                </div>
              </>
            ) : (
              failed && <p className="muted small">Weather unavailable</p>
            )}
          </section>

          <section
            className="today-card today-dinner"
            aria-label="Tonight's dinner"
          >
            <h2 className="today-head">Tonight's dinner</h2>
            {view.dinners.length ? (
              <ul className="today-list">
                {view.dinners.map((e) => (
                  <li key={e.id}>
                    <button
                      className={`today-event dinner ${typeClass(e.event_type)}`}
                      onClick={() => open(e)}
                    >
                      <span className="today-event-title">{e.title}</span>
                      {e.time && (
                        <span className="today-event-time">
                          {formatTime(e.time)}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="today-empty-row">
                <span className="muted">No dinner planned</span>
                <button
                  onClick={() =>
                    setSheet({
                      kind: "form",
                      initial: {
                        title: "",
                        date: day,
                        time: "",
                        description: "",
                        eventType: "Dinner",
                      },
                    })
                  }
                >
                  + Plan dinner
                </button>
              </div>
            )}
          </section>

          {(view.birthday || view.trip) && (
            <section className="today-countdowns" aria-label="Countdowns">
              {[
                { e: view.birthday, icon: "🎂" },
                { e: view.trip, icon: "🧳" },
              ].map(
                ({ e, icon }) =>
                  e && (
                    <button
                      key={e.id}
                      className={`countdown ${typeClass(e.event_type)}`}
                      onClick={() => open(e)}
                    >
                      <span className="countdown-icon" aria-hidden>
                        {icon}
                      </span>
                      <span>
                        <strong>{e.title}</strong>, {countdown(day, e.date)}
                      </span>
                    </button>
                  ),
              )}
            </section>
          )}
        </div>
        <div className="today-col">
          <section
            className="today-card today-events"
            aria-label="Today's events"
          >
            <h2 className="today-head">Today</h2>
            {view.todays.length ? (
              <EventList events={view.todays} onOpen={open} />
            ) : (
              <p className="muted today-empty">
                Nothing else on the calendar today.
              </p>
            )}
          </section>

          <section className="today-card today-week" aria-label="Next 7 days">
            <h2 className="today-head">Next 7 days</h2>
            {view.week.length ? (
              view.week.map(([d, list]) => (
                <div key={d} className="week-day">
                  <h3>{dayLabel(d)}</h3>
                  <EventList events={list} onOpen={open} />
                </div>
              ))
            ) : (
              <p className="muted today-empty">
                Nothing planned for the next week.
              </p>
            )}
          </section>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      <p className="muted small center today-credit">
        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
          Weather by Open-Meteo
        </a>
      </p>

      {sheet?.kind === "details" && detailsEvent && (
        <EventDetails
          event={detailsEvent}
          creator={
            detailsEvent.created_by
              ? memberName.get(detailsEvent.created_by)
              : undefined
          }
          onEdit={() =>
            setSheet({
              kind: "form",
              event: detailsEvent,
              initial: {
                title: detailsEvent.title,
                date: detailsEvent.date,
                time: detailsEvent.time?.slice(0, 5) ?? "",
                description: detailsEvent.description ?? "",
                eventType: detailsEvent.event_type ?? "",
              },
            })
          }
          onDelete={async () => {
            await deleteEvent(detailsEvent.id);
            setSheet(null);
            toast("Event deleted");
            void reload();
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === "form" && (
        <EventForm
          editing={!!sheet.event}
          initial={sheet.initial}
          onSave={(f) => save(f, sheet.event?.id)}
          onClose={() =>
            setSheet(
              sheet.event ? { kind: "details", id: sheet.event.id } : null,
            )
          }
        />
      )}
    </div>
  );
}

function EventList({
  events,
  onOpen,
}: {
  events: CalendarEvent[];
  onOpen: (e: CalendarEvent) => void;
}) {
  return (
    <ul className="today-list">
      {events.map((e) => (
        <li key={e.id}>
          <button
            className={`today-event ${typeClass(e.event_type)}`}
            onClick={() => onOpen(e)}
          >
            <span className="today-event-time">
              {e.time ? formatTime(e.time) : "All day"}
            </span>
            <span className="today-event-title">{e.title}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
