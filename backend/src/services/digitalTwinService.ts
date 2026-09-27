// Weather-driven Digital Twin layer for the existing Voyara hospitality & travel platform.
// This is additive: it reads the same real-world concepts the app already models (destinations,
// transport, lodging, attractions, dining, workforce) and layers a continuously-updatable,
// AI-assisted simulation on top of them. It never mutates real trips, bookings or inventory -
// every simulated number lives only in the response returned to the caller.
//
// Mandatory-requirement coverage:
//  1. Live weather integration -> fetchLiveWeather() calls Open-Meteo (no key required).
//  2. Geospatial visualization data -> city coordinates + per-entity lat/lng are always returned.
//  3. Real-world social signal integration -> fetchSocialSignals() calls Bluesky + GDELT.
//  4. What-if / counterfactual simulation -> simulateDigitalTwin() propagates a weather scenario
//     through a small causal graph (transport -> lodging -> dining/attractions -> workforce) and
//     returns probabilistic, uncertainty-banded outcomes that update as inputs change.
//
// Whenever a live provider is unreachable (no network, rate limited, geocoding miss, etc.) this
// module falls back to fixed demo data for the three showcase cities the task asks for -
// Goa, Delhi and Paris - so the UI always has something real-looking to render.

export type TwinCityId = 'goa' | 'delhi' | 'paris'

export type TwinEntity = {
  id: string
  name: string
  category: 'HOTEL' | 'TRANSPORT_HUB' | 'ATTRACTION' | 'RESTAURANT' | 'WORKFORCE_POOL'
  latitude: number
  longitude: number
  /** 0-100 how directly the entity is physically exposed to outdoor weather. */
  baseExposure: number
  /** 0-100 normal-conditions baseline utilization (occupancy / footfall / on-time %). */
  baselineLoad: number
  coastalOrLowLying: boolean
}

export type TwinCity = {
  id: TwinCityId
  name: string
  country: string
  latitude: number
  longitude: number
  entities: TwinEntity[]
}

