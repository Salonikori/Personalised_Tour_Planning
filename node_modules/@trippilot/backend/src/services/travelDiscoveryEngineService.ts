// travelDiscoveryEngineService.ts
//
// This is the orchestrator described in spec section 1. It does NOT invent travel facts. Its job is:
//   1. understand/resolve whatever destination string the user typed
//   2. decide what to search for and generate targeted queries
//   3. call the live provider layer (providers/*.ts)
//   4. hand raw results to the deterministic normalize.ts layer
//   5. rank + explain the *already-verified* results against traveler preferences
//
// Every price, hotel, flight, and place field in the output was produced by a provider or by the
// deterministic layer - never by the LLM. The LLM only ever touches: query generation, ranking
// order, and short natural-language "reason" strings.
import { placesProvider, ALL_PLACE_CATEGORIES } from './providers/placesProvider.js'
import { amadeusHotelProvider, curatedHotelProvider } from './providers/hotelProvider.js'
import { amadeusFlightProvider, curatedFlightProvider } from './providers/flightProvider.js'
import { webSearchProvider } from './providers/webSearchProvider.js'
import { buildCuratedPlaces, buildCuratedActivities, isFlagshipCuratedCity } from './providers/curatedPlacesProvider.js'
import { validateHotels, validatePlaces, rankPlacesByPreference, splitPlacesByCategory } from './normalize.js'
import type {
  HotelResult,
  FlightResult,
  PlaceResult,
  ResolvedDestination,
  WebSearchResult,
} from './providers/types.js'

const isFallbackCatalogMode = () => process.env.FALLBACK_CATALOG_MODE === 'true'

export type DiscoveryRequest = {
  destination: string
  origin?: string
  checkIn?: string
  checkOut?: string
  travelers?: number
  budget?: number
  interests?: string[]
  tripStyle?: string
}

export type ProviderReport = { name: string; used: boolean; status: 'LIVE' | 'CURATED' | 'UNAVAILABLE'; note?: string }

export type DiscoveryBundle = {
  destination: ResolvedDestination
  flights: FlightResult[]
  hotels: HotelResult[]
  places: PlaceResult[]
  activities: PlaceResult[]
  transfers: PlaceResult[]
  webContext: WebSearchResult[]
  providerReport: ProviderReport[]
  curatedMode: boolean
}

/** Destination resolution: turns "Kyoto, Japan" / "kyoto" / ambiguous strings into real coordinates. */
export async function resolveDestination(query: string): Promise<ResolvedDestination> {
  const resolved = await placesProvider.resolveDestination(query)
  if (!resolved) {
    throw new Error(
      `"${query}" could not be resolved to a real destination. Try a more specific city/region name.`
    )
  }
  return resolved
}

/** Spec section 8: generate targeted, destination-specific search queries instead of one generic query. */
export function generateSearchQueries(input: DiscoveryRequest, destination: ResolvedDestination): string[] {
  const place = `${destination.city}${destination.countryCode ? ', ' + destination.countryCode : ''}`
  const dateHint = input.checkIn ? ` ${new Date(input.checkIn).toLocaleString('en-US', { month: 'long', year: 'numeric' })}` : ''
  const queries = [
    `${place} top attractions`,
    `${place} things to do`,
    `${place} best restaurants`,
    `${place} cultural experiences`,
    `best hotels ${place}${dateHint}`,
    `${place} airport transfer options`,
  ]
  if (input.origin) queries.push(`flights ${input.origin} to ${place}${dateHint}`)
  if (input.interests?.length) queries.push(`${place} ${input.interests.join(' ')} experiences`)
  return queries
}


