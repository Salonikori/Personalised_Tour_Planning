import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { InventoryCompareModal } from '../../components/InventoryCompareModal'
import { activeTrip, applyItineraryTemplate, generateItinerary, getInventory, getItineraryTemplates, getTrip, notifyTripUpdated, submitTripForReview, swapItineraryItem, updateItineraryItem, type ApiTrip, type GeneratedComposer, type GeneratedComposerItem, type InventoryItem, type ItineraryTemplate } from '../../services/tripService'
import { discoverDestination, summarizeDiscovery, type DataStatus, type DiscoveryResult } from '../../services/travelDiscoveryService'
import { destinationImage } from '../../lib/destinationImages'

const iconFor = (type: string) => ({ FLIGHT: '✈', HOTEL: '⌂', ACTIVITY: '✦', TRANSFER: '→' }[type] || '◈')
// Same fallback photo pool the onboarding "Places & activities" step uses, so an itinerary item
// that has no verified/curated photo of its own (e.g. a hotel or flight leg) still shows
// something on-brand instead of a blank thumbnail.
const fallbackItemImageFor = (index: number) => `https://images.unsplash.com/photo-${['1500530855697-b586d89ba3ee','1524492412937-b28074a5d7da','1530789253388-582c481c54b0'][index % 3]}?auto=format&fit=crop&w=900&q=80`
const timeFor = (value: string) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

// Reuses the same tp-status pill classes StatusBadge already renders for booking statuses -
// no new CSS, just a different label set for LIVE/CURATED/SEARCHED/ESTIMATED/UNAVAILABLE data.
const dataStatusClassFor = (status: string) => ({ LIVE: 'tp-status-confirmed', SEARCHED: 'tp-status-confirmed', ESTIMATED: 'tp-status-at-risk', CURATED: 'tp-status-pending', UNAVAILABLE: 'tp-status-cancelled' }[status] || 'tp-status-pending')
const dataStatusLabelFor = (status: string) => ({ LIVE: 'Live', SEARCHED: 'Live', ESTIMATED: 'Estimated', CURATED: 'Estimated', UNAVAILABLE: 'Unavailable' }[status] || 'Estimated')
const DataStatusBadge = ({ status }: { status: DataStatus | string }) => <span className={`tp-status ${dataStatusClassFor(status)}`}>{dataStatusLabelFor(status)}</span>

type DiscoveryStage = 'idle' | 'discovering' | 'found' | 'composing'

