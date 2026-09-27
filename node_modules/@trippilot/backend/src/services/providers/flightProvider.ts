// Live flight search via the Amadeus Flight Offers Search API. Requires AMADEUS_API_KEY/SECRET.
// If unavailable or a route genuinely has no live fare, this reports "Live fare unavailable"
// rather than inventing a price, per spec section 6.
import type { FlightProvider, FlightResult, FlightSearchParams } from './types.js'
import { nowIso } from './types.js'

async function getAmadeusToken(): Promise<string> {
  const response = await fetch('https://test.api.amadeus.com/v1/security/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.AMADEUS_API_KEY || '',
      client_secret: process.env.AMADEUS_API_SECRET || '',
    }),
    signal: AbortSignal.timeout(8_000),
  })
  if (!response.ok) throw new Error(`Amadeus auth failed with ${response.status}`)
  const payload = (await response.json()) as { access_token: string }
  return payload.access_token
}

// Amadeus needs IATA codes for any city on earth, not just a hardcoded shortlist. Rather than
// guessing (a wrong airport code would silently return flights for the wrong city), this resolves
// codes live via Amadeus's own Airport & City Search reference-data endpoint and caches each
// resolved code in-memory for 24h so repeated searches for the same city don't re-hit the API.
const IATA_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const iataCache = new Map<string, { code: string | null; expiresAt: number }>()

function cacheKey(city: string) {
  return city.trim().toLowerCase()
}

// If the caller already passed a bare 3-letter IATA code (e.g. an origin typed as "DEL"), trust it
// directly rather than round-tripping through search — this is not a guess, it's the literal input.
function asLiteralIata(value: string): string | null {
  const trimmed = value.trim().toUpperCase()
  return /^[A-Z]{3}$/.test(trimmed) ? trimmed : null
}

async function lookupIataLive(city: string, token: string): Promise<string | null> {
  const query = new URLSearchParams({
    keyword: city,
    subType: 'CITY,AIRPORT',
    'page[limit]': '5',
  })
  const response = await fetch(`https://test.api.amadeus.com/v1/reference-data/locations?${query.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8_000),
  })
  if (!response.ok) throw new Error(`Amadeus location search failed with ${response.status}`)
  const payload = (await response.json()) as {
    data?: Array<{ subType: string; iataCode?: string; address?: { cityName?: string } }>
  }
  const results = payload.data || []
  // Prefer an exact CITY match, then any AIRPORT match, so multi-airport cities (e.g. "Paris")
  // resolve to the primary city code rather than an arbitrary airport in the list.
  const cityMatch = results.find((entry) => entry.subType === 'CITY' && entry.iataCode)
  const airportMatch = results.find((entry) => entry.subType === 'AIRPORT' && entry.iataCode)
  return cityMatch?.iataCode || airportMatch?.iataCode || null
}

async function iataFor(city: string, token: string): Promise<string | null> {
  const literal = asLiteralIata(city)
  if (literal) return literal

  const key = cacheKey(city)
  const cached = iataCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.code

  try {
    const code = await lookupIataLive(city, token)
    iataCache.set(key, { code, expiresAt: Date.now() + IATA_CACHE_TTL_MS })
    return code
  } catch (error) {
    // Never guess a code on failure — report unresolved so the caller can honestly return [].
    console.warn('⚠️ IATA lookup failed for', city, error instanceof Error ? error.message : error)
    return null
  }
}

export class AmadeusFlightProvider implements FlightProvider {
  readonly name = 'Amadeus Flight Offers Search'

  isConfigured() {
    return Boolean(process.env.AMADEUS_API_KEY && process.env.AMADEUS_API_SECRET)
  }

  async searchFlights(params: FlightSearchParams): Promise<FlightResult[]> {
    if (!this.isConfigured()) return []
    const token = await getAmadeusToken()
    const [originCode, destinationCode] = await Promise.all([
      iataFor(params.origin, token),
      iataFor(params.destination.city, token),
    ])
    if (!originCode || !destinationCode) {
      // Never guess a code - but also never silently pretend this was a normal "checked, found
      // nothing" live search. Name exactly which side of the route failed to resolve.
      const unresolved = !originCode && !destinationCode
        ? `"${params.origin}" and "${params.destination.city}"`
        : !originCode
          ? `"${params.origin}"`
          : `"${params.destination.city}"`
      throw new Error(`Could not resolve an airport/IATA code for ${unresolved}.`)
    }

    const query = new URLSearchParams({
      originLocationCode: originCode,
      destinationLocationCode: destinationCode,
      departureDate: params.departureDate,
      adults: String(Math.max(1, params.travelers)),
      max: '8',
      currencyCode: 'INR',
    })
    if (params.returnDate) query.set('returnDate', params.returnDate)
    if (params.cabinClass) query.set('travelClass', params.cabinClass)

    const response = await fetch(`https://test.api.amadeus.com/v2/shopping/flight-offers?${query.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(12_000),
    })
    if (!response.ok) throw new Error(`Amadeus flight search failed with ${response.status}`)

    const payload = (await response.json()) as {
      data?: Array<{
        id: string
        price: { total: string; currency: string }
        itineraries: Array<{ duration: string; segments: Array<{ carrierCode: string; number: string; departure: { iataCode: string; at: string }; arrival: { iataCode: string; at: string } }> }>
      }>
      dictionaries?: { carriers?: Record<string, string> }
    }

    const checkedAt = nowIso()
    return (payload.data || []).map((offer) => {
      const leg = offer.itineraries[0]
      const first = leg.segments[0]
      const last = leg.segments[leg.segments.length - 1]
      return {
        id: `amadeus:${offer.id}`,
        airline: payload.dictionaries?.carriers?.[first.carrierCode] || first.carrierCode,
        flightNumber: `${first.carrierCode}${first.number}`,
        origin: first.departure.iataCode,
        destination: last.arrival.iataCode,
        departureTime: first.departure.at,
        arrivalTime: last.arrival.at,
        duration: leg.duration,
        stops: leg.segments.length - 1,
        price: { amount: Number(offer.price.total), currency: offer.price.currency, status: 'LIVE' as const },
        bookable: true,
        meta: { source: 'Amadeus', sourceUrl: 'https://amadeus.com', checkedAt, status: 'LIVE' as const },
      }
    })
  }
}