async function aiSearchQueries(input: DiscoveryRequest, destination: ResolvedDestination): Promise<string[]> {
  const fallback = generateSearchQueries(input, destination)
  if (!process.env.GROQ_API_KEY) return fallback
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'openai/gpt-oss-120b', temperature: 0.2, response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'Generate travel web-search queries only. Never answer travel questions or invent facts. Return JSON {"queries":[string,...]}.' },
          { role: 'user', content: JSON.stringify({ destination: destination.displayName, city: destination.city, countryCode: destination.countryCode, dates: { checkIn: input.checkIn, checkOut: input.checkOut }, origin: input.origin, budget: input.budget, interests: input.interests, tripStyle: input.tripStyle, requiredTopics: ['hotels','things to do','attractions','food experiences','transport/transfers','destination information'] }) }
        ] }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return fallback
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
    const parsed = JSON.parse(payload.choices?.[0]?.message?.content || '{}') as { queries?: unknown }
    const queries = Array.isArray(parsed.queries) ? parsed.queries.filter((q): q is string => typeof q === 'string' && q.trim().length > 5).map(q => q.trim()).slice(0,8) : []
    return queries.length >= 3 ? queries : fallback
  } catch { return fallback }
}

async function aiRankPlaces(places: PlaceResult[], input: DiscoveryRequest): Promise<PlaceResult[]> {
  const deterministic = rankPlacesByPreference(places, input.interests)
  if (!process.env.GROQ_API_KEY || deterministic.length < 2) return deterministic
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'openai/gpt-oss-120b', temperature: 0.1, response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'Rank only supplied travel place IDs. Never invent IDs or facts. Return JSON {"orderedIds":[string,...]}.' },
          { role: 'user', content: JSON.stringify({ preferences: input.interests || [], tripStyle: input.tripStyle, places: deterministic.slice(0,40).map(p => ({ id:p.id,name:p.name,type:p.type,description:p.description,rating:p.rating,price:p.price })) }) }
        ] }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return deterministic
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
    const parsed = JSON.parse(payload.choices?.[0]?.message?.content || '{}') as { orderedIds?: unknown }
    const ids = Array.isArray(parsed.orderedIds) ? parsed.orderedIds.filter((id): id is string => typeof id === 'string') : []
    const byId = new Map(deterministic.map(p => [p.id,p]))
    const ranked = ids.map(id => byId.get(id)).filter((p): p is PlaceResult => Boolean(p))
    const used = new Set(ranked.map(p => p.id))
    return ranked.concat(deterministic.filter(p => !used.has(p.id)))
  } catch { return deterministic }
}

async function withReport(
  report: ProviderReport[],
  name: string,
  configured: boolean,
  curatedAllowed: boolean,
  run: () => Promise<{ status: 'LIVE' | 'CURATED' | 'UNAVAILABLE'; result: unknown; note?: string }>
): Promise<unknown[]> {
  if (!configured && !curatedAllowed) {
    report.push({ name, used: false, status: 'UNAVAILABLE', note: 'Missing API credentials' })
    return []
  }
  try {
    const { status, result, note } = await run()
    // A provider can now honestly self-report UNAVAILABLE (e.g. an unmapped destination) instead
    // of being forced to either throw or claim LIVE with an empty result.
    report.push({ name, used: status !== 'UNAVAILABLE', status, note })
    return Array.isArray(result) ? result : []
  } catch (error) {
    report.push({ name, used: false, status: 'UNAVAILABLE', note: error instanceof Error ? error.message : 'Request failed' })
    return []
  }
}

