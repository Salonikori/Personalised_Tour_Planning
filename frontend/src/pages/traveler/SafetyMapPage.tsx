import { useEffect, useState } from 'react'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { SafetyMap } from '../../components/safety/SafetyMap'
import { activeTrip } from '../../services/tripService'
import { createSafetyReport, getSafetyZones, logSafetyMapClick, subscribeToSafetyUpdates, type SafetyZone } from '../../services/safetyService'

export function SafetyMapPage() {
  const [zones, setZones] = useState<SafetyZone[]>([])
  const [selected, setSelected] = useState<[number, number] | null>(null)
  const [live, setLive] = useState<[number, number] | null>(null)
  const [message, setMessage] = useState('')
  const [category, setCategory] = useState('SAFETY_CONCERN')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const load = () => { void getSafetyZones().then(setZones).catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load safety map.')) }
  useEffect(() => { load(); return subscribeToSafetyUpdates(load) }, [])
  useEffect(() => {
    if (!navigator.geolocation) return
    const id = navigator.geolocation.watchPosition((position) => setLive([position.coords.latitude, position.coords.longitude]), () => undefined, { enableHighAccuracy: true, maximumAge: 15000, timeout: 10000 })
    return () => navigator.geolocation.clearWatch(id)
  }, [])
  const select = (lat: number, lng: number) => { setSelected([lat, lng]); void logSafetyMapClick(lat, lng).catch(() => undefined) }
  const report = async () => {
    const point = selected || live || [0, 0]
    try { setWorking(true); setError(''); await createSafetyReport({ lat: point[0], lng: point[1], tripId: activeTrip.get() || undefined, category, message: message.trim() || undefined }); setMessage(''); setSelected(null); load() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to submit the safety report.') } finally { setWorking(false) }
  }
  return <section className="operator-page safety-page"><header className="operator-page-heading"><div><p className="eyebrow">Traveler safety intelligence</p><h1>Safety heatmap.</h1><p>Pin a concern or use your live location. Voyara aggregates reports by area and automatically determines the safety signal.</p></div></header>
    {error && <p className="auth-error" role="alert">{error}</p>}
    <div className="safety-grid"><Card><div className="safety-map-head"><div><h2>Live safety map</h2><p className="page-copy">Blue = your live location · red = marked unsafe zone · amber = caution.</p></div><Button onClick={() => live && select(live[0], live[1])} type="button" variant="secondary" disabled={!live}>Use my location</Button></div><SafetyMap zones={zones} liveLocation={live} selectable onMapClick={select} height={600} /><div className="safety-legend"><span><i className="safety-dot safety-blue"/>You</span><span><i className="safety-dot safety-amber"/>Caution</span><span><i className="safety-dot safety-red"/>Unsafe</span></div></Card>
      <Card><p className="eyebrow">Report a point</p><h2>{selected ? 'Location selected' : 'Pin a location'}</h2>{selected ? <p className="page-copy">{selected[0].toFixed(5)}, {selected[1].toFixed(5)}</p> : <p className="page-copy">Tap anywhere on the map. Your click is logged separately from a complaint, so the system can measure interest and actual reports.</p>}<label className="tp-input-wrap"><span className="tp-input-label">Concern</span><select className="tp-input" value={category} onChange={(event) => setCategory(event.target.value)}><option value="SAFETY_CONCERN">Safety concern</option><option value="HARASSMENT">Harassment</option><option value="THEFT">Theft / pickpocketing</option><option value="SCAM">Scam / fraud</option><option value="ROAD_HAZARD">Road hazard</option><option value="SAFE">Safe also</option><option value="OTHER">Other</option></select></label><label className="tp-input-wrap" style={{ marginTop: 14 }}><span className="tp-input-label">Optional note</span><textarea className="tp-input" rows={5} maxLength={500} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="What happened here?" /></label><div className="safety-actions"><Button disabled={working} onClick={() => void report()} type="button">{working ? 'Sending…' : 'Report this point'}</Button><Button disabled={!live} onClick={() => live && setSelected(live)} type="button" variant="secondary">Use live location</Button></div><p className="safety-ai-note">Automated review controls the zone classification. Admins can observe the evidence but cannot manually mark a location safe or unsafe.</p></Card></div>
  </section>
}
