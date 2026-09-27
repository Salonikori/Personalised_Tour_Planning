// Deterministic normalization + validation layer (spec sections 9 & 10). The orchestration layer may
// rank and explain results, but every item that reaches the client passes through here first:
// duplicates are removed, coordinates are sanity-checked, and anything outside the requested
// destination is dropped. This runs regardless of which provider produced the item.
import type { HotelResult, PlaceResult, ResolvedDestination } from './providers/types.js'

const EARTH_RADIUS_KM = 6371
const MAX_DISTANCE_KM = 60 // generous enough for greater-metro-area venues, tight enough to reject cross-city leakage

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (value: number) => (value * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a))
}

export function isWithinDestination(destination: ResolvedDestination, lat?: number, lon?: number): boolean {
  if (typeof lat !== 'number' || typeof lon !== 'number' || Number.isNaN(lat) || Number.isNaN(lon)) return false
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false
  return haversineKm(destination.latitude, destination.longitude, lat, lon) <= MAX_DISTANCE_KM
}

export function dedupePlaces(places: PlaceResult[]): PlaceResult[] {
  const seen = new Set<string>()
  return places.filter((place) => {
    const key = place.name.trim().toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function validatePlaces(destination: ResolvedDestination, places: PlaceResult[]): PlaceResult[] {
  return dedupePlaces(places).filter((place) => isWithinDestination(destination, place.latitude, place.longitude))
}

// Splits one validated, deduped PlaceResult list (which can contain places, activities, and
// transfers all mixed together, since they all come out of the same Overpass query) into the
// three buckets the UI/spec expects. Deterministic - purely reads the category the provider
// already assigned per-item, never re-derives it from the LLM.
export function splitPlacesByCategory(places: PlaceResult[]) {
  return {
    places: places.filter((place) => place.category === 'place'),
    activities: places.filter((place) => place.category === 'activity'),
    transfers: places.filter((place) => place.category === 'transfer'),
  }
}

export function dedupeHotels(hotels: HotelResult[]): HotelResult[] {
  const seen = new Set<string>()
  return hotels.filter((hotel) => {
    const key = hotel.name.trim().toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function validateHotels(destination: ResolvedDestination, hotels: HotelResult[]): HotelResult[] {
  return dedupeHotels(hotels).filter((hotel) => {
    // Curated/estimated hotels have no coordinates to check - keep them (they're clearly tagged),
    // but any hotel that DOES report coordinates must actually be near the destination.
    if (typeof hotel.latitude !== 'number' || typeof hotel.longitude !== 'number') return true
    return isWithinDestination(destination, hotel.latitude, hotel.longitude)
  })
}

export function rankPlacesByPreference(places: PlaceResult[], interests: string[] = []): PlaceResult[] {
  if (!interests.length) return places
  const normalizedInterests = interests.map((interest) => interest.toLowerCase())
  const score = (place: PlaceResult) => {
    const haystack = `${place.type} ${place.name} ${place.description || ''}`.toLowerCase()
    return normalizedInterests.reduce((total, interest) => total + (haystack.includes(interest) ? 1 : 0), 0)
  }
  return [...places].sort((a, b) => score(b) - score(a))
}
