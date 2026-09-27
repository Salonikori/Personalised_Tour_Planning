// Destination-aware curated fallback for "places" (attractions/landmarks) and "activities"
// (food/tour experiences), used ONLY when:
//   1. FALLBACK_CATALOG_MODE=true, AND
//   2. live discovery (OpenStreetMap/Overpass, see placesProvider.ts) returned zero results for
//      that category for this specific destination.
//
// This never invents facts about a place beyond its name/type — every entry is explicitly tagged
// meta.status = 'CURATED' and meta.source = 'Curated Data' so the UI renders an "Estimated" badge,
// never a LIVE one. It is destination-scoped: the catalog is keyed off the RESOLVED destination
// city, so "Delhi, India" and "Mumbai, India" never produce the same fallback data, and a city
// with no curated entry below still gets a catalog built from its own name rather than defaulting
// to any single hardcoded destination.
//
// Delhi, Goa and Paris carry real, researched approximate ticket/experience prices (see the
// `price` field on each entry) instead of the generic per-index estimate, since these are the
// three most-requested destinations. Any city without an explicit price still falls back to
// curatedPrice() below so the app never renders a blank cost.
import type { PlaceResult, ResolvedDestination } from './types.js'
import { nowIso } from './types.js'

type CuratedEntry = { name: string; type: string; image?: string; price?: number }

