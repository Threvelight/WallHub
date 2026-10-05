# WallHub

Shared household grocery list and recipes. React + TypeScript PWA, Supabase (Postgres, auth, realtime), deployed on Vercel.

**Phase 1:** shared grocery list with live sync, recipes that add their ingredients to the list, favorites (quick-add staples), "Load last week", and one household with invited members.

**Phase 1.5:** shared family calendar.

## How it works

- **One household, separate logins.** The first person creates an account and a household. Settings shows an invite code and a share link; everyone else creates their own account and joins with the code. Everyone in the household sees the same data, and nobody outside it can read it (Row Level Security).
- **The list.** There is always one active list. Tap the circle to check items off, tap the item to edit quantity or notes, tap ★ to save it as a favorite. Every device updates instantly via Supabase Realtime (and refreshes when the app returns to the foreground).
- **Reordering.** Drag an item by its handle (⋮⋮) to reorder it within its category, or drop it in another category to move it there (that category change syncs to everyone). The order itself is saved only on that device for the current list; other devices, and every new or loaded list, show items alphabetically within each category.
- **Finalize list** saves the list to history and starts a fresh one. Anything not checked off carries over.
- **Load last week** copies the most recent saved list into the current one, skipping anything already on it. Settings → Past lists can load any earlier week.
- **Recipes.** Ingredients are linked to grocery items by name: "Add to list" adds each ingredient, and if the item is already on the list it adds a note ("Tacos (2)") instead of a duplicate.
- **Favorites.** "Add all" puts every staple not already on the list onto it; or select a few.
- **Calendar.** A month view everyone in the household shares. Tap an empty date to add an event, or a date with events to see them and add more; tap an event for its details, who added it, and Edit / Delete. Events have a title, date, optional time (no time means all day), optional description and an optional type (Grocery, Appointment, Birthday, Family Event, or Other with your own name). Changes sync to every device instantly. The top of the List tab shows the next 7 days of events; tap one to open it in the calendar.

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com/dashboard) (free tier is fine).
2. **SQL Editor**: paste the contents of `supabase/migrations/20261004000000_init.sql` and Run. (Or with the CLI: `supabase link --project-ref <ref> && supabase db push`.)
3. **Authentication → Sign In / Providers → Email**: email + password is on by default. For a family app it's easiest to turn **off** "Confirm email" so new accounts work immediately. If you leave it on, each person clicks the link in their confirmation email first.
4. **Authentication → URL Configuration**: set **Site URL** to your Vercel URL (e.g. `https://wallhub.vercel.app`) once you have it, so email links go to the right place.
5. **Project Settings → API**: copy the **Project URL** and the **anon / publishable key**.

### 2. Run locally

```bash
cp .env.example .env.local   # fill in the two values
npm install
npm run dev
```

### 3. Deploy to Vercel

1. Push this folder to a GitHub repo and import it in Vercel (framework preset **Vite**; build `npm run build`, output `dist`).
2. Add environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (Production and Preview).
3. Deploy. `vercel.json` handles client-side routes.

### 4. Install on phones and the iPad

- **iPhone / iPad (Safari):** open the site → Share → **Add to Home Screen**.
- **Android (Chrome):** menu → **Install app**.

Then: you sign up and create the household, go to Settings → **Share invite**, and your wife and stepson open the link, create accounts, and join.

## Database

| Table | Purpose |
| --- | --- |
| `households` | One per household; holds the invite code |
| `users` | Household members (linked to Supabase auth users) |
| `grocery_lists` | Shopping sessions; one `active` per household, older ones `completed` |
| `grocery_items` | Items on a list: name, quantity, notes, checked, who added/checked |
| `recipes` | Household recipes |
| `recipe_ingredients` | Ingredients per recipe (matched to grocery items by name) |
| `favorites` | Quick-add staples |
| `list_history` | Snapshot of each finished list (powers "Load last week") |
| `events` | Calendar events: title, date, optional time / description / type, who created it |

Every household-owned table has `household_id`, protected by RLS via `current_household_id()`. Multi-step actions run as Postgres functions so they're atomic: `create_household`, `join_household`, `regenerate_invite_code`, `ensure_active_list`, `finish_list`, `load_history`, `add_recipe_to_list`, `add_favorites_to_list`. Phase 2 tables (calendar, chores, budget, meal plans) follow the same `household_id` + policy pattern, and the `category` columns on items and favorites are ready for store aisles or Fry's product mapping.

## Backups

- **Export / Import (Settings → Backup):** Export downloads `wallhub-full-backup-YYYY-MM-DD.json` with every finalized list, the current list, favorites, recipes and categories. Import reads a full backup or a weekly list file and only adds what's missing: lists already here (same name and date), favorites and recipes with the same name are skipped, and nothing existing is changed. It asks for confirmation first.
- **Weekly email:** every Sunday at 8 PM Phoenix time (`0 3 * * 1` UTC in pg_cron), the `weekly-backup` Edge Function emails the week's finalized lists to `wallhub@threvelight.com` as `wallhub-<list-name>-<date>.json` attachments, or a short note if there were none. Email goes through [Resend](https://resend.com).
  - Edge Function secrets: `RESEND_API_KEY` (required), `BACKUP_EMAIL_TO` (default `wallhub@threvelight.com`), `BACKUP_EMAIL_FROM` (default `WallHub <onboarding@resend.dev>`, which only delivers to the Resend account's own address; verify a domain in Resend to use another sender).
  - The schedule authenticates with a token in `private.backup_config`. Manual runs in the SQL editor: `select private.run_weekly_backup(true);` is a dry run (see `net._http_response`), `select private.run_weekly_backup();` sends.
  - Tests for the email builder: `node --experimental-strip-types supabase/functions/weekly-backup/email.test.ts`

## Scripts

- `npm run dev`: local dev server
- `npm run build`: typecheck + production build (web app manifest for home-screen install; no offline cache)
- `npm run typecheck`
