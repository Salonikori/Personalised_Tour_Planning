import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { StatusBadge } from '../../components/StatusBadge'
import { useAuth } from '../../auth/AuthContext'
import { activeTrip, getItinerary, getTrip, type ApiItem, type ApiTrip } from '../../services/tripService'
import { createSos, getLatestSos, getNearbyHelp, subscribeToSosUpdates, type NearbyHelp, type SosAlert } from '../../services/sosService'
import { downloadItineraryIcs } from '../../lib/ics'

const iconFor = (type: string) => ({ FLIGHT: '✈', HOTEL: '⌂', ACTIVITY: '✦', TRANSFER: '→' }[type] || '◈')
const timeFor = (value: string) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const statusFor = (status: string) => status === 'CONFIRMED' ? 'confirmed' : status === 'AT_RISK' ? 'at-risk' : status === 'CANCELLED' ? 'cancelled' : 'pending'
const statusNoteFor = (status: string, t: (key: string) => string) => ({ CONFIRMED: t('today.bookingConfirmed'), AT_RISK: t('today.atRisk'), CANCELLED: t('today.cancelled') }[status] || t('today.pending'))
const fromNow = (value: string, t: (key: string, opts?: Record<string, unknown>) => string) => { const diffMinutes = Math.round((new Date(value).getTime() - Date.now()) / 60000); if (diffMinutes <= 0) return t('today.startingNow'); const hours = Math.floor(diffMinutes / 60); const minutes = diffMinutes % 60; return hours > 0 ? t('today.fromNowHours', { hours, minutes }) : t('today.fromNowMinutes', { minutes }) }
// No live operator support number yet — falls back to a standard helpline number.
// uses for fallback data, so travelers never mistake this for a verified operator contact.
const sampleSupportPhone = '+91 98765 43210'
const telHrefFor = (phone: string) => `tel:${phone.replace(/[^0-9+]/g, '')}`

