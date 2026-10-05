// Builds the weekly backup email. No Deno or network APIs here, so it can be
// tested with plain Node (see email.test.ts).

export type HistoryItem = {
  name: string
  quantity: string | null
  notes: string | null
  category: string | null
  checked: boolean
}

export type HistoryRow = { name: string; items: HistoryItem[]; item_count: number; created_at: string }

export type Attachment = { filename: string; content: string }
export type WeeklyEmail = { subject: string; text: string; attachments: Attachment[] }

// Phoenix stays on MST (UTC-7) all year.
const PHOENIX_OFFSET_MS = -7 * 60 * 60 * 1000

/** YYYY-MM-DD in Phoenix time. */
export function phoenixDate(d: Date) {
  return new Date(d.getTime() + PHOENIX_OFFSET_MS).toISOString().slice(0, 10)
}

export function slug(s: string) {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'list'
  )
}

/** The backup week ends at `now` (Sunday 8 PM Phoenix when run on schedule). */
export function weekWindow(now: Date) {
  return { since: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), until: now }
}

export function buildWeeklyEmail(householdName: string, lists: HistoryRow[], now: Date): WeeklyEmail {
  const date = phoenixDate(now)
  const subject = `WallHub Weekly Backup - ${date}`
  const { since } = weekWindow(now)
  const range = `${phoenixDate(since)} to ${date}`

  if (!lists.length) {
    return {
      subject,
      text: `No lists were finalized for ${householdName} this week (${range}), so there's nothing to back up.\n\nWallHub`,
      attachments: [],
    }
  }

  const used = new Set<string>()
  const attachments = lists.map((l) => {
    const base = `wallhub-${slug(l.name)}-${phoenixDate(new Date(l.created_at))}`
    let filename = `${base}.json`
    for (let n = 2; used.has(filename); n++) filename = `${base}-${n}.json`
    used.add(filename)
    const file = {
      format: 'wallhub-list',
      version: 1,
      household: { name: householdName },
      list: { name: l.name, finalized_at: l.created_at, item_count: l.item_count, items: l.items },
    }
    return { filename, content: JSON.stringify(file, null, 2) }
  })

  const lines = lists.map((l, i) => `- ${l.name}: ${l.item_count} item${l.item_count === 1 ? '' : 's'} (${attachments[i].filename})`)
  const count = `${lists.length} list${lists.length === 1 ? '' : 's'}`
  return {
    subject,
    text:
      `${householdName} finalized ${count} this week (${range}):\n\n${lines.join('\n')}\n\n` +
      `The attached files can be restored in WallHub under Settings → Backup → Import.\n\nWallHub`,
    attachments,
  }
}