export async function discoverDestination(input: DiscoveryRequest): Promise<DiscoveryBundle> {
  const destination = await resolveDestination(input.destination)
  const curatedMode = isFallbackCatalogMode()
  const providerReport: ProviderReport[] = []

  const checkIn = input.checkIn || new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
  const checkOut = input.checkOut || new Date(Date.now() + 33 * 86_400_000).toISOString().slice(0, 10)
  const travelers = input.travelers ?? 1

  const [rawPlaces, rawHotels, rawFlights, webContext] = await Promise.all([
    // Single Overpass call across every category (attractions, restaurants, shopping, nightlife,
    // AND transport hubs) - places/activities/transfers are split out below, deterministically,
    // rather than making three separate live calls for what's really one query.
    withReport(providerReport, placesProvider.name, placesProvider.isConfigured(), false, async () => ({
      status: 'LIVE',
      result: await placesProvider.searchPlaces({ destination, categories: ALL_PLACE_CATEGORIES, limit: 60 }),
    })) as Promise<PlaceResult[]>,

    withReport(
      providerReport,
      amadeusHotelProvider.name,
      amadeusHotelProvider.isConfigured(),
      curatedMode,
      async () => {
        if (amadeusHotelProvider.isConfigured()) {
          const result = await amadeusHotelProvider.searchHotels({ destination, checkIn, checkOut, travelers, budgetPerNight: input.budget })
          if (result.length) return { status: 'LIVE', result }
        }
        if (curatedMode) return { status: 'CURATED', result: await curatedHotelProvider.searchHotels({ destination, checkIn, checkOut, travelers, budgetPerNight: input.budget }) }
        return { status: 'LIVE', result: [] }
      }
    ) as Promise<HotelResult[]>,

    // Flights genuinely can't be searched without a traveler origin - rather than silently
    // reporting "LIVE" with zero results (which reads as "checked and found nothing"), report
    // this case honestly as UNAVAILABLE with the actual reason, and skip calling any provider.
    (input.origin
      ? (withReport(
          providerReport,
          amadeusFlightProvider.name,
          amadeusFlightProvider.isConfigured(),
          curatedMode,
          async () => {
            let unavailableReason: string | undefined
            if (amadeusFlightProvider.isConfigured()) {
              try {
                const result = await amadeusFlightProvider.searchFlights({ destination, origin: input.origin as string, departureDate: checkIn, returnDate: checkOut, travelers, budgetTotal: input.budget })
                if (result.length) return { status: 'LIVE', result }
                unavailableReason = `No live fare found for ${input.origin} → ${destination.city} on the selected date.`
              } catch (error) {
                // Covers an unmapped/unresolved airport code for this destination as well as any
                // other live-search failure - never silently treated as "checked, found nothing".
                unavailableReason = error instanceof Error ? error.message : 'Flight search failed.'
              }
            }
            if (curatedMode) return { status: 'CURATED', result: await curatedFlightProvider.searchFlights({ destination, origin: input.origin as string, departureDate: checkIn, returnDate: checkOut, travelers, budgetTotal: input.budget }) }
            return { status: 'UNAVAILABLE', result: [], note: unavailableReason || 'Live flight pricing is not configured for this deployment.' }
          }
        ) as Promise<FlightResult[]>)
      : (async () => {
          // Spec: an absent origin must never block itinerary composition in curated fallback mode. Instead of
          // reporting UNAVAILABLE with nothing to show, generate one clearly labelled CURATED planning
          // estimate (origin "Your origin") so the composer always has at least one flight-shaped
          // item to work with, alongside an explicit prompt to enter a real origin for live pricing.
          if (curatedMode) {
            const curatedFlights = await curatedFlightProvider.searchFlights({
              destination,
              origin: 'Your origin',
              departureDate: checkIn,
              returnDate: checkOut,
              travelers,
              budgetTotal: input.budget,
            })
            const notedFlights = curatedFlights.map((flight) => ({
              ...flight,
              meta: { ...flight.meta, note: 'Estimated planning price — enter a travel origin for live flight pricing.' },
            }))
            providerReport.push({
              name: 'Estimated Fares',
              used: true,
              status: 'CURATED',
              note: 'No traveler origin provided — showing an estimated plan instead of blocking composition.',
            })
            return notedFlights as FlightResult[]
          }
          providerReport.push({ name: amadeusFlightProvider.name, used: false, status: 'UNAVAILABLE', note: 'No traveler origin provided' })
          return [] as FlightResult[]
        })()),

    withReport(providerReport, webSearchProvider.name, webSearchProvider.isConfigured(), false, async () => {
      const queries = await aiSearchQueries(input, destination)
      const results = (await Promise.all(queries.map((query) => webSearchProvider.search(query)))).flat()
      return { status: 'LIVE', result: results }
    }) as Promise<WebSearchResult[]>,
  ])

  const validated = validatePlaces(destination, rawPlaces)
  const buckets = splitPlacesByCategory(validated)
  let places = await aiRankPlaces(buckets.places, input)
  let activities = await aiRankPlaces(buckets.activities, input)
  const transfers = buckets.transfers
  const hotels = validateHotels(destination, rawHotels)

  // Spec: live places/activities discovery (OpenStreetMap/Overpass) can legitimately return zero
  // results for a destination (rate limiting, an under-mapped area, a transient outage). In
  // FALLBACK_CATALOG_MODE, that must never leave the composer with nothing to build an itinerary from - fall
  // back to a small, explicitly CURATED-labelled, destination-scoped catalog instead. This never runs
  // when live results exist, and never overwrites/mixes into real LIVE results - it's an
  // all-or-nothing substitute for an empty bucket only.
  // Delhi, Goa and Paris always get their curated catalog when live discovery comes back empty,
  // independent of FALLBACK_CATALOG_MODE — see isFlagshipCuratedCity(). Every other destination
  // keeps the stricter, env-gated behavior so untested cities are never silently padded with
  // placeholder data unless this deployment has explicitly opted into curated fallbacks.
  const curatedFallbackAllowed = curatedMode || isFlagshipCuratedCity(destination)
  if (!places.length && curatedFallbackAllowed) {
    places = buildCuratedPlaces(destination)
    providerReport.push({
      name: 'Curated Places',
      used: true,
      status: 'CURATED',
      note: `Live places discovery returned no results for ${destination.city} — showing a curated catalog instead.`,
    })
  }
  if (!activities.length && curatedFallbackAllowed) {
    activities = buildCuratedActivities(destination)
    providerReport.push({
      name: 'Curated Activities',
      used: true,
      status: 'CURATED',
      note: `Live activity discovery returned no results for ${destination.city} — showing a curated catalog instead.`,
    })
  }

  return { destination, flights: rawFlights, hotels, places, activities, transfers, webContext, providerReport, curatedMode }
}