// A short pause so the "Found X hotels / places / activities" panel is actually readable before
// the view moves on to composing - the numbers themselves are always the real discovery response,
// never a fake/simulated count; this only paces how long we sit on them.
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function ComposerPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useTranslation()
  const [result, setResult] = useState<GeneratedComposer | null>(null)
  const [trip, setTrip] = useState<ApiTrip | null>(null)
  const [openDays, setOpenDays] = useState<number[]>([])
  const [openReasons, setOpenReasons] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [busyItemId, setBusyItemId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [reviewBusy, setReviewBusy] = useState(false)
  // Backs the "compare candidates before swapping" modal, replacing the old window.prompt list.
  const [compareOpen, setCompareOpen] = useState(false)
  const [compareCandidates, setCompareCandidates] = useState<InventoryItem[]>([])
  const [compareTarget, setCompareTarget] = useState<GeneratedComposerItem | null>(null)
  const [compareBusyId, setCompareBusyId] = useState<string | null>(null)
  // Result of the live, destination-aware discovery pass (travelDiscoveryEngineService, via
  // travelDiscoveryService.ts) that now runs ahead of itinerary composition: destination
  // resolution -> live hotel/flight/place/activity/transfer search -> normalization all happen
  // server-side before this trip's itinerary is composed. Best-effort - if it fails, composition
  // still proceeds from verified inventory exactly as before; nothing here is ever fabricated.
  const [discovery, setDiscovery] = useState<DiscoveryResult | null>(null)
  const [discoveryNote, setDiscoveryNote] = useState('')
  const [discoveryStage, setDiscoveryStage] = useState<DiscoveryStage>('idle')
  // Predefined ready-made itineraries: a fixed, browsable template library fetched once and
  // rendered as cards the traveler can pick from instead of only the empty-selection
  // auto-generate path below.
  const [templates, setTemplates] = useState<ItineraryTemplate[]>([])
  const [templateBusyId, setTemplateBusyId] = useState<string | null>(null)
  useEffect(() => { void getItineraryTemplates().then(setTemplates).catch(() => setTemplates([])) }, [])
  // Free-text "regenerate with these changes" box shown once an itinerary exists, so a traveler
  // can nudge the same composition pass (e.g. "less walking", "swap in a beach day") instead
  // of only ever getting a from-scratch reshuffle.
  const [changeRequest, setChangeRequest] = useState('')

  const generate = async (changes?: string) => {
    const tripId = activeTrip.get()
    if (!tripId) { setError(t('composer.completeOnboarding')); return }
    setLoading(true); setError(''); setDiscoveryNote(''); setDiscovery(null); setDiscoveryStage('discovering')
    try {
      const trip = await getTrip(tripId)
      setTrip(trip)
      let discoveryResult: DiscoveryResult | null = null
      try {
        // The trip's own destination - entered by the traveler during onboarding - is what gets
        // sent to the backend here. The backend resolves it (never a default/other-city fallback)
        // and runs live discovery specifically for that destination, so the panel below genuinely
        // changes from one destination to the next.
        discoveryResult = await discoverDestination({ destination: trip.destination, checkIn: trip.startDate.slice(0, 10), checkOut: trip.endDate.slice(0, 10), budget: trip.budget, interests: trip.travelStyle ? [trip.travelStyle] : undefined })
        setDiscovery(discoveryResult)
        setDiscoveryStage('found')
        await pause(700)
      } catch {
        // Live discovery is best-effort; composition still runs from verified inventory below.
        setDiscovery(null)
        setDiscoveryNote(t('composer.discoveryUnavailable'))
      }
      setDiscoveryStage('composing')
      const next = await generateItinerary(tripId, discoveryResult ? summarizeDiscovery(discoveryResult) : undefined, changes)
      setResult(next); setOpenDays(next.days.map((day) => day.day)); setChangeRequest('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('composer.generateError'))
    } finally {
      setLoading(false); setDiscoveryStage('idle')
    }
  }
  // "Create my trip" in onboarding now goes straight to a generated itinerary here instead of
  // landing on an extra "ready to compose" prompt the traveler has to click through. Only fires
  // once, right after a fresh trip is created (navigate(...,{state:{autoGenerate:true}})); the
  // state is cleared immediately after so refreshing or navigating back here never re-triggers
  // (and never silently wipes) an already-composed itinerary.
  useEffect(() => {
    if ((location.state as { autoGenerate?: boolean } | null)?.autoGenerate) {
      navigate(location.pathname, { replace: true, state: null })
      void generate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Applies a named preset instead of composing from scratch: seeds the trip/user profile with
  // the template's travelStyle/tripType/pace/interests server-side, then the backend runs that
  // through the exact same verified-inventory + composition pipeline used by generate().
  const applyTemplateToTrip = async (template: ItineraryTemplate) => {
    const tripId = activeTrip.get()
    if (!tripId) { setError(t('composer.completeOnboarding')); return }
    setTemplateBusyId(template.id); setError(''); setDiscovery(null); setDiscoveryNote('')
    try {
      const loadedTrip = await getTrip(tripId)
      setTrip(loadedTrip)
      const next = await applyItineraryTemplate(tripId, template.id)
      setResult(next); setOpenDays(next.days.map((day) => day.day))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('composer.generateError'))
    } finally {
      setTemplateBusyId(null)
    }
  }
  const toggleDay = (day: number) => setOpenDays((days) => days.includes(day) ? days.filter((item) => item !== day) : [...days, day])
  const toggleReason = (id: string) => setOpenReasons((reasons) => reasons.includes(id) ? reasons.filter((item) => item !== id) : [...reasons, id])
  const updateComposerItem = (id: string, patch: Partial<GeneratedComposerItem>) => setResult((current) => current ? { ...current, days: current.days.map((day) => ({ ...day, items: day.items.map((entry) => entry.id === id ? { ...entry, ...patch } : entry) })) } : current)
  const editItem = async (item: GeneratedComposerItem) => { const value = window.prompt('New start time (YYYY-MM-DDTHH:mm)', item.startTime.slice(0, 16)); if (!value) return; const start = new Date(value); const end = new Date(start.getTime() + (new Date(item.endTime).getTime() - new Date(item.startTime).getTime())); setBusyItemId(item.id); setError(''); try { const response = await updateItineraryItem(item.id, { startTime: start.toISOString(), endTime: end.toISOString() }); updateComposerItem(item.id, { startTime: response.item.startTime, endTime: response.item.endTime }); notifyTripUpdated() } catch (reason) { setError(reason instanceof Error ? reason.message : t('composer.timeConflict')) } finally { setBusyItemId(null) } }
  // Opens the swap-comparison modal with 2-3 same-type candidates (cheapest first) instead of a
  // window.prompt numbered list; the actual swap happens once the traveler picks a card below.
  const swapItem = async (item: GeneratedComposerItem) => {
    const tripId = activeTrip.get(); if (!tripId) return
    setError('')
    try { const inventory = await getInventory(tripId); const candidates = inventory.filter((entry) => entry.type === item.type).sort((a, b) => a.price - b.price).slice(0, 3); setCompareCandidates(candidates); setCompareTarget(item); setCompareOpen(true) }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('composer.inventoryError')) }
  }
  const closeCompare = () => { setCompareOpen(false); setCompareTarget(null); setCompareBusyId(null) }
  const chooseCandidate = async (selected: InventoryItem) => {
    if (!compareTarget) return
    setCompareBusyId(selected.id); setBusyItemId(compareTarget.id); setError('')
    try { const response = await swapItineraryItem(compareTarget.id, selected.id); updateComposerItem(compareTarget.id, { type: response.item.type, title: response.item.title, location: response.item.location, cost: response.item.cost, vendor: selected.vendor.name, reasoning: t('composer.swappedNote') }); notifyTripUpdated(); closeCompare() }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('composer.swapError')); setCompareBusyId(null) }
    finally { setBusyItemId(null) }
  }

  const submitForReview = async () => { if (!activeTrip.get()) return; setReviewBusy(true); setError(''); try { await submitTripForReview(activeTrip.get() as string); const refreshed = await getTrip(activeTrip.get() as string); setTrip(refreshed) } catch (reason) { setError(reason instanceof Error ? reason.message : t('composer.submitReviewError')) } finally { setReviewBusy(false) } }

  const flightsAvailable = Boolean(discovery && discovery.flights.length > 0)
  const flightStatus: DataStatus | 'UNAVAILABLE' = discovery?.flights[0]?.meta.status ?? 'UNAVAILABLE'
  // The backend now records exactly why flight pricing came back empty (missing credentials,
  // no traveler origin, or an unmapped/unresolved destination) instead of a silent gap - surface
  // that reason directly rather than just showing an "Unavailable" badge with no explanation.
  const flightUnavailableReason = discovery?.providerReport.find((provider) => provider.name.toLowerCase().includes('flight'))?.note

  const discoveryPanel = (discoveryStage === 'discovering' || discoveryStage === 'found' || discoveryStage === 'composing') && (
    <Card className="composer-empty">
      <span>✦</span>
      <h2>
        {discoveryStage === 'discovering' && t('composer.discovering')}
        {discoveryStage === 'found' && t('composer.found')}
        {discoveryStage === 'composing' && t('composer.composing')}
      </h2>
      {discoveryStage === 'discovering' && <p>{t('composer.resolving')}</p>}
      {(discoveryStage === 'found' || discoveryStage === 'composing') && discovery && (
        <div className="wallet-stats" style={{ width: '100%' }}>
          <div className="wallet-stat"><span>{t('composer.destinationResolved')}</span><strong>{discovery.destination.displayName}</strong></div>
          <div className="wallet-stat"><span>{t('composer.found')} {discovery.hotels.length} {t('composer.hotels', { count: discovery.hotels.length })}</span><DataStatusBadge status={discovery.hotels[0]?.meta.status ?? 'UNAVAILABLE'} /></div>
          <div className="wallet-stat"><span>{t('composer.found')} {discovery.places.length} {t('composer.places', { count: discovery.places.length })}</span><DataStatusBadge status={discovery.places[0]?.meta.status ?? 'UNAVAILABLE'} /></div>
          <div className="wallet-stat"><span>{t('composer.found')} {discovery.activities.length} {t('composer.activities', { count: discovery.activities.length })}</span><DataStatusBadge status={discovery.activities[0]?.meta.status ?? 'UNAVAILABLE'} /></div>
          {discovery.transfers.length > 0 && <div className="wallet-stat"><span>{t('composer.found')} {discovery.transfers.length} {t('composer.transferOptions', { count: discovery.transfers.length })}</span><DataStatusBadge status={discovery.transfers[0]?.meta.status ?? 'UNAVAILABLE'} /></div>}
          <div className="wallet-stat"><span>{t('composer.flightData')}: {flightsAvailable ? t('composer.available') : t('composer.unavailable')}</span><DataStatusBadge status={flightStatus} /></div>
          {!flightsAvailable && <p className="page-copy">{t('composer.pricingUnavailable')}{flightUnavailableReason ? ` — ${flightUnavailableReason}` : '.'}</p>}
        </div>
      )}
      {discoveryStage === 'composing' && <p>{t('composer.selecting')}</p>}
    </Card>
  )

  // Shared "predefined package trip" browser - rendered both before any itinerary exists (as an
  // alternative starting point) and again below the regenerate-with-changes box once an
  // itinerary has been composed, so a traveler can still switch to a ready-made shape later.
  const templatesCard = templates.length > 0 && <Card className="composer-templates"><p className="eyebrow">{t('composer.orStartFromTemplate')}</p><h2>{t('composer.predefinedTemplates')}</h2><p className="page-copy">{t('composer.pickProvenShape')}</p><div className="tp-option-grid">{templates.map((template) => <div className="tp-template-card" key={template.id}><div className="tp-template-card-top"><span className="tp-template-icon" aria-hidden>{template.icon}</span><div><strong>{template.name}</strong><span className="page-copy">{template.tagline}</span></div></div><p className="page-copy">{template.description}</p><div className="tp-template-meta"><span>{template.recommendedDays.min}–{template.recommendedDays.max} {t('composer.days')}</span><span>{template.recommendedBudgetTier}</span></div><Button disabled={loading || templateBusyId !== null} onClick={() => void applyTemplateToTrip(template)} type="button" variant="secondary">{templateBusyId === template.id ? t('composer.composing') : t('composer.useTemplate')}</Button></div>)}</div></Card>

  return <section className="composer-page"><div className="composer-heading"><p className="eyebrow">{t('composer.eyebrow')}</p><h1 className="page-title">{t('composer.title')}</h1><p className="page-copy">{t('composer.copy')}</p></div>
    {!result && !loading && <Card className="composer-empty"><span>✦</span><h2>{t('composer.ready')}</h2><p>{t('composer.readyCopy')}</p>{discoveryNote && <p className="page-copy">{discoveryNote}</p>}{error && <p className="auth-error">{error}</p>}<Button disabled={loading || Boolean(templateBusyId)} onClick={() => void generate()} type="button">{t('composer.generate')}</Button></Card>}
    {!result && !loading && templatesCard}
    {!result && loading && discoveryPanel}
    {result && <><Card className="composer-budget"><div><span className="composer-budget-label">{t('composer.plannedSpend')}</span><strong>₹{result.budget.plannedCost.toLocaleString()}</strong><span> {t('composer.of')} ₹{result.budget.budget.toLocaleString()} {t('composer.budget')}</span></div><div className="composer-budget-meter" aria-label={`${result.budget.percentageUsed}% ${t('composer.ofBudgetUsed')}`}><span style={{ width: `${Math.min(100, result.budget.percentageUsed)}%` }} /></div><span className="composer-budget-remaining">₹{result.budget.remainingBudget.toLocaleString()} {t('composer.left')} · {result.preferenceScore}% {t('composer.match')}</span>{discovery && <span className="composer-budget-remaining">{t('composer.liveDiscovery')}: {discovery.destination.displayName} · {discovery.curatedMode ? t('composer.curatedData') : `${discovery.providerReport.filter((provider) => provider.used).length} ${t('composer.sources')}`} · {discovery.places.length + discovery.activities.length} {t('composer.placesActivities')} · {discovery.transfers.length} {t('composer.transfers')}</span>}{!discovery && discoveryNote && <span className="composer-budget-remaining">{discoveryNote}</span>}</Card>{error && <p className="auth-error">{error}</p>}<div className="composer-days">{result.days.map((day) => { const isDayOpen = openDays.includes(day.day); return <section className="composer-day" key={day.day}><button aria-expanded={isDayOpen} className="composer-day-toggle" onClick={() => toggleDay(day.day)} type="button"><span className="composer-day-number">{t('composer.day')} {day.day}</span><span><strong>{t('composer.personalized')}</strong><small>{day.items.length} {t('composer.verifiedStops')}</small></span><span className="composer-chevron">{isDayOpen ? '−' : '+'}</span></button>{isDayOpen && <div className="composer-timeline">{day.items.map((item, itemIndex) => { const reasonOpen = openReasons.includes(item.id); const isBusy = busyItemId === item.id; const itemImage = item.image || destinationImage(trip?.destination || '', itemIndex) || fallbackItemImageFor(itemIndex); return <article className="composer-item" key={item.id}><div className="composer-time">{timeFor(item.startTime)}</div><div className="composer-line"><span>{iconFor(item.type)}</span></div><Card className="composer-item-card"><div className="composer-item-top"><img alt="" className="composer-item-image" loading="lazy" src={itemImage} /><div className="composer-item-heading"><span className="composer-item-type">{item.type} · {item.vendor}</span><h2>{item.title}</h2></div><strong>₹{item.cost.toLocaleString()}</strong></div><p>{item.location} · {t('composer.ends')} {timeFor(item.endTime)}</p><div className="composer-item-actions"><Button aria-label={`${t('composer.edit')} ${item.title}`} className="tp-icon-button" disabled={isBusy} onClick={() => void editItem(item)} title={t('composer.edit')} type="button" variant="ghost">✎</Button><Button aria-label={`${t('composer.swap')} ${item.title}`} className="tp-icon-button" disabled={isBusy} onClick={() => void swapItem(item)} title={t('composer.swapHeading')} type="button" variant="ghost">⇄</Button><button aria-expanded={reasonOpen} className="composer-why-button" onClick={() => toggleReason(item.id)} type="button">✦ {t('composer.why')} <span>{reasonOpen ? '−' : '+'}</span></button></div>{reasonOpen && <div className="composer-reasoning"><span>{item.preferenceScore}% {t('composer.preferenceMatch')}</span><p>{item.reasoning}</p></div>}</Card></article> })}</div>}</section> })}</div>{loading ? discoveryPanel : <><Card className="composer-regenerate-changes"><p className="eyebrow">{t('composer.notQuiteRight')}</p><h2>{t('composer.regenerateWithChanges')}</h2><p className="page-copy">{t('composer.tellTripPilot')}</p><textarea className="tp-textarea" disabled={loading} onChange={(e) => setChangeRequest(e.target.value)} placeholder={t('composer.describeChanges')} rows={3} value={changeRequest} /><div className="composer-regenerate"><Button disabled={loading || !changeRequest.trim()} onClick={() => void generate(changeRequest.trim())} type="button">{t('composer.regenerateWithTheseChanges')}</Button><Button disabled={loading} onClick={() => void generate()} type="button" variant="secondary">{t('composer.regenerate')}</Button></div></Card>{templatesCard}</>}</>}
    {result && <Card className="composer-review-card"><div><p className="eyebrow">{t('composer.approvalBooking')}</p><h2>{trip?.approvalStatus === 'APPROVED' ? t('composer.tripApproved') : trip?.approvalStatus === 'PENDING' ? t('composer.waitingApproval') : trip?.approvalStatus === 'CHANGES_REQUESTED' ? t('composer.changesRequested') : t('composer.readyForReview')}</h2><p className="page-copy">{trip?.adminFeedback || t('composer.finalizeAndSubmit')}</p></div>{trip?.approvalStatus === 'APPROVED' ? <Button onClick={() => navigate('/traveler/booking')} type="button">{t('composer.continueToPayment')}</Button> : trip?.approvalStatus === 'PENDING' ? <Button disabled type="button" variant="secondary">{t('composer.awaitingReview')}</Button> : <Button disabled={reviewBusy} onClick={() => void submitForReview()} type="button">{reviewBusy ? t('composer.submitting') : t('composer.submitForApproval')}</Button>}</Card>}
    <InventoryCompareModal baseItem={compareTarget || undefined} busyId={compareBusyId} candidates={compareCandidates} heading={compareTarget ? `Swap "${compareTarget.title}"` : t('composer.swap')} isOpen={compareOpen} onChoose={(selected) => void chooseCandidate(selected)} onClose={closeCompare} />
  </section>
}
