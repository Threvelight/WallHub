// Custom item order from drag-and-drop. Lives only in this device's localStorage,
// keyed by list id, so other devices keep the default alphabetical order and a
// new list starts fresh.

const PREFIX = 'wallhub:order:'

export function loadOrder(listId: string): string[] {
  try {
    const raw = localStorage.getItem(PREFIX + listId)
    const ids = raw ? JSON.parse(raw) : []
    return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function saveOrder(listId: string, ids: string[]) {
  try {
    localStorage.setItem(PREFIX + listId, JSON.stringify(ids))
  } catch {
    // Storage full or blocked: the order just won't survive a refresh.
  }
}

/** Removes saved orders, except the one for `keepListId` if given. */
export function clearOrders(keepListId?: string) {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (key?.startsWith(PREFIX) && key !== PREFIX + keepListId) localStorage.removeItem(key)
    }
  } catch {
    // Nothing saved to clear.
  }
}