/** Spec section 21: a short, honest explanation of why an item was surfaced - no invented facts.
 * Never claims CURATED/fallback data was "verified" or "sourced live" - that phrasing is reserved for
 * genuinely LIVE results, per the FALLBACK_CATALOG_MODE honesty requirement. */
export function explainPlaceSelection(place: PlaceResult, input: DiscoveryRequest): string {
  const isCurated = place.meta.status === 'CURATED'
  const reasons: string[] = []
  if (input.interests?.some((interest) => `${place.type} ${place.name}`.toLowerCase().includes(interest.toLowerCase()))) {
    reasons.push(`matches your interest in ${input.interests.find((i) => `${place.type} ${place.name}`.toLowerCase().includes(i.toLowerCase()))}`)
  }
  reasons.push(isCurated ? `fits a ${place.type} slot in your plan` : `verified as a real ${place.type} in ${place.name.includes(place.type) ? place.name : place.name}`)
  return isCurated
    ? `Suggested because it ${reasons.join(' and ')} - this is CURATED placeholder data, not a verified live result.`
    : `Recommended because it ${reasons.join(' and ')}, sourced live from ${place.meta.source}.`
}

/** Same honesty rule as explainPlaceSelection, phrased for a transport hub rather than an
 * attraction - transfers aren't ranked against interests, just verified as real and nearby. */
export function explainTransfer(place: PlaceResult): string {
  if (place.meta.status === 'CURATED') {
    return `CURATED placeholder ${place.type.replace(/_/g, ' ')} near your destination - not a verified live result.`
  }
  return `Verified ${place.type.replace(/_/g, ' ')} near your destination, sourced live from ${place.meta.source}.`
}