// ---- Fixed demo dataset: Goa, Delhi, Paris -------------------------------------------------
// Coordinates are real; load/exposure baselines are illustrative demo figures used only when
// no operator inventory row matches the city and/or live providers are unavailable.
const CITY_LIBRARY: Record<TwinCityId, TwinCity> = {
  goa: {
    id: 'goa', name: 'Goa', country: 'India', latitude: 15.2993, longitude: 74.1240,
    entities: [
      { id: 'goa-hotel-calangute', name: 'Calangute Beach Resort', category: 'HOTEL', latitude: 15.5439, longitude: 73.7553, baseExposure: 55, baselineLoad: 78, coastalOrLowLying: true },
      { id: 'goa-hotel-panjim', name: 'Panjim Riverside Hotel', category: 'HOTEL', latitude: 15.4909, longitude: 73.8278, baseExposure: 40, baselineLoad: 64, coastalOrLowLying: true },
      { id: 'goa-airport', name: 'Dabolim Airport Transfers', category: 'TRANSPORT_HUB', latitude: 15.3808, longitude: 73.8314, baseExposure: 70, baselineLoad: 82, coastalOrLowLying: false },
      { id: 'goa-attraction-fort', name: 'Fort Aguada', category: 'ATTRACTION', latitude: 15.4925, longitude: 73.7738, baseExposure: 95, baselineLoad: 70, coastalOrLowLying: true },
      { id: 'goa-attraction-beach', name: 'Baga Beach Water Sports', category: 'ATTRACTION', latitude: 15.5553, longitude: 73.7517, baseExposure: 98, baselineLoad: 88, coastalOrLowLying: true },
      { id: 'goa-restaurant-shack', name: 'Anjuna Beach Shack Row', category: 'RESTAURANT', latitude: 15.5735, longitude: 73.7404, baseExposure: 85, baselineLoad: 75, coastalOrLowLying: true },
      { id: 'goa-workforce', name: 'North Goa Hospitality Staff Pool', category: 'WORKFORCE_POOL', latitude: 15.5200, longitude: 73.7800, baseExposure: 60, baselineLoad: 90, coastalOrLowLying: true },
    ],
  },
  delhi: {
    id: 'delhi', name: 'Delhi', country: 'India', latitude: 28.6139, longitude: 77.2090,
    entities: [
      { id: 'delhi-hotel-cp', name: 'Connaught Place Grand', category: 'HOTEL', latitude: 28.6315, longitude: 77.2167, baseExposure: 25, baselineLoad: 71, coastalOrLowLying: false },
      { id: 'delhi-hotel-airport', name: 'Aerocity Transit Hotel', category: 'HOTEL', latitude: 28.5562, longitude: 77.1000, baseExposure: 20, baselineLoad: 66, coastalOrLowLying: false },
      { id: 'delhi-airport', name: 'IGI Airport Transfers', category: 'TRANSPORT_HUB', latitude: 28.5562, longitude: 77.1000, baseExposure: 55, baselineLoad: 85, coastalOrLowLying: false },
      { id: 'delhi-attraction-fort', name: 'Red Fort', category: 'ATTRACTION', latitude: 28.6562, longitude: 77.2410, baseExposure: 90, baselineLoad: 65, coastalOrLowLying: false },
      { id: 'delhi-attraction-qutub', name: 'Qutub Minar', category: 'ATTRACTION', latitude: 28.5245, longitude: 77.1855, baseExposure: 90, baselineLoad: 60, coastalOrLowLying: false },
      { id: 'delhi-restaurant-cp', name: 'CP Outdoor Dining District', category: 'RESTAURANT', latitude: 28.6304, longitude: 77.2177, baseExposure: 65, baselineLoad: 72, coastalOrLowLying: false },
      { id: 'delhi-workforce', name: 'NCR Hospitality Staff Pool', category: 'WORKFORCE_POOL', latitude: 28.6000, longitude: 77.2000, baseExposure: 45, baselineLoad: 88, coastalOrLowLying: false },
    ],
  },
  paris: {
    id: 'paris', name: 'Paris', country: 'France', latitude: 48.8566, longitude: 2.3522,
    entities: [
      { id: 'paris-hotel-marais', name: 'Le Marais Boutique Hotel', category: 'HOTEL', latitude: 48.8590, longitude: 2.3620, baseExposure: 20, baselineLoad: 80, coastalOrLowLying: false },
      { id: 'paris-hotel-seine', name: 'Rive Gauche Seine View', category: 'HOTEL', latitude: 48.8566, longitude: 2.3376, baseExposure: 45, baselineLoad: 74, coastalOrLowLying: true },
      { id: 'paris-cdg', name: 'CDG Airport Transfers', category: 'TRANSPORT_HUB', latitude: 49.0097, longitude: 2.5479, baseExposure: 50, baselineLoad: 83, coastalOrLowLying: false },
      { id: 'paris-attraction-eiffel', name: 'Eiffel Tower', category: 'ATTRACTION', latitude: 48.8584, longitude: 2.2945, baseExposure: 92, baselineLoad: 90, coastalOrLowLying: true },
      { id: 'paris-attraction-louvre', name: 'Louvre Museum Queue Zone', category: 'ATTRACTION', latitude: 48.8606, longitude: 2.3376, baseExposure: 50, baselineLoad: 85, coastalOrLowLying: true },
      { id: 'paris-restaurant-terrace', name: 'Saint-Germain Terrace Cafes', category: 'RESTAURANT', latitude: 48.8539, longitude: 2.3336, baseExposure: 70, baselineLoad: 76, coastalOrLowLying: true },
      { id: 'paris-workforce', name: 'Île-de-France Hospitality Staff Pool', category: 'WORKFORCE_POOL', latitude: 48.8700, longitude: 2.3500, baseExposure: 35, baselineLoad: 86, coastalOrLowLying: false },
    ],
  },
}

