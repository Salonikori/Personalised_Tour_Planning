// Live, keyless places provider. Nominatim resolves the destination to coordinates, Overpass pulls
// real points of interest around that coordinate, and Wikipedia supplies short descriptions where
// available. Everything here is genuinely LIVE data - no invented hotels, prices, or attractions.
import type {
  PlaceResult,
  PlaceSearchParams,
  PlacesProvider,
  ResolvedDestination,
} from './types.js'
import { nowIso } from './types.js'

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
const WIKIPEDIA_SUMMARY_URL = 'https://en.wikipedia.org/api/rest_v1/page/summary'

async function fetchJson(url: string, timeoutMs = 8_000): Promise<unknown> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'TripPilot/1.0 destination discovery (contact: ops@trippilot.app)' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`${url} returned ${response.status}`)
  return response.json()
}

export function destinationKeyFor(displayName: string, city: string) {
  return city
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
    .replace(/\s+/g, '-') || displayName.toLowerCase().replace(/\s+/g, '-')
}

const OVERPASS_CATEGORY_FILTERS: Record<string, string> = {
  attraction: 'nwr["tourism"~"attraction|museum|gallery|viewpoint|zoo|theme_park"]',
  landmark: 'nwr["historic"]',
  culture: 'nwr["amenity"~"place_of_worship|arts_centre|theatre"]',
  park: 'nwr["leisure"~"park|garden"]',
  restaurant: 'nwr["amenity"~"restaurant|cafe|fast_food"]',
  shopping: 'nwr["shop"~"mall|department_store"]',
  nightlife: 'nwr["amenity"~"bar|nightclub|pub"]',
  // Transfers: real, mappable transport hubs - never invented, same live Overpass source as
  // everything else.
  airport: 'nwr["aeroway"="aerodrome"]',
  train_station: 'nwr["railway"="station"]',
  bus_station: 'nwr["amenity"~"bus_station|ferry_terminal"]',
}

// "Places" (spec's places/activities/transfers split) all come out of one Overpass query - this
// is what buckets a raw tag set into a category, independent of which filter matched it, so
// something double-tagged (e.g. a museum inside a historic building) still lands in one place.
export const ALL_PLACE_CATEGORIES = Object.keys(OVERPASS_CATEGORY_FILTERS)
const PLACE_TAG_VALUES = new Set(['attraction', 'museum', 'gallery', 'viewpoint', 'zoo', 'theme_park', 'place_of_worship', 'arts_centre', 'theatre', 'park', 'garden'])
const ACTIVITY_TAG_VALUES = new Set(['restaurant', 'cafe', 'fast_food', 'mall', 'department_store', 'bar', 'nightclub', 'pub'])

function classifyPlace(tags: Record<string, string>): { type: string; category: 'place' | 'activity' | 'transfer' } {
  if (tags.aeroway === 'aerodrome') return { type: 'airport', category: 'transfer' }
  if (tags.railway === 'station') return { type: 'train_station', category: 'transfer' }
  if (tags.amenity === 'bus_station') return { type: 'bus_station', category: 'transfer' }
  if (tags.amenity === 'ferry_terminal') return { type: 'ferry_terminal', category: 'transfer' }
  if (tags.historic) return { type: tags.historic, category: 'place' }
  if (tags.tourism && PLACE_TAG_VALUES.has(tags.tourism)) return { type: tags.tourism, category: 'place' }
  if (tags.leisure && PLACE_TAG_VALUES.has(tags.leisure)) return { type: tags.leisure, category: 'place' }
  if (tags.amenity && PLACE_TAG_VALUES.has(tags.amenity)) return { type: tags.amenity, category: 'place' }
  if (tags.amenity && ACTIVITY_TAG_VALUES.has(tags.amenity)) return { type: tags.amenity, category: 'activity' }
  if (tags.shop && ACTIVITY_TAG_VALUES.has(tags.shop)) return { type: tags.shop, category: 'activity' }
  // Fall through: whatever tag we actually matched on, default to "place" rather than dropping it.
  const type = tags.tourism || tags.historic || tags.amenity || tags.leisure || tags.shop || 'attraction'
  return { type, category: 'place' }
}

