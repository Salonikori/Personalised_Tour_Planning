import { placesProvider } from './providers/placesProvider.js'
import type { ResolvedDestination } from './providers/types.js'

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
const RADIUS_METERS = 15_000

async function fetchJson(url: string) {
  const response = await fetch(url, { headers: { 'User-Agent': 'TripPilot/1.0 safety assist' }, signal: AbortSignal.timeout(12_000) })
  if (!response.ok) throw new Error(`Overpass returned ${response.status}`)
  return response.json() as Promise<{ elements?: Array<{ type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string,string> }> }>
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const rad = Math.PI / 180
  const a = Math.sin((lat2-lat1)*rad/2)**2 + Math.cos(lat1*rad)*Math.cos(lat2*rad)*Math.sin((lon2-lon1)*rad/2)**2
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

export async function getNearbyHelp(position: { lat?: number | null; lng?: number | null }, destination: ResolvedDestination) {
  const lat = typeof position.lat === 'number' ? position.lat : destination.latitude
  const lng = typeof position.lng === 'number' ? position.lng : destination.longitude
  const query = `[out:json][timeout:20];(nwr["amenity"="hospital"](around:${RADIUS_METERS},${lat},${lng});nwr["amenity"="clinic"](around:${RADIUS_METERS},${lat},${lng});nwr["diplomatic"="embassy"](around:${RADIUS_METERS},${lat},${lng});nwr["office"="diplomatic"](around:${RADIUS_METERS},${lat},${lng}););out center 30;`
  const payload = await fetchJson(`${OVERPASS_URL}?data=${encodeURIComponent(query)}`)
  const seen = new Set<string>()
  return (payload.elements || []).map((element) => {
    const tags = element.tags || {}
    const name = tags.name || (tags.amenity === 'hospital' ? 'Hospital' : tags.diplomatic === 'embassy' ? 'Embassy' : 'Nearby help')
    const itemLat = element.lat ?? element.center?.lat
    const itemLng = element.lon ?? element.center?.lon
    if (typeof itemLat !== 'number' || typeof itemLng !== 'number') return null
    const kind = tags.amenity === 'hospital' || tags.amenity === 'clinic' ? 'HOSPITAL' : 'EMBASSY'
    const key = `${name.toLowerCase()}|${kind}`
    if (seen.has(key)) return null
    seen.add(key)
    return { id: `osm:${element.type}:${element.id}`, name, type: kind, distanceKm: Number(distanceKm(lat,lng,itemLat,itemLng).toFixed(1)), latitude: itemLat, longitude: itemLng }
  }).filter(Boolean).sort((a,b) => (a!.distanceKm - b!.distanceKm)).slice(0, 12) as Array<{id:string;name:string;type:string;distanceKm:number;latitude:number;longitude:number}>
}

export async function resolveTripHelp(position: { lat?: number | null; lng?: number | null }, destinationQuery: string) {
  const destination = await placesProvider.resolveDestination(destinationQuery)
  if (!destination) throw new Error('Destination could not be geocoded.')
  return getNearbyHelp(position, destination)
}