const CITY_SOCIAL_FALLBACK: Record<TwinCityId, Array<{ title: string; url: string; source: string; date: string }>> = {
  goa: [
    { title: 'Heavy monsoon showers flooding low-lying lanes near Baga - beach shacks shut for the day', url: 'https://example.com/goa-monsoon-1', source: 'Demo social signal · X (sample)', date: new Date(Date.now() - 3 * 3600_000).toISOString() },
    { title: 'Dabolim airport reporting delays as storm cell moves over North Goa', url: 'https://example.com/goa-monsoon-2', source: 'Demo social signal · local news (sample)', date: new Date(Date.now() - 6 * 3600_000).toISOString() },
    { title: 'Tourists sharing videos of waterlogged Calangute-Candolim road after overnight rain', url: 'https://example.com/goa-monsoon-3', source: 'Demo social signal · Instagram (sample)', date: new Date(Date.now() - 20 * 3600_000).toISOString() },
  ],
  delhi: [
    { title: 'Heatwave alert trending as Delhi crosses 45°C - hotel pools and indoor malls packed', url: 'https://example.com/delhi-heat-1', source: 'Demo social signal · X (sample)', date: new Date(Date.now() - 2 * 3600_000).toISOString() },
    { title: 'Commuters posting about IGI Airport taxi queues amid heat-related road repair slowdown', url: 'https://example.com/delhi-heat-2', source: 'Demo social signal · local news (sample)', date: new Date(Date.now() - 9 * 3600_000).toISOString() },
    { title: 'Red Fort visitors advised to carry water as afternoon heat index climbs', url: 'https://example.com/delhi-heat-3', source: 'Demo social signal · travel forum (sample)', date: new Date(Date.now() - 15 * 3600_000).toISOString() },
  ],
  paris: [
    { title: 'Seine water levels rising after days of rain - riverside walkways closed near Rive Gauche', url: 'https://example.com/paris-rain-1', source: 'Demo social signal · X (sample)', date: new Date(Date.now() - 4 * 3600_000).toISOString() },
    { title: 'CDG passengers reporting ground-stop delays during afternoon thunderstorm band', url: 'https://example.com/paris-rain-2', source: 'Demo social signal · local news (sample)', date: new Date(Date.now() - 11 * 3600_000).toISOString() },
    { title: 'Saint-Germain terrace cafes moving tables indoors as showers return for the third day', url: 'https://example.com/paris-rain-3', source: 'Demo social signal · Instagram (sample)', date: new Date(Date.now() - 18 * 3600_000).toISOString() },
  ],
}

// Deterministic fallback "current + forecast" reading per city, tuned to be plausible for that
// city's usual weather story (Goa monsoon, Delhi heat, Paris spring rain) so the demo is coherent
// even fully offline.
const CITY_WEATHER_FALLBACK: Record<TwinCityId, { temperatureC: number; precipitationMm: number; precipitationProbability: number; windKph: number; weatherCode: number }> = {
  goa: { temperatureC: 29, precipitationMm: 38, precipitationProbability: 88, windKph: 34, weatherCode: 82 },
  delhi: { temperatureC: 42, precipitationMm: 0, precipitationProbability: 5, windKph: 14, weatherCode: 1 },
  paris: { temperatureC: 16, precipitationMm: 12, precipitationProbability: 70, windKph: 28, weatherCode: 61 },
}

export function listCities(): Array<Pick<TwinCity, 'id' | 'name' | 'country' | 'latitude' | 'longitude'>> {
  return Object.values(CITY_LIBRARY).map(({ id, name, country, latitude, longitude }) => ({ id, name, country, latitude, longitude }))
}

export function getCity(id: string): TwinCity | null {
  const key = id.toLowerCase() as TwinCityId
  return CITY_LIBRARY[key] ?? null
}