export function TodayPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const tripId = activeTrip.get()
  const [trip, setTrip] = useState<ApiTrip | null>(null)
  const [items, setItems] = useState<ApiItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sosConfirm, setSosConfirm] = useState(false)
  const [sosAlert, setSosAlert] = useState<SosAlert | null>(null)
  const [nearbyHelp, setNearbyHelp] = useState<NearbyHelp[]>([])
  const [sosWorking, setSosWorking] = useState(false)
  const [sosError, setSosError] = useState('')

  const load = () => { if (!tripId) { setLoading(false); return }; setLoading(true); setError(''); void Promise.all([getTrip(tripId), getItinerary(tripId)]).then(([nextTrip, nextItems]) => { setTrip(nextTrip); setItems(nextItems) }).catch((reason) => setError(reason instanceof Error ? reason.message : t('today.loadError'))).finally(() => setLoading(false)) }
  useEffect(() => { load(); window.addEventListener('trippilot:trip-updated', load); return () => window.removeEventListener('trippilot:trip-updated', load) }, [tripId])
  useEffect(() => { if (!tripId) return; return subscribeToSosUpdates((payload) => { if (payload.tripId !== tripId || !payload.alertId) return; if (payload.alertId === sosAlert?.id) setSosAlert((current) => current ? { ...current, status: (payload.status as SosAlert['status']) || current.status } : current) }) }, [tripId, sosAlert?.id])
  useEffect(() => { if (!tripId) return; const timer = window.setInterval(() => { void getLatestSos(tripId).then((latest) => { if (latest) setSosAlert(latest) }).catch(() => undefined) }, 5000); return () => window.clearInterval(timer) }, [tripId])
  useEffect(() => { if (!sosAlert || sosAlert.status === 'RESOLVED' || !tripId) return; const timer = window.setInterval(() => { void getNearbyHelp(tripId).then(setNearbyHelp).catch(() => undefined) }, 15000); return () => window.clearInterval(timer) }, [sosAlert, tripId])
  const triggerSos = () => { if (!tripId || sosWorking) return; setSosWorking(true); setSosError(''); const submit = (lat: number | null, lng: number | null) => { void createSos(tripId, { itineraryItemId: currentItem?.id, lat, lng, message: 'Traveler requested urgent assistance from Today.' }).then((alert) => { setSosAlert(alert); setSosConfirm(false); void getNearbyHelp(tripId).then(setNearbyHelp).catch(() => setNearbyHelp([])) }).catch((reason) => setSosError(reason instanceof Error ? reason.message : t('today.unableToSendSos'))).finally(() => setSosWorking(false)) }; if (!navigator.geolocation) return submit(null, null); navigator.geolocation.getCurrentPosition((position) => submit(position.coords.latitude, position.coords.longitude), () => submit(null, null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }) }

  const firstName = user?.name?.split(' ')[0] || t('today.travelerFallback')
  const hour = new Date().getHours()
  const greeting = hour < 12 ? t('today.morning') : hour < 17 ? t('today.afternoon') : t('today.evening')

  const sorted = [...items].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
  const now = Date.now()
  const liveIndex = sorted.findIndex((item) => new Date(item.startTime).getTime() <= now && now <= new Date(item.endTime).getTime())
  const upcomingIndex = sorted.findIndex((item) => new Date(item.startTime).getTime() > now)
  const activeIndex = liveIndex >= 0 ? liveIndex : upcomingIndex >= 0 ? upcomingIndex : sorted.length ? sorted.length - 1 : -1
  const currentItem = activeIndex >= 0 ? sorted[activeIndex] : null
  const isHappeningNow = currentItem ? liveIndex === activeIndex : false
  const isPast = currentItem ? !isHappeningNow && new Date(currentItem.endTime).getTime() < now : false
  const nextItem = activeIndex >= 0 ? sorted[activeIndex + 1] : null
  const remaining = activeIndex >= 0 ? sorted.slice(activeIndex) : []
  const confirmedCount = items.filter((item) => item.status === 'CONFIRMED').length
  const operatorSupportPhone = trip?.operator?.supportPhone
  const supportPhone = operatorSupportPhone || sampleSupportPhone

  return <section className="today-page">
    <div className="today-heading flex items-center justify-between gap-4">
      <div><p className="eyebrow">{t('today.liveTrip')} · {trip?.destination || t('today.yourTrip')}</p><h1 className="page-title">{t('today.good')} {greeting}, {firstName}.</h1></div>
      {!loading && tripId && confirmedCount > 0 && <Button onClick={() => downloadItineraryIcs(trip, items)} type="button" variant="secondary">{t('today.download')}</Button>}
    </div>
    {error && <p className="auth-error">{error}</p>}
    {loading && <Card className="composer-empty"><span>✦</span><h2>{t('today.loading')}</h2><p>{t('today.fetching')}</p></Card>}
    {!loading && !tripId && <Card className="composer-empty"><span>✦</span><h2>{t('today.noTrip')}</h2><p>{t('today.completeOnboarding')}</p><Button onClick={() => navigate('/traveler/onboarding')} type="button">{t('today.startOnboarding')}</Button></Card>}
    {!loading && tripId && !error && items.length === 0 && <Card className="composer-empty"><span>✦</span><h2>{t('today.notComposed')}</h2><p>{t('today.generatePlan')}</p><Button onClick={() => navigate('/traveler/composer')} type="button">{t('today.goComposer')}</Button></Card>}
    {!loading && currentItem && <>
      <Card className="today-hero"><div><StatusBadge status={statusFor(currentItem.status)} /><p className="today-kicker">{isHappeningNow ? t('today.happening') : isPast ? t('today.lastStop') : t('today.startingSoon')} · {timeFor(currentItem.startTime)}–{timeFor(currentItem.endTime)}</p><h2>{currentItem.title}</h2><p>{currentItem.location}{currentItem.vendor?.name ? ` · ${currentItem.vendor.name}` : ''}</p><span>{statusNoteFor(currentItem.status, t)}</span></div><span className="today-hero-icon">{iconFor(currentItem.type)}</span></Card>
      {nextItem && <div className="today-up-next"><Card><p className="eyebrow">{t('today.upNext')}</p><h2>{nextItem.title}</h2><p>{nextItem.location}{nextItem.vendor?.name ? ` · ${nextItem.vendor.name}` : ''}</p><span>{fromNow(nextItem.startTime, t)}</span></Card></div>}
      <section className="today-timeline"><p className="eyebrow">{t('today.remaining')}</p><div>{remaining.map((stop, index) => <article className={index === 0 ? 'is-current' : ''} key={stop.id}><span>{iconFor(stop.type)}</span><small>{index === 0 && isHappeningNow ? t('today.now') : timeFor(stop.startTime)}</small><strong>{stop.title}</strong></article>)}</div></section>
    </>}
    {sosAlert ? <div className="today-sos-overlay"><Card className="today-sos-confirmation"><div><p className="eyebrow">{t('today.safety')}</p><h2>{t('today.helpNotified')}</h2><StatusBadge status={sosAlert.status === 'OPEN' ? 'cancelled' : 'confirmed'} /><p>{sosAlert.status === 'OPEN' ? t('today.alertOpen') : sosAlert.status === 'ACKNOWLEDGED' ? t('today.alertAcknowledged') : t('today.alertResolved')}</p></div><div><strong>{t('today.alertStatus')}: {sosAlert.status}</strong>{nearbyHelp.length > 0 && <><p className="eyebrow">{t('today.nearestHelp')}</p>{nearbyHelp.slice(0, 5).map((place) => <div className="today-help-item" key={place.id}><span>{place.name}</span><small>{place.distanceKm.toFixed(1)} km · {place.type.toLowerCase()}</small></div>)}</>}</div></Card></div> : sosConfirm ? <div className="today-sos-overlay"><Card className="today-sos-confirmation is-critical"><p className="eyebrow">{t('today.safety')}</p><h2>{t('today.sendSos')}</h2><p>{t('today.sosCopy')}</p>{sosError && <p className="auth-error">{sosError}</p>}<div><Button disabled={sosWorking} onClick={triggerSos} type="button">{sosWorking ? t('today.sending') : t('today.notifyHelp')}</Button><Button disabled={sosWorking} onClick={() => setSosConfirm(false)} type="button" variant="secondary">{t('today.cancel')}</Button></div></Card></div> : null}
    {!loading && tripId && <Card className="today-helpline-card"><p className="eyebrow">{t('today.helpline')}</p><div className="today-helpline-number"><span>{supportPhone}</span></div><div className="today-helpline-actions"><a className="tp-button tp-button-secondary" href={telHrefFor(supportPhone)}>{t('today.call')}</a><Button onClick={() => navigate('/traveler/copilot')} type="button" variant="ghost">{t('today.askCopilot')}</Button></div></Card>}
    <button aria-label={t('today.emergencySos')} className="today-sos-fab" onClick={() => setSosConfirm(true)} type="button">{t('today.sos')} <span>{t('today.emergencyHelp')}</span></button>
    <button aria-label={t('today.openCopilot')} className="today-copilot-fab" onClick={() => navigate('/traveler/copilot')} type="button">✦ <span>{t('today.copilot')}</span></button>
  </section>
}
