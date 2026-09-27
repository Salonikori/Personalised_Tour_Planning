import { useEffect, useState } from 'react'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { activeTrip, addChecklistItem, getChecklist, getItinerary, getTrip, toggleChecklistItem, type ApiItem, type ApiTrip, type ChecklistCategory, type ChecklistItem } from '../../services/tripService'
import { downloadItineraryIcs } from '../../lib/ics'

const categoryTagLabels: Record<ChecklistCategory, string> = { DOCUMENT: 'Document', PACKING: 'Packing', REMINDER: 'Reminder' }

function CategoryTag({ category }: { category: ChecklistCategory }) {
  return <span className={`tp-chip category-tag category-tag-${category.toLowerCase()}`}>{categoryTagLabels[category]}</span>
}

function ChecklistSection({ title, description, items, onToggle, onAdd, busy }: {
  title: string
  description: string
  items: ChecklistItem[]
  onToggle: (item: ChecklistItem) => void
  onAdd: (label: string) => void
  busy: boolean
}) {
  const [draft, setDraft] = useState('')
  const submit = () => { const label = draft.trim(); if (!label) return; onAdd(label); setDraft('') }
  const done = items.filter((item) => item.isDone).length
  return <Card className="checklist-card">
    <div className="flex items-center justify-between gap-4"><div><p className="eyebrow">{description}</p><h2>{title}</h2></div><span>{done}/{items.length} done</span></div>
    <div className="checklist-items space-y-3 mt-5">
      {items.length === 0 && <p className="page-copy">Nothing here yet.</p>}
      {items.map((item) => <label className="checklist-item flex items-center gap-3" key={item.id}>
        <input checked={item.isDone} className="tp-checkbox" onChange={() => onToggle(item)} type="checkbox" />
        <span className={`checklist-item-label${item.isDone ? ' is-done' : ''}`}>{item.label}</span>
        <CategoryTag category={item.category} />
      </label>)}
    </div>
    <div className="mt-6 flex gap-2">
      <input className="tp-input" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder="Add item" value={draft} />
      <Button disabled={busy} onClick={submit}>Add item</Button>
    </div>
  </Card>
}

export function PreparePage() {
  const [items, setItems] = useState<ChecklistItem[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [trip, setTrip] = useState<ApiTrip | null>(null)
  const [itineraryItems, setItineraryItems] = useState<ApiItem[]>([])
  const tripId = activeTrip.get()

  const load = () => { if (!tripId) return; void getChecklist(tripId).then(setItems).catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load checklist.')) }
  const loadItinerary = () => { if (!tripId) return; void Promise.all([getTrip(tripId), getItinerary(tripId)]).then(([nextTrip, nextItems]) => { setTrip(nextTrip); setItineraryItems(nextItems) }).catch(() => undefined) }
  useEffect(() => { load(); loadItinerary(); window.addEventListener('trippilot:trip-updated', load); window.addEventListener('trippilot:trip-updated', loadItinerary); return () => { window.removeEventListener('trippilot:trip-updated', load); window.removeEventListener('trippilot:trip-updated', loadItinerary) } }, [tripId])
  const confirmedCount = itineraryItems.filter((item) => item.status === 'CONFIRMED').length

  const toggle = async (item: ChecklistItem) => {
    if (!tripId) return
    setError('')
    try { const updated = await toggleChecklistItem(tripId, item.id, !item.isDone); setItems((current) => current.map((entry) => (entry.id === updated.id ? updated : entry))) }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to update item.') }
  }

  const add = async (category: ChecklistCategory, label: string) => {
    if (!tripId) return
    setBusy(true); setError('')
    try { const item = await addChecklistItem(tripId, category, label); setItems((current) => [...current, item]) }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to add item.') }
    finally { setBusy(false) }
  }

  const documents = items.filter((item) => item.category === 'DOCUMENT')
  const packing = items.filter((item) => item.category !== 'DOCUMENT')

  return <section className="page-stack">
    <div className="flex items-center justify-between gap-4">
      <div><p className="eyebrow">Prepare</p><h1 className="page-title">Get ready to go.</h1><p className="page-copy">Auto-generated from your itinerary and the weather forecast — check items off, or add your own.</p></div>
      {confirmedCount > 0 && <Button onClick={() => downloadItineraryIcs(trip, itineraryItems)} type="button" variant="secondary">Download itinerary</Button>}
    </div>
    {error && <p className="auth-error">{error}</p>}
    <ChecklistSection busy={busy} description="Before you travel" items={documents} onAdd={(label) => void add('DOCUMENT', label)} onToggle={(item) => void toggle(item)} title="Documents" />
    <ChecklistSection busy={busy} description="What to bring" items={packing} onAdd={(label) => void add('PACKING', label)} onToggle={(item) => void toggle(item)} title="Packing list" />
  </section>
}