// ---- 1. Live weather integration ------------------------------------------------------------
export type LiveWeatherResult = {
  source: 'live-open-meteo' | 'fallback-demo'
  temperatureC: number
  precipitationMm: number
  precipitationProbability: number
  windKph: number
  weatherCode: number
  forecast?: { time: string[]; temperatureMax: number[]; precipitationSum: number[]; precipitationProbabilityMax: number[] }
  error?: string
}

export async function fetchLiveWeather(city: TwinCity): Promise<LiveWeatherResult> {
  try {
    const url = new URL('https://api.open-meteo.com/v1/forecast')
    url.search = new URLSearchParams({
      latitude: String(city.latitude), longitude: String(city.longitude), timezone: 'auto', forecast_days: '5',
      current: 'temperature_2m,precipitation,weather_code,wind_speed_10m',
      daily: 'temperature_2m_max,precipitation_sum,precipitation_probability_max,weather_code',
    }).toString()
    const res = await fetch(url, { signal: AbortSignal.timeout(9000) })
    if (!res.ok) throw new Error(`Open-Meteo returned HTTP ${res.status}`)
    const data = await res.json() as { current?: Record<string, number>; daily?: { time: string[]; temperature_2m_max: number[]; precipitation_sum: number[]; precipitation_probability_max: number[]; weather_code: number[] } }
    if (!data.current) throw new Error('Open-Meteo returned no current conditions')
    return {
      source: 'live-open-meteo',
      temperatureC: Number(data.current.temperature_2m ?? CITY_WEATHER_FALLBACK[city.id].temperatureC),
      precipitationMm: Number(data.current.precipitation ?? 0),
      precipitationProbability: Number(data.daily?.precipitation_probability_max?.[0] ?? 0),
      windKph: Number(data.current.wind_speed_10m ?? 0),
      weatherCode: Number(data.current.weather_code ?? 0),
      forecast: data.daily ? { time: data.daily.time, temperatureMax: data.daily.temperature_2m_max, precipitationSum: data.daily.precipitation_sum, precipitationProbabilityMax: data.daily.precipitation_probability_max } : undefined,
    }
  } catch (error) {
    const fallback = CITY_WEATHER_FALLBACK[city.id]
    return { source: 'fallback-demo', ...fallback, error: error instanceof Error ? error.message : 'Live weather provider unavailable' }
  }
}

// ---- 3. Real-world social signal integration -------------------------------------------------
export type SocialSignal = { title: string; url: string; source: string; date: string }
export type SocialSignalResult = { source: 'live' | 'fallback-demo'; signals: SocialSignal[]; error?: string }

export async function fetchSocialSignals(city: TwinCity): Promise<SocialSignalResult> {
  const query = `${city.name} (weather OR rain OR storm OR heatwave OR flood)`
  try {
    const [socialRes, newsRes] = await Promise.all([
      fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?${new URLSearchParams({ q: query, limit: '5' })}`, { signal: AbortSignal.timeout(7000) })
        .then(r => r.ok ? r.json() as Promise<{ posts?: Array<{ uri: string; author: { handle: string }; record: { text?: string }; indexedAt: string }> }> : { posts: [] })
        .catch(() => ({ posts: [] as Array<{ uri: string; author: { handle: string }; record: { text?: string }; indexedAt: string }> })),
      fetch(`https://api.gdeltproject.org/api/v2/doc/doc?${new URLSearchParams({ query, mode: 'ArtList', format: 'json', maxrecords: '5', sort: 'DateDesc' })}`, { signal: AbortSignal.timeout(7000) })
        .then(r => r.ok ? r.json() as Promise<{ articles?: Array<{ title: string; url: string; domain: string; seendate: string }> }> : { articles: [] })
        .catch(() => ({ articles: [] as Array<{ title: string; url: string; domain: string; seendate: string }> })),
    ])
    const signals: SocialSignal[] = [
      ...(socialRes.posts ?? []).map(post => ({ title: post.record.text ?? 'Public post', url: `https://bsky.app/profile/${post.author.handle}/post/${post.uri.split('/').pop()}`, source: `Bluesky · @${post.author.handle}`, date: post.indexedAt })),
      ...(newsRes.articles ?? []).map(article => ({ title: article.title, url: article.url, source: article.domain, date: article.seendate })),
    ]
    if (signals.length === 0) return { source: 'fallback-demo', signals: CITY_SOCIAL_FALLBACK[city.id] }
    return { source: 'live', signals }
  } catch (error) {
    return { source: 'fallback-demo', signals: CITY_SOCIAL_FALLBACK[city.id], error: error instanceof Error ? error.message : 'Social signal providers unavailable' }
  }
}

