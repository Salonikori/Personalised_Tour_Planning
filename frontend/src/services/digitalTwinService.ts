import { apiRequest, ApiUnavailableError } from './apiClient'

export type TwinCityId = 'goa' | 'delhi' | 'paris'

export type TwinCityInfo = { id: TwinCityId; name: string; country: string; latitude: number; longitude: number }

export type TwinEntity = {
  id: string
  name: string
  category: 'HOTEL' | 'TRANSPORT_HUB' | 'ATTRACTION' | 'RESTAURANT' | 'WORKFORCE_POOL'
  latitude: number
  longitude: number
  baseExposure: number
  baselineLoad: number
  coastalOrLowLying: boolean
}

export type TwinWeather = {
  source: 'live-open-meteo' | 'fallback-demo'
  temperatureC: number
  precipitationMm: number
  precipitationProbability: number
  windKph: number
  weatherCode: number
  forecast?: { time: string[]; temperatureMax: number[]; precipitationSum: number[]; precipitationProbabilityMax: number[] }
  error?: string
}

export type TwinSocialSignal = { title: string; url: string; source: string; date: string }
export type TwinSocial = { source: 'live' | 'fallback-demo'; signals: TwinSocialSignal[]; error?: string }

export type TwinScenario = { rainIntensity: number; temperatureC: number; stormDurationHours: number; floodLevel: number }

export type TwinEntityImpact = {
  id: string; name: string; category: TwinEntity['category']; latitude: number; longitude: number
  order: 1 | 2 | 3; metric: string; baseline: number; projected: number; deltaPct: number
  meanRiskPct: number; uncertaintyPct: number; rationale: string
}

export type TwinSimulation = {
  scenario: TwinScenario
  generatedAt: string
  overall: { meanDisruptionPct: number; uncertaintyPct: number; entitiesAtElevatedRisk: number; cascadeDepth: number }
  impacts: TwinEntityImpact[]
  cascadeNarrative: string[]
}

export type TwinState = { city: TwinCityInfo; entities: TwinEntity[]; weather: TwinWeather; social: TwinSocial; simulation: TwinSimulation }
export type TwinSimulateResult = { city: TwinCityInfo; entities: TwinEntity[]; weather: TwinWeather; simulation: TwinSimulation }

// ---- Hardcoded fallback (used only when the Voyara API itself is unreachable - a genuine
// network/server outage, not a normal error response) so the Digital Twin page always has
// something real-looking to show for the three showcase cities the task calls out. ----
const FALLBACK_CITIES: Record<TwinCityId, TwinCityInfo> = {
  goa: { id: 'goa', name: 'Goa', country: 'India', latitude: 15.2993, longitude: 74.1240 },
  delhi: { id: 'delhi', name: 'Delhi', country: 'India', latitude: 28.6139, longitude: 77.2090 },
  paris: { id: 'paris', name: 'Paris', country: 'France', latitude: 48.8566, longitude: 2.3522 },
}

const FALLBACK_ENTITIES: Record<TwinCityId, TwinEntity[]> = {
  goa: [
    { id: 'goa-hotel-calangute', name: 'Calangute Beach Resort', category: 'HOTEL', latitude: 15.5439, longitude: 73.7553, baseExposure: 55, baselineLoad: 78, coastalOrLowLying: true },
    { id: 'goa-airport', name: 'Dabolim Airport Transfers', category: 'TRANSPORT_HUB', latitude: 15.3808, longitude: 73.8314, baseExposure: 70, baselineLoad: 82, coastalOrLowLying: false },
    { id: 'goa-attraction-beach', name: 'Baga Beach Water Sports', category: 'ATTRACTION', latitude: 15.5553, longitude: 73.7517, baseExposure: 98, baselineLoad: 88, coastalOrLowLying: true },
    { id: 'goa-restaurant-shack', name: 'Anjuna Beach Shack Row', category: 'RESTAURANT', latitude: 15.5735, longitude: 73.7404, baseExposure: 85, baselineLoad: 75, coastalOrLowLying: true },
    { id: 'goa-workforce', name: 'North Goa Hospitality Staff Pool', category: 'WORKFORCE_POOL', latitude: 15.5200, longitude: 73.7800, baseExposure: 60, baselineLoad: 90, coastalOrLowLying: true },
  ],
  delhi: [
    { id: 'delhi-hotel-cp', name: 'Connaught Place Grand', category: 'HOTEL', latitude: 28.6315, longitude: 77.2167, baseExposure: 25, baselineLoad: 71, coastalOrLowLying: false },
    { id: 'delhi-airport', name: 'IGI Airport Transfers', category: 'TRANSPORT_HUB', latitude: 28.5562, longitude: 77.1000, baseExposure: 55, baselineLoad: 85, coastalOrLowLying: false },
    { id: 'delhi-attraction-fort', name: 'Red Fort', category: 'ATTRACTION', latitude: 28.6562, longitude: 77.2410, baseExposure: 90, baselineLoad: 65, coastalOrLowLying: false },
    { id: 'delhi-restaurant-cp', name: 'CP Outdoor Dining District', category: 'RESTAURANT', latitude: 28.6304, longitude: 77.2177, baseExposure: 65, baselineLoad: 72, coastalOrLowLying: false },
    { id: 'delhi-workforce', name: 'NCR Hospitality Staff Pool', category: 'WORKFORCE_POOL', latitude: 28.6000, longitude: 77.2000, baseExposure: 45, baselineLoad: 88, coastalOrLowLying: false },
  ],
  paris: [
    { id: 'paris-hotel-marais', name: 'Le Marais Boutique Hotel', category: 'HOTEL', latitude: 48.8590, longitude: 2.3620, baseExposure: 20, baselineLoad: 80, coastalOrLowLying: false },
    { id: 'paris-cdg', name: 'CDG Airport Transfers', category: 'TRANSPORT_HUB', latitude: 49.0097, longitude: 2.5479, baseExposure: 50, baselineLoad: 83, coastalOrLowLying: false },
    { id: 'paris-attraction-eiffel', name: 'Eiffel Tower', category: 'ATTRACTION', latitude: 48.8584, longitude: 2.2945, baseExposure: 92, baselineLoad: 90, coastalOrLowLying: true },
    { id: 'paris-restaurant-terrace', name: 'Saint-Germain Terrace Cafes', category: 'RESTAURANT', latitude: 48.8539, longitude: 2.3336, baseExposure: 70, baselineLoad: 76, coastalOrLowLying: true },
    { id: 'paris-workforce', name: 'Île-de-France Hospitality Staff Pool', category: 'WORKFORCE_POOL', latitude: 48.8700, longitude: 2.3500, baseExposure: 35, baselineLoad: 86, coastalOrLowLying: false },
  ],
}

