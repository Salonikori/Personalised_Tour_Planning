import { useEffect, useState } from 'react'
import { Card } from '../../components/Card'
import { TwinCopilotPanel, type TwinCopilotQA } from '../../components/twin/TwinCopilotPanel'
import { activeTrip, getTrip, getItinerary, getWeatherTwin, type ApiItem, type ApiTrip, type WeatherTwin } from '../../services/tripService'

export function TwinPage() {
  const [trip, setTrip] = useState<ApiTrip | null>(null)
  const [items, setItems] = useState<ApiItem[]>([])
  const [twin, setTwin] = useState<WeatherTwin | null>(null)
  const [rain, setRain] = useState(60)
  const [temperature, setTemperature] = useState(30)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const tripId = activeTrip.get()
  useEffect(() => { if (!tripId) return; void Promise.all([getTrip(tripId), getItinerary(tripId)]).then(([t, i]) => { setTrip(t); setItems(i) }).catch(e => setError(e instanceof Error ? e.message : 'Unable to load trip')) }, [tripId])
  useEffect(() => { if (!tripId) return; let alive = true; setLoading(true); getWeatherTwin(tripId, rain, temperature).then(data => { if (alive) { setTwin(data); setError('') } }).catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Weather twin unavailable') }).finally(() => { if (alive) setLoading(false) }); return () => { alive = false } }, [tripId, rain, temperature])
  if (!tripId) return <section className="twin-page"><p className="eyebrow">Weather digital twin</p><h1 className="page-title">Choose a trip to simulate.</h1><p className="page-copy">Create or select an active trip first. The twin uses its real itinerary and destination.</p></section>
  const center = twin?.location
  const mapUrl = center ? `https://www.openstreetmap.org/export/embed.html?bbox=${center.longitude - .12}%2C${center.latitude - .09}%2C${center.longitude + .12}%2C${center.latitude + .09}&layer=mapnik&marker=${center.latitude}%2C${center.longitude}` : ''
  const topImpact = twin?.scenario.impacts.length ? [...twin.scenario.impacts].sort((a, b) => b.risk - a.risk)[0] : undefined
  const copilotQAs: TwinCopilotQA[] = [
    {
      id: 'rain-today',
      question: 'Will it rain today?',
      answer: `Live conditions show ${twin?.current?.precipitation ?? '—'}mm of precipitation right now, with the scenario slider set to ${rain}% rain probability. Forecast: ${twin?.forecast?.time?.slice(0, 5).join(' · ') ?? 'loading…'}.`,
    },
    {
      id: 'biggest-risk',
      question: "What's most likely to be affected?",
      answer: topImpact
        ? `${topImpact.title} carries the highest risk at ${topImpact.risk}%, with an expected delay of ${topImpact.expectedDelayMinutes} min and ${topImpact.exposure}% weather exposure.${topImpact.rationale ? ` ${topImpact.rationale}` : ''}`
        : `No itinerary items are showing elevated weather risk for ${trip?.destination ?? 'this trip'} right now.`,
    },
    {
      id: 'how-many-items',
      question: 'How many itinerary items are at risk?',
      answer: `${twin?.scenario.expectedAffectedItems ?? 0} of your ${items.length} itinerary items are at elevated risk, with a mean disruption probability of ${twin?.scenario.meanDisruptionProbability ?? 0}%.`,
    },
    {
      id: 'what-if',
      question: 'What if it gets worse?',
      answer: `Try dragging the rain probability and temperature sliders above - the simulation recomputes instantly and only ever runs counterfactually; it never touches your real bookings.`,
    },
  ]
  return <section className="twin-page" style={{ display: 'grid', gap: 22 }}>
    <header><p className="eyebrow">Voyara · weather digital twin</p><h1 className="page-title">Explore weather impacts before they happen.</h1><p className="page-copy">{trip?.destination ?? 'Loading destination'} · Scenario changes stay virtual and never modify your bookings.</p></header>
    {error && <Card><p role="alert">{error}. Check that the Voyara API is running and has internet access.</p></Card>}
    <div className="twin-page-layout" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(18rem,.55fr)', gap: 18, alignItems: 'start' }}>
      <div style={{ display: 'grid', gap: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 18 }}>
          <Card><h2>Live conditions · Open-Meteo</h2><p style={{ fontSize: 28, fontWeight: 700, margin: '12px 0' }}>{twin?.current?.temperature_2m ?? '—'}°C</p><p>{twin?.current?.precipitation ?? '—'} mm precipitation · wind {twin?.current?.wind_speed_10m ?? '—'} km/h</p><small>Forecast: {twin?.forecast?.time?.slice(0, 5).join(' · ') ?? 'Loading…'}</small></Card>
          <Card><h2>Counterfactual scenario</h2><label style={{ display: 'block', marginTop: 14 }}>Rain probability: <strong>{rain}%</strong><input aria-label="Rain probability" type="range" min="0" max="100" value={rain} onChange={e => setRain(Number(e.target.value))} style={{ display: 'block', width: '100%' }} /></label><label style={{ display: 'block', marginTop: 14 }}>Temperature: <strong>{temperature}°C</strong><input aria-label="Scenario temperature" type="range" min="0" max="50" value={temperature} onChange={e => setTemperature(Number(e.target.value))} style={{ display: 'block', width: '100%' }} /></label><small>{loading ? 'Updating simulation…' : 'Estimated from item type and weather exposure; probabilities are indicative.'}</small></Card>
          <Card><h2>Estimated ecosystem impact</h2><p style={{ fontSize: 27, fontWeight: 700 }}>{twin?.scenario.meanDisruptionProbability ?? 0}%</p><p>Mean disruption probability · {twin?.scenario.expectedAffectedItems ?? 0} itinerary items at elevated risk</p><small>Inference: {twin?.modelInference?.provider === 'nugen-aligned' ? `Nugen-aligned model ${twin.modelInference.model}${twin.modelInference.confidenceScore == null ? '' : ` · alignment confidence ${twin.modelInference.confidenceScore}%`}` : 'local estimate (Nugen aligned model is not configured)'}</small>{twin?.modelInference?.error && <small style={{ display: 'block' }}>Nugen inference unavailable: {twin.modelInference.error}. Showing local estimate.</small>}</Card>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 18 }}>
          <Card><h2>Destination impact map</h2>{mapUrl ? <iframe title="OpenStreetMap destination and weather twin" src={mapUrl} style={{ width: '100%', height: 330, border: 0, borderRadius: 12 }} loading="lazy" /> : <p>Locating destination…</p>}<small>{center ? `${center.latitude.toFixed(3)}, ${center.longitude.toFixed(3)} · ${twin?.destination}` : 'Map loads with live destination data.'}</small></Card>
          <Card><h2>Propagation through your itinerary</h2><p>Live entities: {items.length} · upstream weather can affect movement, outdoor plans and arrival timing.</p><div style={{ display: 'grid', gap: 10, maxHeight: 330, overflow: 'auto' }}>{twin?.scenario.impacts.map(impact => <article key={impact.id} style={{ padding: 12, border: '1px solid var(--tp-border)', borderRadius: 12 }}><strong>{impact.title}</strong><div>{impact.type} · {impact.location || 'location not set'}</div><div style={{ marginTop: 5 }}><strong>{impact.risk}% risk</strong> · expected delay {impact.expectedDelayMinutes} min · {impact.exposure}% weather exposure</div>{impact.rationale && <small>{impact.rationale}</small>}<small style={{ display: 'block' }}>Indicative risk range ±{Math.max(5, Math.round(impact.risk * .2))} percentage points</small></article>)}</div></Card>
        </div>
        <Card><h2>Traveler and public signals · GDELT</h2><p>Recent public reporting mentioning weather near {trip?.destination}. These signals provide context and are not treated as verified traveler reports.</p>{twin?.socialSignals.length ? <ul style={{ display: 'grid', gap: 9, paddingLeft: 20 }}>{twin.socialSignals.map((signal, index) => <li key={`${signal.url}-${index}`}><a href={signal.url} target="_blank" rel="noreferrer">{signal.title}</a> <small>· {signal.source}</small></li>)}</ul> : <p>No matching recent public reports returned.</p>}</Card>
      </div>
      <div style={{ position: 'sticky', top: 18 }}>
        <TwinCopilotPanel
          heading="Weather twin copilot"
          intro={`Ask about ${trip?.destination ?? 'this trip'}'s weather twin - these are answered instantly from the current simulation.`}
          qas={copilotQAs}
        />
      </div>
    </div>
  </section>
}
