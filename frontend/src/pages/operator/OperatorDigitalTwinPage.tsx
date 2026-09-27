import { useEffect, useRef, useState } from 'react'
import { Card } from '../../components/Card'
import { OperatorLayout } from '../../layouts/OperatorLayout'
import { TwinMap } from '../../components/twin/TwinMap'
import { TwinCopilotPanel, type TwinCopilotQA } from '../../components/twin/TwinCopilotPanel'
import {
  getTwinState, simulateTwin, listTwinCities,
  type TwinCityId, type TwinCityInfo, type TwinEntityImpact, type TwinScenario, type TwinSocial, type TwinWeather,
} from '../../services/digitalTwinService'

const CITIES = listTwinCities()
const weatherEmoji = (code: number) => code >= 95 ? '⛈️' : code >= 61 ? '🌧️' : code >= 45 ? '🌫️' : code <= 1 ? '☀️' : '⛅'
const tierLabel: Record<1 | 2 | 3, string> = { 1: 'Tier 1 · Direct exposure', 2: 'Tier 2 · First cascade', 3: 'Tier 3 · Second cascade' }
const categoryLabel: Record<TwinEntityImpact['category'], string> = { HOTEL: 'Hotel', TRANSPORT_HUB: 'Transport hub', ATTRACTION: 'Attraction', RESTAURANT: 'Restaurant', WORKFORCE_POOL: 'Workforce pool' }