const FALLBACK_WEATHER: Record<TwinCityId, TwinWeather> = {
  goa: { source: 'fallback-demo', temperatureC: 29, precipitationMm: 38, precipitationProbability: 88, windKph: 34, weatherCode: 82, error: 'Voyara API unreachable from this browser' },
  delhi: { source: 'fallback-demo', temperatureC: 42, precipitationMm: 0, precipitationProbability: 5, windKph: 14, weatherCode: 1, error: 'Voyara API unreachable from this browser' },
  paris: { source: 'fallback-demo', temperatureC: 16, precipitationMm: 12, precipitationProbability: 70, windKph: 28, weatherCode: 61, error: 'Voyara API unreachable from this browser' },
}

const FALLBACK_SOCIAL: Record<TwinCityId, TwinSocial> = {
  goa: { source: 'fallback-demo', signals: [
    { title: 'Heavy monsoon showers flooding low-lying lanes near Baga - beach shacks shut for the day', url: 'https://example.com/goa-monsoon-1', source: 'Demo social signal · X (sample)', date: new Date(Date.now() - 3 * 3600_000).toISOString() },
    { title: 'Dabolim airport reporting delays as storm cell moves over North Goa', url: 'https://example.com/goa-monsoon-2', source: 'Demo social signal · local news (sample)', date: new Date(Date.now() - 6 * 3600_000).toISOString() },
    { title: 'Tourists sharing videos of waterlogged Calangute-Candolim road after overnight rain', url: 'https://example.com/goa-monsoon-3', source: 'Demo social signal · Instagram (sample)', date: new Date(Date.now() - 20 * 3600_000).toISOString() },
  ] },
  delhi: { source: 'fallback-demo', signals: [
    { title: 'Heatwave alert trending as Delhi crosses 45°C - hotel pools and indoor malls packed', url: 'https://example.com/delhi-heat-1', source: 'Demo social signal · X (sample)', date: new Date(Date.now() - 2 * 3600_000).toISOString() },
    { title: 'Commuters posting about IGI Airport taxi queues amid heat-related road repair slowdown', url: 'https://example.com/delhi-heat-2', source: 'Demo social signal · local news (sample)', date: new Date(Date.now() - 9 * 3600_000).toISOString() },
    { title: 'Red Fort visitors advised to carry water as afternoon heat index climbs', url: 'https://example.com/delhi-heat-3', source: 'Demo social signal · travel forum (sample)', date: new Date(Date.now() - 15 * 3600_000).toISOString() },
  ] },
  paris: { source: 'fallback-demo', signals: [
    { title: 'Seine water levels rising after days of rain - riverside walkways closed near Rive Gauche', url: 'https://example.com/paris-rain-1', source: 'Demo social signal · X (sample)', date: new Date(Date.now() - 4 * 3600_000).toISOString() },
    { title: 'CDG passengers reporting ground-stop delays during afternoon thunderstorm band', url: 'https://example.com/paris-rain-2', source: 'Demo social signal · local news (sample)', date: new Date(Date.now() - 11 * 3600_000).toISOString() },
    { title: 'Saint-Germain terrace cafes moving tables indoors as showers return for the third day', url: 'https://example.com/paris-rain-3', source: 'Demo social signal · Instagram (sample)', date: new Date(Date.now() - 18 * 3600_000).toISOString() },
  ] },
}

