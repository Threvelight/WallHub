import { useState, type FormEvent } from 'react'
import { formatChanged, NOTE_MAX, saveNote } from '../lib/note'
import type { FamilyNote } from '../lib/types'
import { toast } from './Toast'

/** Identifies one saved version of the note. */
const versionOf = (n: FamilyNote | null) => (n ? `${n.updated_at}|${n.updated_by}|${n.body}` : null)

/** The shared sticky note on Today. Read-only (no editing) while the screen is dimmed. */
export default function NoteBoard({
  note,
  error,
  householdId,
  userId,
  memberName,
  now,
  readOnly = false,
  onSaved,
}: {
  note: FamilyNote | null
  error: string | null
  householdId: string | undefined
  userId: string | undefined
  memberName: Map<string, string>
  now: Date
  readOnly?: boolean
  onSaved: (n: FamilyNote) => void
}) {
  // `base` is the version the draft started from, so a change from another device can be noticed.
  const [editing, setEditing] = useState<{ draft: string; base: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const body = note?.body.trim() ? note.body : ''
  const changedElsewhere = !!editing && versionOf(note) !== editing.base

  async function save(text: string) {
    if (!householdId || !userId) return
    setBusy(true)
    try {
      onSaved(await saveNote(householdId, userId, text))
      setEditing(null)
      toast(text.trim() ? 'Note saved' : 'Note cleared')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (editing) void save(editing.draft.trim() ? editing.draft : '')
  }

  const by = note?.updated_by ? memberName.get(note.updated_by) : undefined
  const content = body ? (
    <>
      <p className="note-body">{body}</p>
      <p className="note-meta">
        Last changed by {by ?? 'someone'}, {formatChanged(note!.updated_at, now)}
      </p>
    </>
  ) : error ? (
    <p className="muted">The note board isn't available right now.</p>
  ) : (
    <p className="note-empty">Tap to leave a note for the family</p>
  )

  if (readOnly)
    return body ? (
      <section className="note-card" aria-label="Family note">
        {content}
      </section>
    ) : null

  return (
    <>
      <button
        className="note-card"
        aria-label={body ? 'Family note, tap to edit' : 'Leave a note for the family'}
        disabled={!!error && !body}
        onClick={() => setEditing({ draft: note?.body ?? '', base: versionOf(note) })}
      >
        {content}
      </button>

      {editing && (
        <div className="backdrop" onClick={() => setEditing(null)}>
          <form className="sheet stack" aria-label="Family note" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
            <h2>Family note</h2>
            {changedElsewhere && (
              <div className="note-conflict" role="alert">
                <span>Note was changed by someone else.</span>
                <span className="row">
                  <button
                    type="button"
                    className="small"
                    onClick={() => setEditing({ ...editing, base: versionOf(note) })}
                  >
                    Keep editing
                  </button>
                  <button
                    type="button"
                    className="small"
                    onClick={() => setEditing({ draft: note?.body ?? '', base: versionOf(note) })}
                  >
                    Reload
                  </button>
                </span>
              </div>
            )}
            <label>
              <span className="sr-only">Note</span>
              <textarea
                className="note-input"
                autoFocus
                rows={5}
                maxLength={NOTE_MAX}
                value={editing.draft}
                placeholder="Dentist moved to Thursday. Pizza Friday!"
                onChange={(e) => setEditing({ ...editing, draft: e.target.value.slice(0, NOTE_MAX) })}
              />
            </label>
            <p className={`note-count ${editing.draft.length >= NOTE_MAX ? 'full' : ''}`} aria-live="polite">
              {editing.draft.length} / {NOTE_MAX}
            </p>
            <div className="row">
              <button type="button" className="danger" disabled={busy || !body} onClick={() => void save('')}>
                Clear
              </button>
              <span className="spacer" />
              <button type="button" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                Save
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