async function geocode(query: string): Promise<{
  lat: number
  lon: number
  displayName: string
  address: Record<string, string>
} | null> {
  // First try Nominatim
  try {
    const results = (await fetchJson(
      `${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=jsonv2&addressdetails=1&limit=1`,
      12_000
    )) as Array<{
      lat: string
      lon: string
      display_name: string
      address?: Record<string, string>
    }>

    const place = results[0]

    if (place) {
      return {
        lat: Number(place.lat),
        lon: Number(place.lon),
        displayName: place.display_name,
        address: place.address || {},
      }
    }
  } catch (error) {
    console.warn(`Nominatim failed for "${query}":`, error)
  }

  // Fallback to Photon if Nominatim is unavailable/rate-limited
  try {
    const photon = (await fetchJson(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1`,
      10_000
    )) as {
      features?: Array<{
        geometry?: {
          coordinates?: [number, number]
        }
        properties?: Record<string, string>
      }>
    }

    const feature = photon.features?.[0]
    const coordinates = feature?.geometry?.coordinates

    if (!coordinates || coordinates.length < 2) return null

    const properties = feature.properties || {}

    return {
      lat: coordinates[1],
      lon: coordinates[0],
      displayName:
        properties.name ||
        properties.city ||
        query,
      address: properties,
    }
  } catch (error) {
    console.warn(`Photon fallback failed for "${query}":`, error)
    return null
  }
}

async function wikipediaBlurb(title: string): Promise<string | undefined> {
  try {
    const summary = (await fetchJson(
      `${WIKIPEDIA_SUMMARY_URL}/${encodeURIComponent(title)}`,
      4_000
    )) as { extract?: string }
    return summary.extract
  } catch {
    return undefined
  }
}

export class OsmPlacesProvider implements PlacesProvider {
  readonly name = 'OpenStreetMap (Nominatim + Overpass)'

  isConfigured() {
    return true // keyless public API - always "configured", but still a real network dependency
  }

  async resolveDestination(query: string): Promise<ResolvedDestination | null> {
    const geo = await geocode(query)
    if (!geo) return null
    const city =
      geo.address.city || geo.address.town || geo.address.village || geo.address.county || query.split(',')[0].trim()
    return {
      query,
      city,
      region: geo.address.state,
      countryCode: geo.address.country_code?.toUpperCase(),
      displayName: geo.displayName,
      latitude: geo.lat,
      longitude: geo.lon,
      destinationKey: destinationKeyFor(geo.displayName, city),
    }
  }

  async searchPlaces(params: PlaceSearchParams): Promise<PlaceResult[]> {
    const categories = params.categories?.length ? params.categories : ['attraction', 'landmark', 'culture', 'park']
    const filters = categories.map((category) => OVERPASS_CATEGORY_FILTERS[category]).filter(Boolean)
    if (!filters.length) return []

    const radius = 15_000
    const query = `[out:json][timeout:15];(${filters
      .map((filter) => `${filter}(around:${radius},${params.destination.latitude},${params.destination.longitude});`)
      .join('')});out center ${Math.min(params.limit ?? 40, 60)};`

    const payload = (await fetchJson(`${OVERPASS_URL}?data=${encodeURIComponent(query)}`, 15_000)) as {
      elements?: Array<{ type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }>
    }

    const seen = new Set<string>()
    const checkedAt = nowIso()
    const results: PlaceResult[] = []

    for (const element of payload.elements || []) {
      const tags = element.tags || {}
      const name = tags.name
      if (!name || seen.has(name.toLowerCase())) continue
      seen.add(name.toLowerCase())

      const lat = element.lat ?? element.center?.lat
      const lon = element.lon ?? element.center?.lon
      if (typeof lat !== 'number' || typeof lon !== 'number') continue

      const { type, category } = classifyPlace(tags)

      results.push({
        id: `osm:${element.type}:${element.id}`,
        name,
        type,
        category,
        address: [tags['addr:housenumber'], tags['addr:street'], tags['addr:city']].filter(Boolean).join(' ') || undefined,
        latitude: lat,
        longitude: lon,
        openingHours: tags.opening_hours,
        price: { amount: null, currency: 'INR', status: 'UNAVAILABLE' },
        // OSM/Wikipedia never expose a purchasable rate or booking flow for these - honestly false.
        bookable: false,
        meta: {
          source: 'OpenStreetMap',
          sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
          checkedAt,
          status: 'LIVE',
        },
      })

      if (results.length >= (params.limit ?? 40)) break
    }

    // Enrich the first handful with a short live Wikipedia description - kept small to stay fast.
    const enrichable = results.filter((place) => ['attraction', 'museum', 'historic', 'gallery'].includes(place.type)).slice(0, 6)
    await Promise.all(
      enrichable.map(async (place) => {
        place.description = await wikipediaBlurb(place.name)
      })
    )

    return results
  }
}

export const placesProvider = new OsmPlacesProvider()