function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)) }

/** Mirrors the server's cascading what-if model closely enough to keep the UI fully interactive
 *  (sliders still move the numbers) even when the Voyara API cannot be reached at all. */
function localSimulate(cityId: TwinCityId, scenario: TwinScenario): TwinSimulation {
  const entities = FALLBACK_ENTITIES[cityId]
  const rain = clamp(scenario.rainIntensity, 0, 100) / 100
  const heat = Math.max(0, scenario.temperatureC - 33) / 20
  const duration = clamp(scenario.stormDurationHours, 0, 72) / 24
  const flood = clamp(scenario.floodLevel, 0, 100) / 100
  const impacts: TwinEntityImpact[] = entities.map((e) => {
    const exposure = e.baseExposure / 100
    const floodHit = e.coastalOrLowLying ? flood * 0.4 : 0
    const order: 1 | 2 | 3 = e.category === 'WORKFORCE_POOL' ? 3 : (e.category === 'HOTEL' || e.category === 'RESTAURANT') ? 2 : 1
    const mean = clamp((rain * 0.6 + heat * 0.4 + floodHit) * exposure * (0.6 + duration * 0.4), 0, 0.95)
    const baseline = e.baselineLoad
    const projected = clamp(baseline * (1 - mean * (order === 2 ? 0.5 : 0.75)), 5, 100)
    return {
      id: e.id, name: e.name, category: e.category, latitude: e.latitude, longitude: e.longitude, order,
      metric: order === 1 ? (e.category === 'TRANSPORT_HUB' ? 'on-time performance' : 'footfall vs. normal') : order === 2 ? 'occupancy/demand vs. normal' : 'staff availability vs. normal',
      baseline: Math.round(baseline), projected: Math.round(projected), deltaPct: Math.round(((projected - baseline) / baseline) * 100),
      meanRiskPct: Math.round(mean * 100), uncertaintyPct: Math.round(clamp(8 + mean * 18, 5, 32)),
      rationale: 'Offline local estimate (Voyara API unreachable) - reconnect for the full cascading model.',
    }
  })
  const meanDisruptionPct = Math.round(impacts.reduce((s, i) => s + i.meanRiskPct, 0) / impacts.length)
  const uncertaintyPct = Math.round(impacts.reduce((s, i) => s + i.uncertaintyPct, 0) / impacts.length)
  return {
    scenario, generatedAt: new Date().toISOString(),
    overall: { meanDisruptionPct, uncertaintyPct, entitiesAtElevatedRisk: impacts.filter(i => i.meanRiskPct >= 30).length, cascadeDepth: 3 },
    impacts,
    cascadeNarrative: ['Offline demo mode: showing locally simulated cascade because the Voyara API could not be reached.'],
  }
}

function localState(cityId: TwinCityId): TwinState {
  const weather = FALLBACK_WEATHER[cityId]
  const scenario: TwinScenario = { rainIntensity: weather.precipitationProbability, temperatureC: weather.temperatureC, stormDurationHours: weather.precipitationProbability > 60 ? 12 : 3, floodLevel: Math.round(Math.max(0, weather.precipitationMm - 20) * 1.5) }
  return { city: FALLBACK_CITIES[cityId], entities: FALLBACK_ENTITIES[cityId], weather, social: FALLBACK_SOCIAL[cityId], simulation: localSimulate(cityId, scenario) }
}

export function listTwinCities(): TwinCityInfo[] { return Object.values(FALLBACK_CITIES) }

export async function getTwinState(cityId: TwinCityId, scenario?: Partial<TwinScenario>): Promise<TwinState> {
  const params = new URLSearchParams({ city: cityId })
  if (scenario?.rainIntensity !== undefined) params.set('rain', String(scenario.rainIntensity))
  if (scenario?.temperatureC !== undefined) params.set('temperature', String(scenario.temperatureC))
  if (scenario?.stormDurationHours !== undefined) params.set('stormHours', String(scenario.stormDurationHours))
  if (scenario?.floodLevel !== undefined) params.set('flood', String(scenario.floodLevel))
  try {
    return await apiRequest<TwinState>(`/digital-twin/state?${params.toString()}`)
  } catch (error) {
    if (error instanceof ApiUnavailableError) return localState(cityId)
    throw error
  }
}

export async function simulateTwin(cityId: TwinCityId, scenario: TwinScenario): Promise<TwinSimulateResult> {
  try {
    return await apiRequest<TwinSimulateResult>('/digital-twin/simulate', { method: 'POST', body: JSON.stringify({ city: cityId, ...scenario }) })
  } catch (error) {
    if (error instanceof ApiUnavailableError) {
      return { city: FALLBACK_CITIES[cityId], entities: FALLBACK_ENTITIES[cityId], weather: FALLBACK_WEATHER[cityId], simulation: localSimulate(cityId, scenario) }
    }
    throw error
  }
}