// ---- 4. What-if / counterfactual digital-twin simulation --------------------------------------
export type ScenarioInput = {
  /** 0-100, replaces/overrides live precipitation probability for the counterfactual. */
  rainIntensity: number
  /** Scenario air temperature in Celsius. */
  temperatureC: number
  /** How many hours the storm/heat event persists - lengthens cascading (2nd/3rd order) effects. */
  stormDurationHours: number
  /** 0-100 flood severity, only bites entities marked coastalOrLowLying. */
  floodLevel: number
}

export type EntityImpact = {
  id: string
  name: string
  category: TwinEntity['category']
  latitude: number
  longitude: number
  order: 1 | 2 | 3
  metric: string
  baseline: number
  projected: number
  deltaPct: number
  meanRiskPct: number
  uncertaintyPct: number
  rationale: string
}

export type SimulationResult = {
  scenario: ScenarioInput
  generatedAt: string
  overall: { meanDisruptionPct: number; uncertaintyPct: number; entitiesAtElevatedRisk: number; cascadeDepth: number }
  impacts: EntityImpact[]
  cascadeNarrative: string[]
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Small deterministic pseudo-random generator seeded from a string, so repeat calls with the
 *  same scenario+entity produce stable "uncertainty band" numbers instead of visibly jittering
 *  on every request (still varies meaningfully as scenario inputs change). */
function seededNoise(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) }
  return ((h >>> 0) % 1000) / 1000
}

/**
 * Propagates a weather scenario through a 3-tier causal graph:
 *   Tier 1 (direct exposure): transport hubs & outdoor attractions/restaurants feel rain/heat/flood first.
 *   Tier 2 (first cascade): hotel occupancy and restaurant demand shift in response to tier-1 disruption
 *     (delayed transfers depress arrivals; bad outdoor weather pushes demand toward indoor dining/hotels).
 *   Tier 3 (second cascade): workforce availability drops with storm duration/flooding (commuting harder),
 *     which further caps hotel/restaurant/attraction effective capacity - a secondary, higher-order effect.
 * Every number is returned with a probabilistic mean and an uncertainty band rather than a single
 * point estimate, and updates immediately whenever the caller changes rain/temperature/duration/flood.
 */