export function OperatorDigitalTwinPage() {
  const [cityId, setCityId] = useState<TwinCityId>('goa')
  const [city, setCity] = useState<TwinCityInfo>(CITIES[0])
  const [weather, setWeather] = useState<TwinWeather | null>(null)
  const [social, setSocial] = useState<TwinSocial | null>(null)
  const [impacts, setImpacts] = useState<TwinEntityImpact[]>([])
  const [overall, setOverall] = useState({ meanDisruptionPct: 0, uncertaintyPct: 0, entitiesAtElevatedRisk: 0, cascadeDepth: 3 })
  const [narrative, setNarrative] = useState<string[]>([])
  const [scenario, setScenario] = useState<TwinScenario>({ rainIntensity: 50, temperatureC: 28, stormDurationHours: 6, floodLevel: 10 })
  const [loading, setLoading] = useState(true)
  const [simulating, setSimulating] = useState(false)
  const [error, setError] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load a fresh baseline (live weather + social signals + default scenario) whenever the city changes.
  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    void getTwinState(cityId).then((state) => {
      if (!alive) return
      setCity(state.city); setWeather(state.weather); setSocial(state.social)
      setImpacts(state.simulation.impacts); setOverall(state.simulation.overall); setNarrative(state.simulation.cascadeNarrative)
      setScenario(state.simulation.scenario)
    }).catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : 'Unable to load the digital twin.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [cityId])

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  // Debounced what-if re-simulation whenever a slider moves.
  const updateScenario = (patch: Partial<TwinScenario>) => {
    const next = { ...scenario, ...patch }
    setScenario(next)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setSimulating(true)
      void simulateTwin(cityId, next).then((result) => {
        setImpacts(result.simulation.impacts); setOverall(result.simulation.overall); setNarrative(result.simulation.cascadeNarrative)
        setWeather(result.weather)
      }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Simulation failed.'))
        .finally(() => setSimulating(false))
    }, 320)
  }

  const grouped = { 1: impacts.filter(i => i.order === 1), 2: impacts.filter(i => i.order === 2), 3: impacts.filter(i => i.order === 3) }

  const topRisk = [...impacts].sort((a, b) => b.meanRiskPct - a.meanRiskPct)[0]
  const copilotQAs: TwinCopilotQA[] = [
    {
      id: 'biggest-risk',
      question: "What's the biggest risk right now?",
      answer: topRisk
        ? `${topRisk.name} (${categoryLabel[topRisk.category]}, tier ${topRisk.order}) carries the highest projected disruption at ${topRisk.meanRiskPct}% ± ${topRisk.uncertaintyPct}pp - ${topRisk.metric} moving from ${topRisk.baseline} to ${topRisk.projected}.`
        : `No entities are showing elevated risk for ${city.name} right now.`,
    },
    {
      id: 'elevated-count',
      question: 'How many entities are at elevated risk?',
      answer: `${overall.entitiesAtElevatedRisk} of ${impacts.length} tracked entities in ${city.name} are at elevated risk, with a mean disruption of ${overall.meanDisruptionPct}% (± ${overall.uncertaintyPct}pp) across a ${overall.cascadeDepth}-tier cascade.`,
    },
    {
      id: 'whats-driving-it',
      question: "What's driving this scenario?",
      answer: `${weatherEmoji(weather?.weatherCode ?? 0)} ${weather?.temperatureC ?? '—'}°C with ${weather?.precipitationMm ?? 0}mm precipitation (${weather?.precipitationProbability ?? 0}% chance) and ${weather?.windKph ?? 0} km/h wind${weather?.source === 'live-open-meteo' ? ' from live Open-Meteo data' : ' (demo fallback)'}. The what-if sliders currently model ${scenario.rainIntensity}% rain intensity, ${scenario.temperatureC}°C, a ${scenario.stormDurationHours}h storm and ${scenario.floodLevel}% flood level.`,
    },
    {
      id: 'first-cascade',
      question: 'Which entities feel it first?',
      answer: grouped[1].length
        ? `Tier 1 (direct exposure) currently lists ${grouped[1].length} entities, led by ${[...grouped[1]].sort((a, b) => b.meanRiskPct - a.meanRiskPct)[0].name} at ${[...grouped[1]].sort((a, b) => b.meanRiskPct - a.meanRiskPct)[0].meanRiskPct}% risk.`
        : `No entities are in the tier 1 direct-exposure group for ${city.name} right now.`,
    },
    {
      id: 'what-should-we-do',
      question: 'What should operators do first?',
      answer: narrative.length
        ? narrative[0]
        : `Keep an eye on ${city.name}'s tier 1 entities and re-run the what-if sliders as conditions change - nothing here touches live bookings or inventory.`,
    },
  ]

  return <OperatorLayout><section className="operator-page twin-ops-page">
    <header className="operator-page-heading">
      <div>
        <p className="eyebrow">Voyara OPS · Weather-driven digital twin</p>
        <h1>See the ripple effects before they happen.</h1>
        <p>A continuously updating simulation layer over transport, lodging, attractions, dining and workforce - live weather in, cascading operational impact out.</p>
      </div>
      <span className="operator-live-dot">{loading ? 'Loading…' : simulating ? 'Simulating…' : 'Live'}</span>
    </header>
    {error && <p className="auth-error" role="alert">{error}</p>}

    <div className="twin-ops-city-tabs">
      {CITIES.map((c) => <button key={c.id} type="button" className={`twin-ops-city-tab ${c.id === cityId ? 'is-active' : ''}`} onClick={() => setCityId(c.id)}>{c.name}</button>)}
    </div>

    <section className="operator-kpis twin-ops-kpis">
      <Card className="operator-kpi is-danger"><span>Mean disruption</span><strong>{overall.meanDisruptionPct}%</strong><small>± {overall.uncertaintyPct}pp uncertainty</small></Card>
      <Card className="operator-kpi is-warning"><span>Entities at elevated risk</span><strong>{overall.entitiesAtElevatedRisk}</strong><small>of {impacts.length} tracked</small></Card>
      <Card className="operator-kpi is-primary"><span>Cascade depth modeled</span><strong>{overall.cascadeDepth}</strong><small>transport → lodging/dining → workforce</small></Card>
      <Card className="operator-kpi is-success"><span>Weather source</span><strong>{weather?.source === 'live-open-meteo' ? 'Live' : 'Demo'}</strong><small>{weather?.source === 'live-open-meteo' ? 'Open-Meteo forecast' : 'Fallback dataset'}</small></Card>
    </section>

    <div className="twin-ops-grid">
      <Card className="twin-ops-map-card">
        <div className="twin-ops-card-head"><h2>Geospatial impact map</h2><p className="page-copy">Circle size and color follow simulated disruption risk. Click a marker for the full cascade rationale.</p></div>
        <TwinMap city={city} impacts={impacts} height={460} />
        <div className="twin-ops-legend"><span><i className="safety-dot" style={{ background: '#16a34a' }} />Low risk</span><span><i className="safety-dot" style={{ background: '#f59e0b' }} />Moderate</span><span><i className="safety-dot" style={{ background: '#dc2626' }} />High risk</span></div>
      </Card>

      <div className="twin-ops-side">
        <Card>
          <h2>{weatherEmoji(weather?.weatherCode ?? 0)} Live conditions</h2>
          <p className="twin-ops-temp">{weather?.temperatureC ?? '—'}°C</p>
          <p className="page-copy">{weather?.precipitationMm ?? 0}mm precipitation · {weather?.precipitationProbability ?? 0}% chance · wind {weather?.windKph ?? 0} km/h</p>
          <small>{weather?.source === 'live-open-meteo' ? 'Source: Open-Meteo live forecast' : `Demo fallback${weather?.error ? ` (${weather.error})` : ''} for ${city.name}`}</small>
        </Card>

        <Card>
          <h2>What-if scenario</h2>
          <label className="twin-ops-slider">Rain intensity: <strong>{scenario.rainIntensity}%</strong>
            <input type="range" min={0} max={100} value={scenario.rainIntensity} onChange={(e) => updateScenario({ rainIntensity: Number(e.target.value) })} />
          </label>
          <label className="twin-ops-slider">Temperature: <strong>{scenario.temperatureC}°C</strong>
            <input type="range" min={-10} max={50} value={scenario.temperatureC} onChange={(e) => updateScenario({ temperatureC: Number(e.target.value) })} />
          </label>
          <label className="twin-ops-slider">Storm duration: <strong>{scenario.stormDurationHours}h</strong>
            <input type="range" min={0} max={72} value={scenario.stormDurationHours} onChange={(e) => updateScenario({ stormDurationHours: Number(e.target.value) })} />
          </label>
          <label className="twin-ops-slider">Flood level: <strong>{scenario.floodLevel}%</strong>
            <input type="range" min={0} max={100} value={scenario.floodLevel} onChange={(e) => updateScenario({ floodLevel: Number(e.target.value) })} />
          </label>
          <small>{simulating ? 'Recomputing cascade…' : 'Move a slider to counterfactually replay this scenario - nothing here touches real bookings or inventory.'}</small>
        </Card>

        <TwinCopilotPanel
          heading={`${city.name} twin copilot`}
          intro={`Ask about the ${city.name} simulation - these are answered instantly from the current run.`}
          qas={copilotQAs}
        />
      </div>
    </div>

    <Card className="twin-ops-narrative">
      <h2>Cascade narrative</h2>
      <ul>{narrative.map((line, i) => <li key={i}>{line}</li>)}</ul>
    </Card>

    <div className="twin-ops-tiers">
      {([1, 2, 3] as const).map((tier) => <Card key={tier} className="twin-ops-tier-card">
        <h2>{tierLabel[tier]}</h2>
        <div className="twin-ops-entity-list">
          {grouped[tier].map((impact) => <article key={impact.id} className="twin-ops-entity">
            <div className="twin-ops-entity-head"><strong>{impact.name}</strong><span className={`twin-ops-risk-pill ${impact.meanRiskPct >= 55 ? 'is-high' : impact.meanRiskPct >= 25 ? 'is-medium' : 'is-low'}`}>{impact.meanRiskPct}% ± {impact.uncertaintyPct}pp</span></div>
            <small>{categoryLabel[impact.category]} · {impact.metric}: {impact.baseline} → {impact.projected} ({impact.deltaPct > 0 ? '+' : ''}{impact.deltaPct}%)</small>
            <p>{impact.rationale}</p>
          </article>)}
          {!grouped[tier].length && <p className="page-copy">No entities in this tier for {city.name}.</p>}
        </div>
      </Card>)}
    </div>

    <Card>
      <h2>Traveler &amp; public social signals</h2>
      <p className="page-copy">{social?.source === 'live' ? `Live public reports mentioning weather near ${city.name}.` : `Demo social signals for ${city.name}${social?.error ? ` (live providers unavailable: ${social.error})` : ' (shown when live providers return nothing)'}.`}</p>
      {social?.signals.length ? <ul className="twin-ops-social-list">{social.signals.map((s, i) => <li key={`${s.url}-${i}`}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> <small>· {s.source} · {new Date(s.date).toLocaleString()}</small></li>)}</ul> : <p className="page-copy">No signals returned.</p>}
    </Card>
  </section></OperatorLayout>
}
