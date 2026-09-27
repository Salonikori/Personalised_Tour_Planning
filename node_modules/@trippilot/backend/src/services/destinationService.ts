import { ItemType, Prisma, type PrismaClient } from '@prisma/client'

type InventoryWithVendor = Prisma.InventoryItemGetPayload<{ include: { vendor: true } }>
type DiscoveryInput = { destination: string; preferences?: unknown; budget?: number }
const CACHE_TTL_MS = 12 * 60 * 60 * 1000
const cache = new Map<string, { expiresAt: number; items: InventoryWithVendor[] }>()
const aliases: Record<string, string[]> = { delhi: ['new delhi'], 'new delhi': ['delhi'] }

export function normalizeDestination(destination: string) {
  const cleaned = destination.toLowerCase().normalize('NFKD').replace(/[^a-z0-9, ]/g, ' ').replace(/\s+/g, ' ').trim()
  const city = (cleaned.split(',')[0] || cleaned).trim().replace(/\s+(india|france|japan|indonesia|usa|united states|uk|united kingdom)$/, '')
  return city === 'new delhi' ? 'delhi' : city
}
function words(value: string) { return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean) }
function hasPhrase(haystack: string, phrase: string) { const source = words(haystack); const needle = words(phrase); return needle.length > 0 && source.some((_, start) => needle.every((word, offset) => source[start + offset] === word)) }
function isDestinationMatch(item: { location: string; tags: unknown }, key: string) { const tags = Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === 'string') : []; return [key, ...(aliases[key] || [])].some((candidate) => hasPhrase(item.location, candidate) || tags.includes(`destination:${candidate}`)) }
async function fetchJson(url: string) { const response = await fetch(url, { headers: { 'User-Agent': 'TripPilot/1.0 destination discovery' }, signal: AbortSignal.timeout(8_000) }); if (!response.ok) throw new Error(`Map service returned ${response.status}`); return response.json() as Promise<unknown> }
type OsmPlace = { id: string; title: string; type: ItemType; location: string; tags: string[] }
type CatalogEntry = { title: string; type: ItemType; category: string }

// Thrown only when BOTH live discovery (Nominatim/Overpass) AND the tiny curated catalog below
// have nothing for this destination - i.e. genuinely no inventory could be produced right now.
// This is a transient/network condition, not a statement that the destination itself is
// unsupported: live discovery works for any real place on earth, for any city the traveler
// types. `retryable: true` lets callers surface an honest "try again" instead of a dead end.
export class DestinationDiscoveryUnavailableError extends Error {
  readonly retryable = true
  constructor(destination: string) {
    super(`Live destination discovery is temporarily unavailable for "${destination}". This is not limited to specific cities — it usually means the map/places services could not be reached just now. Please try again in a moment.`)
    this.name = 'DestinationDiscoveryUnavailableError'
  }
}