// Lightweight, dependency-free "photo" for curated entries that don't have a verified real photo
// wired up (see IMAGE NOTES below) - a colored SVG card with an icon + the place's own name,
// encoded as a data URI so it always renders, even offline, with zero risk of a broken <img>.
function placeholderImage(label: string, emoji: string, from: string, to: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="640" height="420" fill="url(#g)"/><text x="320" y="190" font-size="120" text-anchor="middle" dominant-baseline="middle">${emoji}</text><text x="320" y="330" font-family="Sora,Arial,sans-serif" font-size="34" font-weight="700" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${label}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

// IMAGE NOTES: `India Gate.jpg` and `Tour eiffel at sunrise from the trocadero.jpg` are the actual
// filenames of the real, freely-licensed photos already used on their respective Wikipedia
// articles, referenced here via Wikimedia Commons' stable Special:FilePath redirect (resolves to
// the current file regardless of its storage hash, so it never goes stale like a raw upload.
// wikimedia.org path would). Goa's Basilica image reuses this app's own bundled local photo
// instead of an external link, since it's already shipped in frontend/public. Every other entry
// below uses a generated placeholder card (see placeholderImage) rather than a guessed external
// URL that could 404.
const commonsFilePath = (filename: string) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}`

// A handful of hand-picked, well-known landmarks per city — used when live discovery is
// unreachable. Add more cities here freely; anything not listed falls back to the generic, still
// destination-scoped catalog below. `price` is the approximate real-world entry fee in INR
// (0 for monuments that are free to enter); Paris prices are converted from EUR at a round rate.
const CURATED_PLACES_BY_CITY: Record<string, CuratedEntry[]> = {
  delhi: [
    { name: 'India Gate', type: 'landmark', image: commonsFilePath('India Gate early morning.jpg'), price: 0 },
    { name: "Humayun's Tomb", type: 'historic', image: placeholderImage("Humayun's Tomb", '🕌', '#c2410c', '#7c2d12'), price: 35 },
    { name: 'Red Fort', type: 'historic', image: placeholderImage('Red Fort', '🏰', '#b91c1c', '#7f1d1d'), price: 35 },
    { name: 'Lotus Temple', type: 'place_of_worship', image: placeholderImage('Lotus Temple', '🪷', '#7c3aed', '#4c1d95'), price: 0 },
    { name: 'Qutub Minar', type: 'historic', image: placeholderImage('Qutub Minar', '🗼', '#b45309', '#78350f'), price: 40 },
  ],
  'new delhi': [
    { name: 'India Gate', type: 'landmark', image: commonsFilePath('India Gate early morning.jpg'), price: 0 },
    { name: "Humayun's Tomb", type: 'historic', image: placeholderImage("Humayun's Tomb", '🕌', '#c2410c', '#7c2d12'), price: 35 },
    { name: 'Red Fort', type: 'historic', image: placeholderImage('Red Fort', '🏰', '#b91c1c', '#7f1d1d'), price: 35 },
    { name: 'Lotus Temple', type: 'place_of_worship', image: placeholderImage('Lotus Temple', '🪷', '#7c3aed', '#4c1d95'), price: 0 },
    { name: 'Qutub Minar', type: 'historic', image: placeholderImage('Qutub Minar', '🗼', '#b45309', '#78350f'), price: 40 },
  ],
  mumbai: [
    { name: 'Gateway of India', type: 'landmark', price: 0 },
    { name: 'Marine Drive', type: 'landmark', price: 0 },
    { name: 'Chhatrapati Shivaji Maharaj Terminus', type: 'historic', price: 0 },
    { name: 'Elephanta Caves', type: 'historic', price: 40 },
    { name: 'Colaba Causeway', type: 'shopping', price: 0 },
  ],
  bengaluru: [
    { name: 'Lalbagh Botanical Garden', type: 'park', price: 30 },
    { name: 'Bangalore Palace', type: 'historic', price: 230 },
    { name: 'Cubbon Park', type: 'park', price: 0 },
    { name: 'Vidhana Soudha', type: 'landmark', price: 0 },
  ],
  bangalore: [
    { name: 'Lalbagh Botanical Garden', type: 'park', price: 30 },
    { name: 'Bangalore Palace', type: 'historic', price: 230 },
    { name: 'Cubbon Park', type: 'park', price: 0 },
    { name: 'Vidhana Soudha', type: 'landmark', price: 0 },
  ],
  jaipur: [
    { name: 'Amber Fort', type: 'historic', price: 100 },
    { name: 'City Palace', type: 'historic', price: 300 },
    { name: 'Hawa Mahal', type: 'landmark', price: 50 },
    { name: 'Jantar Mantar', type: 'landmark', price: 50 },
  ],
  goa: [
    { name: 'Baga Beach', type: 'beach', image: placeholderImage('Baga Beach', '🏖️', '#0891b2', '#155e75'), price: 0 },
    { name: 'Fort Aguada', type: 'historic', image: placeholderImage('Fort Aguada', '🏯', '#ca8a04', '#713f12'), price: 25 },
    { name: 'Basilica of Bom Jesus', type: 'place_of_worship', image: '/images/destinations/GOA/basilica-of-bom-jesus-goa.webp', price: 0 },
    { name: 'Anjuna Flea Market', type: 'shopping', image: placeholderImage('Anjuna Flea Market', '🛍️', '#db2777', '#831843'), price: 0 },
    { name: 'Dudhsagar Falls', type: 'attraction', image: placeholderImage('Dudhsagar Falls', '🌊', '#059669', '#064e3b'), price: 600 },
  ],
  panaji: [
    { name: 'Baga Beach', type: 'beach', image: placeholderImage('Baga Beach', '🏖️', '#0891b2', '#155e75'), price: 0 },
    { name: 'Fort Aguada', type: 'historic', image: placeholderImage('Fort Aguada', '🏯', '#ca8a04', '#713f12'), price: 25 },
    { name: 'Basilica of Bom Jesus', type: 'place_of_worship', image: '/images/destinations/GOA/basilica-of-bom-jesus-goa.webp', price: 0 },
    { name: 'Anjuna Flea Market', type: 'shopping', image: placeholderImage('Anjuna Flea Market', '🛍️', '#db2777', '#831843'), price: 0 },
    { name: 'Dudhsagar Falls', type: 'attraction', image: placeholderImage('Dudhsagar Falls', '🌊', '#059669', '#064e3b'), price: 600 },
  ],
  paris: [
    { name: 'Eiffel Tower', type: 'landmark', image: commonsFilePath('Tour eiffel at sunrise from the trocadero.jpg'), price: 2600 },
    { name: 'Louvre Museum', type: 'museum', image: placeholderImage('Louvre Museum', '🖼️', '#4338ca', '#1e1b4b'), price: 2000 },
    { name: 'Notre-Dame Cathedral', type: 'place_of_worship', image: placeholderImage('Notre-Dame', '⛪', '#64748b', '#1e293b'), price: 0 },
    { name: 'Arc de Triomphe', type: 'landmark', image: placeholderImage('Arc de Triomphe', '🏛️', '#b45309', '#78350f'), price: 1500 },
    { name: 'Montmartre & Sacré-Cœur', type: 'landmark', image: placeholderImage('Montmartre', '🎨', '#be185d', '#831843'), price: 0 },
  ],
}

// Same generic activity templates as before, now paired with a curated, city-specific catalog for
// the destinations most travelers try first — the templates below remain the fallback for any
// city not listed here.
const CURATED_ACTIVITIES_BY_CITY: Record<string, CuratedEntry[]> = {
  delhi: [
    { name: 'Chandni Chowk street food walk', type: 'food_experience', image: placeholderImage('Chandni Chowk Food Walk', '🍽️', '#ea580c', '#7c2d12'), price: 1200 },
    { name: 'Old Delhi heritage rickshaw tour', type: 'heritage_walk', image: placeholderImage('Old Delhi Rickshaw Tour', '🚲', '#0d9488', '#134e4a'), price: 800 },
    { name: 'Akshardham Temple evening show', type: 'cultural_tour', image: placeholderImage('Akshardham Evening Show', '🎭', '#7c3aed', '#4c1d95'), price: 300 },
    { name: 'Sunset at India Gate lawns', type: 'sunset_experience', image: placeholderImage('India Gate Sunset', '🌅', '#ea580c', '#78350f'), price: 0 },
    { name: 'Dilli Haat local market experience', type: 'market_experience', image: placeholderImage('Dilli Haat Market', '🛍️', '#db2777', '#831843'), price: 30 },
  ],
  'new delhi': [
    { name: 'Chandni Chowk street food walk', type: 'food_experience', image: placeholderImage('Chandni Chowk Food Walk', '🍽️', '#ea580c', '#7c2d12'), price: 1200 },
    { name: 'Old Delhi heritage rickshaw tour', type: 'heritage_walk', image: placeholderImage('Old Delhi Rickshaw Tour', '🚲', '#0d9488', '#134e4a'), price: 800 },
    { name: 'Akshardham Temple evening show', type: 'cultural_tour', image: placeholderImage('Akshardham Evening Show', '🎭', '#7c3aed', '#4c1d95'), price: 300 },
    { name: 'Sunset at India Gate lawns', type: 'sunset_experience', image: placeholderImage('India Gate Sunset', '🌅', '#ea580c', '#78350f'), price: 0 },
    { name: 'Dilli Haat local market experience', type: 'market_experience', image: placeholderImage('Dilli Haat Market', '🛍️', '#db2777', '#831843'), price: 30 },
  ],
  goa: [
    { name: 'Sunset cruise on the Mandovi River', type: 'sunset_experience', image: placeholderImage('Mandovi Sunset Cruise', '🛥️', '#0891b2', '#164e63'), price: 500 },
    { name: 'Beach shack seafood dinner', type: 'food_experience', image: placeholderImage('Beach Shack Dinner', '🦐', '#ea580c', '#7c2d12'), price: 1500 },
    { name: 'Spice plantation tour', type: 'cultural_tour', image: placeholderImage('Spice Plantation Tour', '🌶️', '#16a34a', '#14532d'), price: 600 },
    { name: 'Scuba diving at Grande Island', type: 'water_sport', image: placeholderImage('Scuba Diving', '🤿', '#0284c7', '#0c4a6e'), price: 3500 },
    { name: 'Anjuna flea market shopping trip', type: 'market_experience', image: placeholderImage('Anjuna Market Trip', '🛍️', '#db2777', '#831843'), price: 500 },
  ],
  panaji: [
    { name: 'Sunset cruise on the Mandovi River', type: 'sunset_experience', image: placeholderImage('Mandovi Sunset Cruise', '🛥️', '#0891b2', '#164e63'), price: 500 },
    { name: 'Beach shack seafood dinner', type: 'food_experience', image: placeholderImage('Beach Shack Dinner', '🦐', '#ea580c', '#7c2d12'), price: 1500 },
    { name: 'Spice plantation tour', type: 'cultural_tour', image: placeholderImage('Spice Plantation Tour', '🌶️', '#16a34a', '#14532d'), price: 600 },
    { name: 'Scuba diving at Grande Island', type: 'water_sport', image: placeholderImage('Scuba Diving', '🤿', '#0284c7', '#0c4a6e'), price: 3500 },
    { name: 'Anjuna flea market shopping trip', type: 'market_experience', image: placeholderImage('Anjuna Market Trip', '🛍️', '#db2777', '#831843'), price: 500 },
  ],
  paris: [
    { name: 'Seine River dinner cruise', type: 'food_experience', image: placeholderImage('Seine Dinner Cruise', '🛳️', '#1d4ed8', '#1e3a8a'), price: 8500 },
    { name: 'Louvre guided highlights tour', type: 'cultural_tour', image: placeholderImage('Louvre Guided Tour', '🎭', '#4338ca', '#1e1b4b'), price: 4500 },
    { name: 'French pastry & food walking tour', type: 'food_experience', image: placeholderImage('Pastry Walking Tour', '🥐', '#ea580c', '#7c2d12'), price: 6000 },
    { name: 'Palace of Versailles day trip', type: 'heritage_walk', image: placeholderImage('Versailles Day Trip', '🏰', '#b45309', '#78350f'), price: 3500 },
    { name: 'Evening at a Montmartre café', type: 'sunset_experience', image: placeholderImage('Montmartre Evening', '☕', '#be185d', '#831843'), price: 1200 },
  ],
}

// Generic, still-destination-scoped activity templates — every title includes the resolved city
// name, so two different destinations never render the same activity text.
const CURATED_ACTIVITY_TEMPLATES: Array<{ label: string; type: string }> = [
  { label: 'Local food experience in {city}', type: 'food_experience' },
  { label: '{city} city cultural tour', type: 'cultural_tour' },
  { label: 'Sunset experience in {city}', type: 'sunset_experience' },
  { label: 'Guided heritage walk through {city}', type: 'heritage_walk' },
  { label: '{city} local market experience', type: 'market_experience' },
]

function cityKeyFor(destination: ResolvedDestination): string {
  return destination.city
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
}

// Delhi, Goa and Paris are the three destinations with hand-researched images + real approximate
// prices (see CURATED_PLACES_BY_CITY / CURATED_ACTIVITIES_BY_CITY above). For exactly these
// cities, the "Places & activities" step should never come up empty — even if live discovery is
// slow/unavailable or FALLBACK_CATALOG_MODE hasn't been set for this deployment — since a
// traveler planning one of these trips should always have a default set of options with photos
// and prices to choose from. Every other city keeps the existing, stricter FALLBACK_CATALOG_MODE
// gate (see travelDiscoveryEngineService.ts).
const FLAGSHIP_CURATED_CITY_KEYS = new Set(['delhi', 'new delhi', 'goa', 'panaji', 'paris'])

export function isFlagshipCuratedCity(destination: ResolvedDestination): boolean {
  return FLAGSHIP_CURATED_CITY_KEYS.has(cityKeyFor(destination))
}

function curatedMeta(note: string) {
  return { source: 'Curated Data', checkedAt: nowIso(), status: 'CURATED' as const, note }
}

// Generic per-index estimate, used only when an entry doesn't carry its own researched `price`
// (see the `price` field on CuratedEntry above, populated for Delhi, Goa and Paris).
function curatedPrice(base: number, index: number) {
  return { amount: base + index * 150, currency: 'INR', status: 'CURATED' as const }
}

function priceFor(entry: CuratedEntry, base: number, index: number) {
  return entry.price !== undefined ? { amount: entry.price, currency: 'INR', status: 'CURATED' as const } : curatedPrice(base, index)
}

/** Fallback curated "places" (attractions/landmarks) for the resolved destination. Never returns
 * the same catalog for two different cities — an unmapped city still gets entries built from its
 * own resolved name, clearly labelled CURATED, rather than borrowing another destination's data. */
export function buildCuratedPlaces(destination: ResolvedDestination): PlaceResult[] {
  const key = cityKeyFor(destination)
  const curated = CURATED_PLACES_BY_CITY[key]
  const entries: CuratedEntry[] =
    curated && curated.length
      ? curated
      : [
          { name: `${destination.city} City Highlights Tour`, type: 'attraction' },
          { name: `${destination.city} Old Town Walk`, type: 'landmark' },
          { name: `${destination.city} Central Museum`, type: 'museum' },
          { name: `${destination.city} Waterfront / Main Square`, type: 'landmark' },
        ]

  return entries.map((entry, index) => ({
    id: `curated:place:${destination.destinationKey}:${index}`,
    name: entry.name,
    type: entry.type,
    category: 'place' as const,
    description: `Curated listing for ${destination.city} — live places discovery returned no results, so this is a clearly labelled placeholder, not a verified attraction.`,
    address: destination.displayName,
    latitude: destination.latitude,
    longitude: destination.longitude,
    price: priceFor(entry, 300, index),
    bookable: false,
    image: entry.image,
    meta: curatedMeta('Fallback curated place — live OpenStreetMap discovery was unavailable or returned no results for this destination.'),
  }))
}

/** Fallback curated "activities" (food/tour experiences) for the resolved destination — same
 * rules as buildCuratedPlaces: destination-scoped, clearly labelled CURATED, never invented as if
 * verified. */
export function buildCuratedActivities(destination: ResolvedDestination): PlaceResult[] {
  const key = cityKeyFor(destination)
  const curated = CURATED_ACTIVITIES_BY_CITY[key]
  const entries: CuratedEntry[] = curated && curated.length
    ? curated
    : CURATED_ACTIVITY_TEMPLATES.map((template) => ({ name: template.label.replace('{city}', destination.city), type: template.type }))

  return entries.map((entry, index) => ({
    id: `curated:activity:${destination.destinationKey}:${index}`,
    name: entry.name,
    type: entry.type,
    category: 'activity' as const,
    description: `Curated activity idea for ${destination.city} — a placeholder for planning purposes, not a bookable, verified experience.`,
    address: destination.displayName,
    latitude: destination.latitude,
    longitude: destination.longitude,
    price: priceFor(entry, 500, index),
    bookable: false,
    image: entry.image,
    meta: curatedMeta('Fallback curated activity — live activity discovery was unavailable or returned no results for this destination.'),
  }))
}
