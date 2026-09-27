import { ApiUnavailableError, apiRequest, subscribeToTripEvents } from './apiClient'

export type SafetyZone = {
  id: string
  latitude: number
  longitude: number
  reportCount: number
  status: 'SAFE' | 'CAUTION' | 'UNSAFE'
  reason: string | null
  confidence: number | null
  updatedAt: string
}

export type SafetyReport = {
  id: string
  latitude: number
  longitude: number
  category: string
  message: string | null
  createdAt: string
  user?: { id: string; name: string; email: string }
  trip?: { id: string; destination: string } | null
  zone?: { id: string; reportCount: number; aiStatus: string; aiReason: string | null }
}

// Local fallback safety zones, used only when the Voyara API cannot be reached at all
// (ApiUnavailableError - a genuine network/server outage, never a normal 4xx/5xx response).
// This keeps the safety heatmap and the report flow fully usable offline, seeded around
// Panvel so the map always has something meaningful to show and interact with.
const localZonesKey = 'trippilot-local-safety-zones'
const localZonesSeed: SafetyZone[] = [
  { id: 'zone-panvel-station', latitude: 18.9886, longitude: 73.1101, reportCount: 6, status: 'UNSAFE', reason: 'Multiple reports of theft and harassment near the railway station at night.', confidence: 0.81, updatedAt: new Date().toISOString() },
  { id: 'zone-panvel-old-city', latitude: 18.9894, longitude: 73.1175, reportCount: 4, status: 'UNSAFE', reason: 'Poorly lit lanes with repeated safety concerns reported after dark.', confidence: 0.72, updatedAt: new Date().toISOString() },
  { id: 'zone-new-panvel', latitude: 18.9963, longitude: 73.1080, reportCount: 2, status: 'CAUTION', reason: 'A few reports of scams targeting travelers near the bus depot.', confidence: 0.54, updatedAt: new Date().toISOString() },
  { id: 'zone-kalamboli', latitude: 19.0166, longitude: 73.1010, reportCount: 5, status: 'UNSAFE', reason: 'Reported road hazards and unsafe crossings around the junction.', confidence: 0.69, updatedAt: new Date().toISOString() },
]

function loadLocalZones(): SafetyZone[] {
  try {
    const raw = localStorage.getItem(localZonesKey)
    if (raw) return JSON.parse(raw) as SafetyZone[]
  } catch { /* storage unavailable - fall through to seed */ }
  try { localStorage.setItem(localZonesKey, JSON.stringify(localZonesSeed)) } catch { /* storage unavailable */ }
  return localZonesSeed
}

function saveLocalZones(zones: SafetyZone[]) {
  try { localStorage.setItem(localZonesKey, JSON.stringify(zones)) } catch { /* storage unavailable */ }
}

// Simple haversine-lite distance in km, precise enough to decide whether a new report should
// merge into a nearby zone rather than always creating a fresh pin.
function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(a))
}

function statusForCount(count: number): SafetyZone['status'] { return count >= 4 ? 'UNSAFE' : count >= 2 ? 'CAUTION' : 'SAFE' }

export async function getSafetyZones() {
  let liveZones: SafetyZone[] = []
  try { liveZones = (await apiRequest<{ zones: SafetyZone[] }>('/safety/zones')).zones }
  catch (error) { if (!(error instanceof ApiUnavailableError)) throw error }
  const localZones = loadLocalZones()
  // Always keep the local Panvel zones on the map alongside whatever live reports exist, unless
  // a live zone already covers that same spot (avoids showing a duplicate pin for the same area).
  const extraLocalZones = localZones.filter((local) => !liveZones.some((live) => distanceKm(live.latitude, live.longitude, local.latitude, local.longitude) < 1))
  return [...liveZones, ...extraLocalZones]
}

export async function logSafetyMapClick(lat: number, lng: number) {
  try { return await apiRequest<{ ok: true }>('/safety/interactions', { method: 'POST', body: JSON.stringify({ lat, lng }) }) }
  catch (error) { if (error instanceof ApiUnavailableError) return { ok: true as const }; throw error }
}

export async function createSafetyReport(input: { lat: number; lng: number; tripId?: string; category?: string; message?: string }) {
  try { return await apiRequest<{ report: { id: string; createdAt: string }; zone: SafetyZone }>('/safety/reports', { method: 'POST', body: JSON.stringify(input) }) }
  catch (error) {
    if (!(error instanceof ApiUnavailableError)) throw error
    const zones = loadLocalZones()
    const nearby = zones.find((zone) => distanceKm(zone.latitude, zone.longitude, input.lat, input.lng) < 1)
    const createdAt = new Date().toISOString()
    let zone: SafetyZone
    if (nearby) {
      nearby.reportCount += 1
      nearby.status = statusForCount(nearby.reportCount)
      nearby.updatedAt = createdAt
      zone = nearby
    } else {
      zone = { id: `zone-local-${Date.now()}`, latitude: input.lat, longitude: input.lng, reportCount: 1, status: 'CAUTION', reason: input.message?.trim() || 'Reported by a traveler.', confidence: 0.4, updatedAt: createdAt }
      zones.push(zone)
    }
    saveLocalZones(zones)
    return { report: { id: `report-local-${Date.now()}`, createdAt }, zone }
  }
}
export function subscribeToSafetyUpdates(onUpdate: () => void) { return subscribeToTripEvents((event) => { if (event === 'safety-zone-updated') onUpdate() }) }

export type AdminSafetyMap = { zones: SafetyZone[]; reports: SafetyReport[]; clicks: Array<{ id: string; createdAt: string; metadata: Record<string, unknown> | null; userId: string | null }>; clicksByZone: Record<string, number>; summary: { totalReports: number; totalZones: number; unsafeZones: number; cautionZones: number; totalClicks: number } }
export async function getAdminSafetyMap() { return apiRequest<AdminSafetyMap>('/admin/safety-map') }
