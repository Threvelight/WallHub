# WallHub

Shared household grocery list and recipes. React + TypeScript PWA, Supabase (Postgres, auth, realtime), deployed on Vercel.

**Phase 1:** shared grocery list with live sync, recipes that add their ingredients to the list, favorites (quick-add staples), "Load last week", and one household with invited members.

**Phase 1.5:** shared family calendar.

**Wall display:** the Today screen, with a family note board, night mode and a photo frame.

## How it works

- **One household, separate logins.** The first person creates an account and a household. Settings shows an invite code and a share link; everyone else creates their own account and joins with the code. Everyone in the household sees the same data, and nobody outside it can read it (Row Level Security).
- **Today** is the screen the app opens on (`/`), built to be read from across the kitchen on the wall iPad: a big clock and date, Sierra Vista weather (current temperature, condition, today's high and low), tonight's dinner (any Dinner event today, or "No dinner planned" with a button that opens the add-event form set to Dinner and today), today's other events (all-day first, then by time), the next 7 days grouped by day, and a countdown to the next Birthday and the next Trip within a year. Tap any event to open it. It's one column on phones and in portrait and two columns in landscape. Events update live, and the clock rolls the whole screen over at local midnight. Dates are compared as the device's local calendar date, never through UTC. Weather comes straight from the free [Open-Meteo](https://open-meteo.com/) API (no key), refreshes every 30 minutes and whenever the screen comes back into view, and is never stored. If it can't be reached the card just says "Weather unavailable". The grocery list is the List tab (`/list`).
- **Family note board (Today).** One shared sticky note for the household (up to 500 characters), with "Last changed by NAME, time". Tap it to edit; Clear empties it. It updates live on every device, and if someone else changes it while you're typing, your draft stays and you can keep editing or reload theirs. It lives only in the `family_note` table: not in backups or browser storage.
- **Night mode (Today only).** From 9 PM to 6 AM by the device's clock, Today dims to a near-black screen with a soft clock, the date and the note. A tap brightens it for 30 seconds (using it keeps it bright), then it dims again. It switches on and off by itself while left open. Other tabs never dim. For testing, `/today?night=1` forces it on and `/today?night=0` forces it off for that page view (`/today` is another address for the Today screen).
- **Screen stays awake on Today.** While Today is showing (dimmed or not), the app asks the browser for a screen wake lock so the iPad doesn't auto-lock, and asks again whenever Today comes back into view. Leaving Today releases it. Needs iPadOS 16.4 or later; where it isn't supported, the screen locks as usual.
- **Photos (Settings → Photos).** Add photos from any device (several at once). Each one is shrunk in the browser before uploading (longest side 1600 px, JPEG about 0.82 quality, turned upright using the photo's rotation), so location and camera data are not in the uploaded copy. They go to the private `household-photos` storage bucket at `<household_id>/<random id>.jpg` and show as a grid, newest first, with the count and total size (and a reminder once it passes 800 MB, since the free plan holds 1 GB). Photos that fail to upload are named, and the rest still go up. Whoever added a photo can delete it, and the household owner can delete any of them; the bucket's policies enforce that. The grid loads through signed links that expire after an hour and are refreshed before then. Photos are never kept in browser storage or any cache of the app's own; the browser's ordinary image cache may hold them for up to a week, so a photo the slideshow already showed isn't downloaded again (each pass would otherwise count against the free plan's monthly download allowance). The slideshow's links last a day. **Photos are not part of the backup file or the weekly email.**
- **Photo frame (Today).** When nobody has touched, typed, clicked or scrolled on Today for 5 minutes, between 6 AM and 9 PM, it shows the household's photos full-screen: shuffled, 15 seconds each with a gentle crossfade, the whole photo on near-black, and a small clock in the corner. Any tap or key goes back to Today and starts the 5 minutes again. It never starts while the note editor or an event sheet is open, picks up added or deleted photos at the start of each pass through them, and keeps the screen awake. Night mode wins: at 9 PM the slideshow hands over to the dim screen, and it never starts at night. With no photos, or if they can't be loaded, nothing happens. For testing, for that page view only: `/today?idle=10` makes the idle time 10 seconds, and `/today?photos=1` starts it straight away if there are photos.
- **The list.** There is always one active list. Tap the circle to check items off, tap the item to edit quantity or notes, tap ★ to save it as a favorite. Every device updates instantly via Supabase Realtime (and refreshes when the app returns to the foreground).
- **Reordering.** Drag an item by its handle (⋮⋮) to reorder it within its category, or drop it in another category to move it there (that category change syncs to everyone). The order itself is saved only on that device for the current list; other devices, and every new or loaded list, show items alphabetically within each category.
- **Finalize list** saves the list to history and starts a fresh one. Anything not checked off carries over. Only the household owner sees the button (the database enforces it too), so one person decides when the week's shopping is done.
- **Load last week** copies the most recent saved list into the current one, skipping anything already on it. Settings → Past lists can load any earlier week.
- **Recipes.** Ingredients are linked to grocery items by name: "Add to list" adds each ingredient, and if the item is already on the list it adds a note ("Tacos (2)") instead of a duplicate.
- **Favorites.** The page splits into **On the current list** and **Not on the current list**, each with a count, and updates live from any device. A favorite counts as on the list when an unchecked item has the same name or the same Fry's product (the same rule `add_favorites_to_list` uses); checked-off items don't count. "Add all" adds everything in the Not-on-the-list section; or select a few. Starring a Fry's item keeps its product (name, brand, size, product ID), so the favorite shows its picture and goes back on the list as that exact product. An older favorite whose name matches a Fry's product picks the product up the next time that product is added through Fry's search.
- **Fry's search.** Under "Add an item", **Search Fry's…** looks up products at our Fry's as you type (2+ letters). Results show the picture, brand, name and size; tapping one adds that exact product. The list saves only its name, brand, size and Fry's product ID, and shows its picture by looking it up live each time (in one batched call). Kroger's terms forbid keeping copies of their catalog, so search results and pictures are never stored: not in the database, browser storage or the service worker. If Fry's can't be reached, items show as plain text and typing items works as always. Past lists keep the exact product, so loading one brings back the same size with its picture. Search goes through the `kroger-search` Edge Function, which holds the Kroger credentials.
- **Calendar.** A month view everyone in the household shares. Tap an empty date to add an event, or a date with events to see them and add more; tap an event for its details, who added it, and Edit / Delete. Events have a title, date, optional time (no time means all day), optional description and an optional type (Grocery, Appointment, Birthday, Family Event, Dinner, Trip, or Other with your own name). Changes sync to every device instantly. The Today screen shows today and the next 7 days.

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
| `family_note` | The Today screen's shared note: one row per household (body up to 500 characters, who changed it and when) |
| `household-photos` (storage) | Private bucket for the photo frame: `<household_id>/<id>.jpg`, up to 2 MB each, JPEG / WebP / PNG. Members can see and add photos in their own household's folder; a photo can be deleted by whoever added it or by the household owner |

Every household-owned table has `household_id`, protected by RLS via `current_household_id()`. Multi-step actions run as Postgres functions so they're atomic: `create_household`, `join_household`, `regenerate_invite_code`, `ensure_active_list`, `finish_list`, `load_history`, `add_recipe_to_list`, `add_favorites_to_list`. Phase 2 tables (calendar, chores, budget, meal plans) follow the same `household_id` + policy pattern, and the `category` columns on items and favorites are ready for store aisles or Fry's product mapping.

## Backups

Photos in the photo frame are **not** in either backup below; keep your own copies of them.

- **Export / Import (Settings → Backup):** Export downloads `wallhub-full-backup-YYYY-MM-DD.json` with every finalized list, the current list, favorites (with their Fry's product when they have one), recipes and categories. Import reads a full backup or a weekly list file and only adds what's missing: lists already here (same name and date), favorites and recipes with the same name are skipped, and nothing existing is changed. It asks for confirmation first.
- **Weekly email:** every Sunday at 8 PM Phoenix time (`0 3 * * 1` UTC in pg_cron), the `weekly-backup` Edge Function emails the week's finalized lists to `wallhub@threvelight.com` as `wallhub-<list-name>-<date>.json` attachments, or a short note if there were none. Email goes through [Resend](https://resend.com).
  - Edge Function secrets: `RESEND_API_KEY` (required), `BACKUP_EMAIL_TO` (default `wallhub@threvelight.com`), `BACKUP_EMAIL_FROM` (default `WallHub <onboarding@resend.dev>`, which only delivers to the Resend account's own address; verify a domain in Resend to use another sender).
  - The schedule authenticates with a token in `private.backup_config`. Manual runs in the SQL editor: `select private.run_weekly_backup(true);` is a dry run (see `net._http_response`), `select private.run_weekly_backup();` sends.
  - Tests for the email builder: `node --experimental-strip-types supabase/functions/weekly-backup/email.test.ts`

## Scripts

- `npm run dev`: local dev server
- `npm run build`: typecheck + production build (web app manifest for home-screen install; no offline cache)
- `npm run typecheck`