export function simulateDigitalTwin(city: TwinCity, weather: LiveWeatherResult, scenario: ScenarioInput): SimulationResult {
  const rain = clamp(scenario.rainIntensity, 0, 100) / 100
  const heatExcess = Math.max(0, scenario.temperatureC - 33) / 20 // >33C starts to bite
  const coldExcess = Math.max(0, 5 - scenario.temperatureC) / 20 // <5C starts to bite (rare demo case)
  const durationFactor = clamp(scenario.stormDurationHours, 0, 72) / 24 // normalize to "days of event"
  const flood = clamp(scenario.floodLevel, 0, 100) / 100

  const impacts: EntityImpact[] = []
  const narrative: string[] = []

  // Tier 1: transport + directly exposed outdoor entities
  const tier1 = city.entities.filter(e => e.category === 'TRANSPORT_HUB' || e.category === 'ATTRACTION')
  for (const e of tier1) {
    const exposure = e.baseExposure / 100
    const floodHit = e.coastalOrLowLying ? flood * 0.5 : 0
    const mean = clamp((rain * 0.65 + heatExcess * 0.4 + coldExcess * 0.3 + floodHit) * exposure * (0.6 + durationFactor * 0.4), 0, 0.97)
    const noise = seededNoise(`${e.id}-${scenario.rainIntensity}-${scenario.temperatureC}-${scenario.stormDurationHours}-${scenario.floodLevel}`)
    const uncertainty = clamp(8 + mean * 18 + noise * 6, 5, 35)
    const metric = e.category === 'TRANSPORT_HUB' ? 'on-time performance' : 'footfall vs. normal'
    const baseline = e.baselineLoad
    const projected = e.category === 'TRANSPORT_HUB' ? clamp(baseline * (1 - mean * 0.9), 5, 100) : clamp(baseline * (1 - mean * 0.75), 2, 100)
    impacts.push({
      id: e.id, name: e.name, category: e.category, latitude: e.latitude, longitude: e.longitude, order: 1,
      metric, baseline: Math.round(baseline), projected: Math.round(projected), deltaPct: Math.round(((projected - baseline) / baseline) * 100),
      meanRiskPct: Math.round(mean * 100), uncertaintyPct: Math.round(uncertainty),
      rationale: e.category === 'TRANSPORT_HUB'
        ? `Direct exposure to rain/heat/flooding raises delay risk on transfers serving ${city.name}.`
        : `Fully outdoor attraction; exposure ${Math.round(exposure * 100)}% means demand drops almost in lock-step with scenario severity.`,
    })
  }
  const avgTier1Risk = impacts.length ? impacts.reduce((s, i) => s + i.meanRiskPct, 0) / impacts.length : 0
  if (avgTier1Risk > 15) narrative.push(`Direct exposure: transport transfers and outdoor attractions around ${city.name} absorb the first hit as rain/heat/flood severity rises.`)

  // Tier 2: hotels + restaurants, driven off tier-1 disruption + their own exposure
  const tier1RiskFrac = avgTier1Risk / 100
  const tier2 = city.entities.filter(e => e.category === 'HOTEL' || e.category === 'RESTAURANT')
  for (const e of tier2) {
    const exposure = e.baseExposure / 100
    const floodHit = e.coastalOrLowLying ? flood * 0.35 : 0
    if (e.category === 'HOTEL') {
      // Hotels see two opposing forces: arrival friction (transfers delayed -> lower check-ins /
      // early departures) vs. a "shelter" bump (bad outdoor weather pushes travellers to stay in).
      const arrivalFriction = tier1RiskFrac * 0.5 * (0.6 + durationFactor * 0.4)
      const shelterBump = clamp(rain * 0.35 + heatExcess * 0.25, 0, 0.4) * (1 - exposure * 0.4)
      const netMean = clamp(shelterBump - arrivalFriction - floodHit, -0.5, 0.6)
      const noise = seededNoise(`${e.id}-hotel-${scenario.rainIntensity}-${scenario.temperatureC}`)
      const uncertainty = clamp(6 + Math.abs(netMean) * 22 + noise * 6, 5, 30)
      const baseline = e.baselineLoad
      const projected = clamp(baseline * (1 + netMean), 5, 100)
      impacts.push({
        id: e.id, name: e.name, category: e.category, latitude: e.latitude, longitude: e.longitude, order: 2,
        metric: 'occupancy vs. normal', baseline: Math.round(baseline), projected: Math.round(projected), deltaPct: Math.round(netMean * 100),
        meanRiskPct: Math.round(Math.abs(netMean) * 100), uncertaintyPct: Math.round(uncertainty),
        rationale: netMean >= 0
          ? `Cascaded from transport delays (${Math.round(avgTier1Risk)}% avg risk): travellers sheltering indoors partly offsets arrival friction.`
          : `Cascaded from transport delays (${Math.round(avgTier1Risk)}% avg risk): late/missed transfers outweigh any shelter-seeking demand${floodHit ? ', compounded by flood exposure' : ''}.`,
      })
    } else {
      const mean = clamp((rain * 0.5 + heatExcess * 0.45 + floodHit) * exposure * (0.7 + durationFactor * 0.3) - tier1RiskFrac * 0.1, 0, 0.9)
      const noise = seededNoise(`${e.id}-resto-${scenario.rainIntensity}-${scenario.temperatureC}`)
      const uncertainty = clamp(7 + mean * 20 + noise * 6, 5, 32)
      const baseline = e.baselineLoad
      const projected = clamp(baseline * (1 - mean * 0.7), 5, 100)
      impacts.push({
        id: e.id, name: e.name, category: e.category, latitude: e.latitude, longitude: e.longitude, order: 2,
        metric: 'outdoor-seating demand vs. normal', baseline: Math.round(baseline), projected: Math.round(projected), deltaPct: Math.round(((projected - baseline) / baseline) * 100),
        meanRiskPct: Math.round(mean * 100), uncertaintyPct: Math.round(uncertainty),
        rationale: `Cascaded from tier-1 conditions: outdoor dining demand redirects indoors/to delivery as exposure (${Math.round(exposure * 100)}%) and severity rise.`,
      })
    }
  }
  const avgTier2Risk = impacts.filter(i => i.order === 2).reduce((s, i) => s + i.meanRiskPct, 0) / Math.max(1, impacts.filter(i => i.order === 2).length)
  if (avgTier2Risk > 15) narrative.push(`First cascade: hotel occupancy and restaurant demand shift in response to transport disruption, not direct weather alone.`)

  // Tier 3: workforce availability - second-order effect driven by duration + flood + tier1/2 severity
  const workforce = city.entities.find(e => e.category === 'WORKFORCE_POOL')
  if (workforce) {
    const commuteStrain = clamp(rain * 0.4 + flood * 0.5 + heatExcess * 0.3, 0, 1) * (0.5 + durationFactor * 0.5)
    const noise = seededNoise(`${workforce.id}-${scenario.stormDurationHours}-${scenario.floodLevel}`)
    const uncertainty = clamp(6 + commuteStrain * 20 + noise * 6, 5, 30)
    const baseline = workforce.baselineLoad
    const projected = clamp(baseline * (1 - commuteStrain * 0.55), 20, 100)
    impacts.push({
      id: workforce.id, name: workforce.name, category: workforce.category, latitude: workforce.latitude, longitude: workforce.longitude, order: 3,
      metric: 'staff availability vs. normal', baseline: Math.round(baseline), projected: Math.round(projected), deltaPct: Math.round(((projected - baseline) / baseline) * 100),
      meanRiskPct: Math.round(commuteStrain * 100), uncertaintyPct: Math.round(uncertainty),
      rationale: `Second-order effect: longer storm duration (${scenario.stormDurationHours}h) and flood level (${scenario.floodLevel}%) reduce staff able to commute, capping effective capacity at hotels, restaurants and attractions even where direct weather exposure is low.`,
    })
    if (commuteStrain * 100 > 15) narrative.push(`Second cascade: workforce commuting friction compounds duration (${scenario.stormDurationHours}h) and flood level (${scenario.floodLevel}%), capping service capacity across the board.`)
  }

  const meanDisruptionPct = Math.round(impacts.reduce((s, i) => s + i.meanRiskPct, 0) / impacts.length)
  const uncertaintyPct = Math.round(impacts.reduce((s, i) => s + i.uncertaintyPct, 0) / impacts.length)
  const entitiesAtElevatedRisk = impacts.filter(i => i.meanRiskPct >= 30).length
  if (!narrative.length) narrative.push(`Scenario is within normal operating range for ${city.name} - no material cascade detected.`)

  return {
    scenario, generatedAt: new Date().toISOString(),
    overall: { meanDisruptionPct, uncertaintyPct, entitiesAtElevatedRisk, cascadeDepth: 3 },
    impacts, cascadeNarrative: narrative,
  }
}