// This curated catalog is a small, best-effort BONUS fallback for a handful of example cities -
// it exists purely so the app still has something to show if live discovery (Nominatim/Overpass)
// is briefly unreachable for one of these five. It is NOT the list of "supported" destinations:
// live discovery itself works for any city the traveler types. For any destination not listed
// here, if live discovery also fails, getDestinationInventory throws
// DestinationDiscoveryUnavailableError (retryable) rather than pretending the destination isn't
// supported. Feel free to add more cities here purely to widen offline fallback resilience.
const offlineCatalog: Record<string, CatalogEntry[]> = {
  delhi: [{ title: 'Arrival at Indira Gandhi International Airport (planning placeholder)', type: ItemType.FLIGHT, category: 'transport' }, { title: 'The Imperial New Delhi (accommodation recommendation)', type: ItemType.HOTEL, category: 'accommodation' }, { title: 'Airport to Central Delhi transfer (planning placeholder)', type: ItemType.TRANSFER, category: 'transport' }, ...['India Gate', 'Red Fort', 'Qutub Minar', "Humayun's Tomb", 'Lotus Temple', 'Chandni Chowk', 'Akshardham'].map((title) => ({ title, type: ItemType.ACTIVITY, category: 'attraction' })), { title: 'Departure from Indira Gandhi International Airport (planning placeholder)', type: ItemType.FLIGHT, category: 'transport' }],
  mumbai: [{ title: 'Arrival at Chhatrapati Shivaji Maharaj International Airport (planning placeholder)', type: ItemType.FLIGHT, category: 'transport' }, { title: 'The Taj Mahal Palace, Mumbai (accommodation recommendation)', type: ItemType.HOTEL, category: 'accommodation' }, { title: 'Airport to South Mumbai transfer (planning placeholder)', type: ItemType.TRANSFER, category: 'transport' }, ...['Gateway of India', 'Chhatrapati Shivaji Maharaj Terminus', 'Elephanta Caves', 'Marine Drive', 'Chhatrapati Shivaji Maharaj Vastu Sangrahalaya', 'Sanjay Gandhi National Park', 'Bandra Fort'].map((title) => ({ title, type: ItemType.ACTIVITY, category: 'attraction' })), { title: 'Departure from Chhatrapati Shivaji Maharaj International Airport (planning placeholder)', type: ItemType.FLIGHT, category: 'transport' }],
  goa: [{ title: 'Arrival at Manohar International Airport (planning placeholder)', type: ItemType.FLIGHT, category: 'transport' }, { title: 'Taj Resort & Convention Centre Goa (accommodation recommendation)', type: ItemType.HOTEL, category: 'accommodation' }, { title: 'Airport to North Goa transfer (planning placeholder)', type: ItemType.TRANSFER, category: 'transport' }, ...['Basilica of Bom Jesus', 'Fort Aguada', 'Chapora Fort', 'Dudhsagar Falls', 'Palolem Beach', 'Anjuna Beach', 'Salim Ali Bird Sanctuary'].map((title) => ({ title, type: ItemType.ACTIVITY, category: 'attraction' })), { title: 'Departure from Manohar International Airport (planning placeholder)', type: ItemType.FLIGHT, category: 'transport' }],
  paris: [{ title: 'Arrival at Paris Charles de Gaulle Airport (planning placeholder)', type: ItemType.FLIGHT, category: 'transport' }, { title: 'Hôtel Le Meurice (accommodation recommendation)', type: ItemType.HOTEL, category: 'accommodation' }, { title: 'Airport to central Paris transfer (planning placeholder)', type: ItemType.TRANSFER, category: 'transport' }, ...['Eiffel Tower', 'Louvre Museum', 'Notre-Dame de Paris', "Musée d'Orsay", 'Arc de Triomphe', 'Sacré-Cœur', 'Luxembourg Gardens'].map((title) => ({ title, type: ItemType.ACTIVITY, category: 'attraction' })), { title: 'Departure from Paris Charles de Gaulle Airport (planning placeholder)', type: ItemType.FLIGHT, category: 'transport' }],
  tokyo: [{ title: 'Arrival at Tokyo Haneda Airport (planning placeholder)', type: ItemType.FLIGHT, category: 'transport' }, { title: 'Hotel New Otani Tokyo (accommodation recommendation)', type: ItemType.HOTEL, category: 'accommodation' }, { title: 'Airport to central Tokyo transfer (planning placeholder)', type: ItemType.TRANSFER, category: 'transport' }, ...['Senso-ji', 'Tokyo Skytree', 'Meiji Jingu', 'Shibuya Crossing', 'Tokyo National Museum', 'Ueno Park', 'Imperial Palace East Gardens'].map((title) => ({ title, type: ItemType.ACTIVITY, category: 'attraction' })), { title: 'Departure from Tokyo Haneda Airport (planning placeholder)', type: ItemType.FLIGHT, category: 'transport' }],
}
function catalogPlaces(destination: string, key: string): OsmPlace[] {
  return (offlineCatalog[key] || []).map((entry, index) => ({ id: `catalog:${key}:${index + 1}`, title: entry.title, type: entry.type, location: destination, tags: [entry.type.toLowerCase(), 'curated', 'catalog-v2', `destination:${key}`, entry.category] }))
}
async function discover(destination: string, key: string): Promise<OsmPlace[]> {
  console.log(`🌍 DESTINATION: ${destination}`); console.log('🔎 DISCOVERING DESTINATION INVENTORY...')
  const geocoded = await fetchJson(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(destination)}&format=jsonv2&limit=1`) as Array<{ lat: string; lon: string; display_name: string }>
  const place = geocoded[0]; if (!place) throw new Error('Destination could not be resolved.')
  const query = `[out:json][timeout:8];(nwr["tourism"~"attraction|museum|gallery|viewpoint|zoo|theme_park"](around:15000,${place.lat},${place.lon});nwr["historic"](around:15000,${place.lat},${place.lon});nwr["amenity"~"place_of_worship|arts_centre|theatre"](around:15000,${place.lat},${place.lon});nwr["leisure"~"park|garden"](around:15000,${place.lat},${place.lon}););out center 45;`
  const payload = await fetchJson(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`) as { elements?: Array<{ type: string; id: number; tags?: Record<string, string> }> }
  const seen = new Set<string>(); const results = (payload.elements || []).flatMap((element) => { const tags = element.tags || {}; const title = tags.name; if (!title || seen.has(title.toLowerCase())) return []; seen.add(title.toLowerCase()); const category = tags.tourism || tags.historic || tags.amenity || tags.leisure || 'attraction'; return [{ id: `osm:${element.type}:${element.id}`, title, type: ItemType.ACTIVITY, location: place.display_name, tags: ['activity', 'osm', `destination:${key}`, category] }] })
  console.log(`📍 DISCOVERED ${results.length} DESTINATION PLACES`); return results
}
async function persistDiscoveries(prisma: PrismaClient, places: OsmPlace[], source = 'osm'): Promise<InventoryWithVendor[]> {
  if (!places.length) return []
  const vendor = await prisma.vendor.upsert({ where: { name: 'OpenStreetMap Discovery' }, create: { name: 'OpenStreetMap Discovery', category: 'Discovery', availability: 'Planning only', priceRange: 'Unknown', reliabilityScore: 0, confirmationRate: 0, cancellationRate: 0, responseTime: 0 }, update: {} })
  const all = await prisma.inventoryItem.findMany({ include: { vendor: true } }); const ids = new Set(places.map((place) => place.id))
  for (const place of places) { const existing = all.find((item) => Array.isArray(item.tags) && item.tags.includes(place.id)); if (existing) await prisma.inventoryItem.update({ where: { id: existing.id }, data: { type: place.type, title: place.title, location: place.location, tags: [...place.tags, place.id], source, bookable: false } }); else await prisma.inventoryItem.create({ data: { vendorId: vendor.id, type: place.type, title: place.title, location: place.location, price: 0, availability: 'Discovery only', tags: [...place.tags, place.id], source, bookable: false } }) }
  const saved = await prisma.inventoryItem.findMany({ include: { vendor: true } }); return saved.filter((item) => Array.isArray(item.tags) && item.tags.some((tag) => typeof tag === 'string' && ids.has(tag)))
}
export async function getDestinationInventory(prisma: PrismaClient, input: DiscoveryInput): Promise<InventoryWithVendor[]> {
  const key = normalizeDestination(input.destination); const cached = cache.get(key)
  if (cached && cached.expiresAt > Date.now()) { console.log(`💾 DESTINATION CACHE HIT: ${input.destination}`); return cached.items }
  const existing = await prisma.inventoryItem.findMany({ where: { availability: { not: 'Unavailable' } }, include: { vendor: true } }); const matched = existing.filter((item) => isDestinationMatch(item, key))
  const verified = matched.filter((item) => item.source !== 'catalog')
  if (verified.length) { cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, items: verified }); return verified }
  const currentCatalog = matched.filter((item) => item.source === 'catalog' && Array.isArray(item.tags) && item.tags.includes('catalog-v2'))
  if (currentCatalog.length) { cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, items: currentCatalog }); return currentCatalog }
  try {
    const discovered = await persistDiscoveries(prisma, await discover(input.destination, key))
    if (discovered.length) { cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, items: discovered }); return discovered }
    throw new Error('No destination places were returned.')
  } catch (error) {
    console.warn('⚠️ DESTINATION DISCOVERY FAILED', error instanceof Error ? error.message : error)
    // Curated fallback only exists for a handful of example cities (see offlineCatalog above) -
    // it is a bonus, not the definition of what's supported.
    const fallback = catalogPlaces(input.destination, key)
    if (fallback.length) {
      console.warn(`⚠️ USING CURATED DESTINATION FALLBACK: ${fallback.length} places`)
      const saved = await persistDiscoveries(prisma, fallback, 'catalog')
      cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, items: saved })
      return saved
    }
    // No curated fallback for this destination and live discovery just failed - be explicit
    // that this is a retryable, temporary condition, not "this destination isn't supported".
    console.warn(`⚠️ NO CURATED FALLBACK FOR "${input.destination}" — reporting a retryable discovery error instead of silently failing.`)
    throw new DestinationDiscoveryUnavailableError(input.destination)
  }
}
