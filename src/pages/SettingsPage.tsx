import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { getHistory, getMembers, must, rpcCount } from '../lib/data'
import { useLiveQuery } from '../lib/live'
import { clearOrders } from '../lib/order'
import { errorMessage, supabase } from '../lib/supabase'
import { toast } from '../components/Toast'

export default function SettingsPage() {
  const { household, member, session, refresh, signOut } = useAuth()
  const hid = household?.id
  const { data: members } = useLiveQuery('settings-members', hid, ['users'], getMembers, [])
  const { data: history } = useLiveQuery('settings-history', hid, ['list_history'], getHistory, [])
  const [householdName, setHouseholdName] = useState(household?.name ?? '')
  const [myName, setMyName] = useState(member?.display_name ?? '')
  const [openHistory, setOpenHistory] = useState<string | null>(null)
  const isOwner = member?.role === 'owner'

  if (!household || !member) return null
  const inviteLink = `${location.origin}/?code=${household.invite_code}`

  async function run(fn: () => Promise<void>) {
    try {
      await fn()
    } catch (e) {
      toast(errorMessage(e))
    }
  }

  async function shareInvite() {
    const text = `Join our WallHub grocery list: ${inviteLink} (invite code ${household!.invite_code})`
    if (navigator.share) {
      try {
        await navigator.share({ title: 'WallHub', text, url: inviteLink })
        return
      } catch {
        /* cancelled: fall through to copy */
      }
    }
    await navigator.clipboard.writeText(text)
    toast('Invite copied')
  }

  return (
    <div className="page stack">
      <header className="page-head">
        <h1>Settings</h1>
      </header>

      <section className="card stack">
        <h2>Household</h2>
        {isOwner ? (
          <div className="row">
            <input className="grow" value={householdName} onChange={(e) => setHouseholdName(e.target.value)} />
            <button
              disabled={!householdName.trim() || householdName === household.name}
              onClick={() =>
                run(async () => {
                  must(await supabase.from('households').update({ name: householdName.trim() }).eq('id', household.id).select())
                  await refresh()
                  toast('Saved')
                })
              }
            >
              Rename
            </button>
          </div>
        ) : (
          <p>{household.name}</p>
        )}

        {isOwner && (
          <Link to="/settings/categories" className="settings-link">
            <span>Manage categories</span>
            <span className="muted">›</span>
          </Link>
        )}

        <h3>Invite family</h3>
        <p className="muted small">
          They create an account on their phone, choose “Join with a code”, and enter this code. Or send them the link.
        </p>
        <div className="row wrap">
          <code className="invite-code">{household.invite_code}</code>
          <button className="primary" onClick={shareInvite}>
            Share invite
          </button>
          {isOwner && (
            <button
              className="small"
              onClick={() =>
                confirm('Make a new code? The old one stops working.') &&
                run(async () => {
                  must(await supabase.rpc('regenerate_invite_code'))
                  await refresh()
                })
              }
            >
              New code
            </button>
          )}
        </div>

        <h3>Members</h3>
        <ul className="members">
          {members.map((m) => (
            <li key={m.id} className="row">
              <span className="grow">
                {m.display_name}
                {m.id === member.id && <span className="muted"> (you)</span>}
              </span>
              <span className="muted small">{m.role === 'owner' ? 'Owner' : 'Member'}</span>
              {isOwner && m.id !== member.id && (
                <button
                  className="small danger"
                  onClick={() =>
                    confirm(`Remove ${m.display_name} from the household?`) &&
                    run(async () => {
                      must(await supabase.from('users').delete().eq('id', m.id).select())
                    })
                  }
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="card stack">
        <h2>You</h2>
        <p className="muted small">{session?.user.email}</p>
        <div className="row">
          <input className="grow" value={myName} onChange={(e) => setMyName(e.target.value)} />
          <button
            disabled={!myName.trim() || myName === member.display_name}
            onClick={() =>
              run(async () => {
                must(await supabase.from('users').update({ display_name: myName.trim() }).eq('id', member.id).select())
                await refresh()
                toast('Saved')
              })
            }
          >
            Save name
          </button>
        </div>
        <button onClick={() => void signOut()}>Sign out</button>
      </section>

      <section className="card stack">
        <h2>Past lists</h2>
        {!history.length && <p className="muted small">Lists show up here after you tap “Finalize list”.</p>}
        <ul className="history">
          {history.map((h) => (
            <li key={h.id}>
              <div className="row">
                <button className="link grow left" onClick={() => setOpenHistory(openHistory === h.id ? null : h.id)}>
                  {h.name} <span className="muted small">· {h.item_count} items</span>
                </button>
                <button
                  className="small"
                  onClick={() =>
                    run(async () => {
                      const added = await rpcCount('load_history', { history_id: h.id })
                      // A loaded list starts in the default alphabetical order.
                      clearOrders()
                      toast(added ? `Added ${added} item${added === 1 ? '' : 's'} to the list` : 'Already on the list')
                    })
                  }
                >
                  Load
                </button>
              </div>
              {openHistory === h.id && (
                <p className="small muted">{h.items.map((i) => (i.quantity ? `${i.name} (${i.quantity})` : i.name)).join(', ')}</p>
              )}
            </li>
          ))}
        </ul>
      </section>

      <p className="muted small center">WallHub · Phase 1</p>
    </div>
  )
}
