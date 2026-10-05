// Run: node --experimental-strip-types supabase/functions/weekly-backup/email.test.ts
import assert from 'node:assert/strict'
import { buildWeeklyEmail, phoenixDate, slug, weekWindow } from './email.ts'

// Sunday Oct 11, 2026, 8 PM Phoenix = Monday 03:00 UTC.
const now = new Date('2026-10-12T03:00:00Z')
assert.equal(phoenixDate(now), '2026-10-11')
assert.equal(weekWindow(now).since.toISOString(), '2026-10-05T03:00:00.000Z')
assert.equal(slug('Week of Oct 04, 2026'), 'week-of-oct-04-2026')

const empty = buildWeeklyEmail('The Wall House', [], now)
assert.equal(empty.subject, 'WallHub Weekly Backup - 2026-10-11')
assert.equal(empty.attachments.length, 0)
assert.match(empty.text, /No lists were finalized/)

const item = (name: string, checked = true) => ({ name, quantity: null, notes: null, category: 'Dairy', checked })
const lists = [
  { name: 'Week of Oct 04, 2026', items: [item('Milk'), item('Eggs', false)], item_count: 2, created_at: '2026-10-05T01:30:00Z' },
  { name: 'Week of Oct 04, 2026', items: [item('Butter')], item_count: 1, created_at: '2026-10-05T02:10:00Z' },
  { name: 'Week of Oct 05, 2026', items: [item('Bread')], item_count: 1, created_at: '2026-10-10T18:00:00Z' },
]
const email = buildWeeklyEmail('The Wall House', lists, now)
assert.deepEqual(
  email.attachments.map((a) => a.filename),
  ['wallhub-week-of-oct-04-2026-2026-10-04.json', 'wallhub-week-of-oct-04-2026-2026-10-04-2.json', 'wallhub-week-of-oct-05-2026-2026-10-10.json'],
)
const file = JSON.parse(email.attachments[0].content)
assert.equal(file.format, 'wallhub-list')
assert.equal(file.list.finalized_at, '2026-10-05T01:30:00Z')
assert.equal(file.list.items.length, 2)
assert.match(email.text, /finalized 3 lists this week \(2026-10-04 to 2026-10-11\)/)
console.log('weekly email tests passed')
console.log('---\n' + email.subject + '\n' + email.text)
