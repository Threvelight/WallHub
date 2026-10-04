import { useState, type FormEvent } from 'react'

export type ItemFields = { name: string; quantity: string; notes: string }

/** Modal sheet for editing name / quantity / notes of an item, favorite or ingredient. */
export default function ItemEditor({
  title,
  initial,
  onSave,
  onDelete,
  onClose,
}: {
  title: string
  initial: ItemFields
  onSave: (f: ItemFields) => Promise<void> | void
  onDelete?: () => Promise<void> | void
  onClose: () => void
}) {
  const [f, setF] = useState(initial)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!f.name.trim()) return
    setBusy(true)
    try {
      await onSave({ name: f.name.trim(), quantity: f.quantity.trim(), notes: f.notes.trim() })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <form className="sheet stack" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{title}</h2>
        <label>
          Item
          <input autoFocus required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </label>
        <label>
          Quantity
          <input placeholder="e.g. 2, 1 lb, 1 gallon" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} />
        </label>
        <label>
          Notes
          <input placeholder="Brand, size, anything" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </label>
        <div className="row">
          {onDelete && (
            <button
              type="button"
              className="danger"
              onClick={async () => {
                await onDelete()
                onClose()
              }}
            >
              Delete
            </button>
          )}
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            Save
          </button>
        </div>
      </form>
    </div>
  )
}