// CuratedFlightProvider is separate and explicit, mirroring CuratedHotelProvider's pattern: it is only
// ever selected when FALLBACK_CATALOG_MODE=true (and Amadeus is unavailable/unconfigured), it works for ANY
// resolved destination (city name only — no airport-code guessing needed), and every offer it
// returns is tagged priceStatus CURATED with a note explaining it is a rough planning estimate, not a
// real, bookable schedule or fare. It never invents a specific real airline, flight number tied to
// an actual carrier, or a claimed departure/arrival time — "Estimated Airways" and a generic AM/PM
// travel window make clear this is a placeholder for budget planning only.
export class CuratedFlightProvider implements FlightProvider {
  readonly name = 'Estimated Flight Data'

  isConfigured() {
    return true
  }

  async searchFlights(params: FlightSearchParams): Promise<FlightResult[]> {
    const checkedAt = nowIso()
    const travelers = Math.max(1, params.travelers)
    // A simple, transparent estimate: split roughly a fifth of the per-traveler trip budget
    // toward round-trip air, floored at a sane minimum. This is explicitly a planning heuristic,
    // never presented as a live fare.
    const perTravelerBudget = params.budgetTotal ? params.budgetTotal / travelers : undefined
    const roundTripEstimate = Math.max(4_000, Math.round((perTravelerBudget ?? 20_000) * 0.2))
    const tiers: Array<{ label: string; direction: 'out' | 'return'; from: string; to: string; multiplier: number }> = [
      { label: 'outbound', direction: 'out', from: params.origin, to: params.destination.city, multiplier: 0.5 },
    ]
    if (params.returnDate) {
      tiers.push({ label: 'return', direction: 'return', from: params.destination.city, to: params.origin, multiplier: 0.5 })
    }

    return tiers.map((tier) => {
      const date = tier.direction === 'out' ? params.departureDate : (params.returnDate as string)
      return {
        id: `curated:flight:${params.destination.destinationKey}:${tier.direction}`,
        airline: 'Estimated Airways',
        flightNumber: `DA${tier.direction === 'out' ? '100' : '200'}`,
        origin: tier.from,
        destination: tier.to,
        // Generic mid-day placeholder times, not claimed as a real schedule — see note below.
        departureTime: `${date}T09:00:00.000Z`,
        arrivalTime: `${date}T15:00:00.000Z`,
        duration: 'PT6H',
        stops: 0,
        price: { amount: Math.round(roundTripEstimate * tier.multiplier), currency: 'INR', status: 'CURATED' as const },
        bookable: false,
        meta: {
          source: 'Curated Data',
          checkedAt,
          status: 'CURATED' as const,
          note: 'Estimated planning placeholder — not a real airline schedule or live fare.',
        },
      }
    })
  }
}

export const amadeusFlightProvider = new AmadeusFlightProvider()
export const curatedFlightProvider = new CuratedFlightProvider()
export const LIVE_FARE_UNAVAILABLE = 'Live fare unavailable'
