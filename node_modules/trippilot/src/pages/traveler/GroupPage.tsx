import { useEffect, useState } from 'react'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { StatusBadge } from '../../components/StatusBadge'
import { activeTrip, getInventory, getItinerary, type ApiItem, type InventoryItem } from '../../services/tripService'
import { getItemVotes, getTripGroup, inviteToTripGroup, respondToTripGroup, voteOnAlternative, type TravelerGroup, type VoteTally } from '../../services/groupVoteService'

export function GroupPage() {
  const tripId = activeTrip.get()
  const [group, setGroup] = useState<TravelerGroup | null>(null)
  const [email, setEmail] = useState('')
  const [items, setItems] = useState<ApiItem[]>([])
  const [candidates, setCandidates] = useState<Record<string, InventoryItem[]>>({})
  const [votes, setVotes] = useState<Record<string, VoteTally[]>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    if (!tripId) return
    try {
      const [g, it, inv] = await Promise.all([getTripGroup(tripId), getItinerary(tripId), getInventory(tripId)])
      setGroup(g)
      setItems(it)
      const next: Record<string, InventoryItem[]> = {}
      for (const item of it) next[item.id] = inv.filter((x) => x.type === item.type && x.id !== item.id).sort((a, b) => a.price - b.price).slice(0, 3)
      setCandidates(next)
      const entries = await Promise.all(it.map(async (item) => [item.id, (await getItemVotes(tripId, item.id)).tally] as const))
      setVotes(Object.fromEntries(entries))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load group data.')
    }
  }

  useEffect(() => {
    void load()
    const h = () => void load()
    window.addEventListener('trippilot:trip-updated', h)
    return () => window.removeEventListener('trippilot:trip-updated', h)
  }, [tripId])

  const invite = async () => {
    if (!tripId || !email.trim()) return
    setBusy(true); setError('')
    try { await inviteToTripGroup(tripId, email.trim()); setEmail(''); await load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to send invitation.') }
    finally { setBusy(false) }
  }
  const respond = async (response: 'accept' | 'decline') => {
    if (!tripId) return
    try { await respondToTripGroup(tripId, response); await load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to respond.') }
  }
  const vote = async (itemId: string, candidateId: string, value: 'YES' | 'NO') => {
    if (!tripId) return
    try { await voteOnAlternative(tripId, itemId, candidateId, value); const result = await getItemVotes(tripId, itemId); setVotes((x) => ({ ...x, [itemId]: result.tally })) }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to record vote.') }
  }

  const pending = group?.participants.find((p) => p.status === 'INVITED')
  return <section className="page-stack">
    <div><p className="eyebrow">Trip collaboration</p><h1 className="page-title">Plan together.</h1><p className="page-copy">Invite travelers, respond to invitations, and vote on verified alternatives. Votes never change the itinerary automatically.</p></div>
    {error && <p className="auth-error">{error}</p>}
    {pending && <Card><h2>Group invitation</h2><p>{pending.user.name} invited you to <strong>{group?.name}</strong>.</p><div className="flex gap-2"><Button onClick={() => void respond('accept')}>Accept</Button><Button variant="ghost" onClick={() => void respond('decline')}>Decline</Button></div></Card>}
    <Card><div className="flex items-center justify-between gap-4"><div><p className="eyebrow">Participants</p><h2>{group?.name || 'Trip group'}</h2></div><span>{group?.participants.length || 0} travelers</span></div><div className="space-y-3 mt-5">
      {group?.participants.map((p) => <div className="flex items-center justify-between gap-4" key={p.id}><div><strong>{p.user.name}</strong><div className="page-copy">{p.user.email}</div></div><StatusBadge status={p.status === 'CONFIRMED' ? 'confirmed' : p.status === 'DECLINED' ? 'cancelled' : 'pending'} /></div>)}
    </div><div className="mt-6 flex gap-2"><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="traveler@example.com" type="email" className="tp-input"/><Button disabled={busy} onClick={() => void invite()}>{busy ? 'Sending…' : 'Invite'}</Button></div></Card>
    <Card><p className="eyebrow">Activity decisions</p><h2>Vote on alternatives</h2><p className="page-copy">A winning vote is only a suggestion for the trip owner/operator to confirm.</p><div className="space-y-5 mt-5">
      {items.map((item) => <div key={item.id} className="border-t border-[var(--tp-border)] pt-4"><strong>{item.title}</strong><p className="page-copy">{item.location}</p>
        {(candidates[item.id] || []).map((c) => { const t = (votes[item.id] || []).find((v) => v.candidateInventoryId === c.id); return <div className="mt-3 flex items-center justify-between gap-3" key={c.id}><div><strong>{c.title}</strong><div className="page-copy">₹{c.price.toLocaleString()} · {c.vendor.name}</div><small>Yes {t?.yes || 0} · No {t?.no || 0}</small></div><div className="flex gap-2"><Button variant="ghost" onClick={() => void vote(item.id, c.id, 'YES')}>Yes</Button><Button variant="ghost" onClick={() => void vote(item.id, c.id, 'NO')}>No</Button></div></div> })}
      </div>)}
    </div></Card>
  </section>
}
