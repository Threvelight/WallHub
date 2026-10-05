// Weekly backup email: every Sunday at 8 PM Phoenix time (scheduled with
// pg_cron, see supabase/migrations/20261005000000_backup.sql), emails each
// household's lists finalized in the past 7 days as JSON attachments.
//
// Secrets (Supabase dashboard → Edge Functions → Secrets):
//   RESEND_API_KEY      required to send
//   BACKUP_EMAIL_TO     default wallhub@threvelight.com
//   BACKUP_EMAIL_FROM   default "WallHub <onboarding@resend.dev>"
//
// Called with `Authorization: Bearer <token>`, where the token lives in
// private.backup_config. `?dry_run=1` returns the emails instead of sending.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { buildWeeklyEmail, weekWindow, type HistoryRow } from './email.ts'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: ok, error: authError } = await db.rpc('backup_token_ok', { t: token })
  if (authError) return json({ error: authError.message }, 500)
  if (!ok) return json({ error: 'unauthorized' }, 401)

  const dryRun = new URL(req.url).searchParams.has('dry_run')
  const now = new Date()
  const { since, until } = weekWindow(now)

  const { data: households, error: hError } = await db.from('households').select('id, name').order('created_at')
  if (hError) return json({ error: hError.message }, 500)

  const to = Deno.env.get('BACKUP_EMAIL_TO') || 'wallhub@threvelight.com'
  const from = Deno.env.get('BACKUP_EMAIL_FROM') || 'WallHub <onboarding@resend.dev>'
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!dryRun && !apiKey) return json({ error: 'RESEND_API_KEY is not set' }, 500)

  const results = []
  for (const h of households ?? []) {
    const { data: lists, error } = await db
      .from('list_history')
      .select('name, items, item_count, created_at')
      .eq('household_id', h.id)
      .gte('created_at', since.toISOString())
      .lt('created_at', until.toISOString())
      .order('created_at')
    if (error) return json({ error: error.message }, 500)

    const email = buildWeeklyEmail(h.name, (lists ?? []) as HistoryRow[], now)
    if (dryRun) {
      results.push({ household: h.name, to, ...email })
      continue
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        subject: email.subject,
        text: email.text,
        attachments: email.attachments.map((a) => ({ filename: a.filename, content: btoa(unescape(encodeURIComponent(a.content))) })),
      }),
    })
    const body = await res.text()
    results.push({ household: h.name, status: res.status, lists: email.attachments.length, response: body })
  }

  const failed = results.some((r) => 'status' in r && (r.status as number) >= 300)
  return json({ dryRun, since, until, results }, failed ? 502 : 200)
})
