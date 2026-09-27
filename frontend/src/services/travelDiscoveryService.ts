import { apiRequest } from './apiClient'

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

export type DataStatus = 'LIVE' | 'SEARCHED' | 'ESTIMATED' | 'UNAVAILABLE' | 'CURATED'
export type ProviderReport = { name: string; used: boolean; status: 'LIVE' | 'CURATED' | 'UNAVAILABLE'; note?: string }

export type ResolvedDestination = {
  query: string
  city: string
  region?: string
  countryCode?: string
  displayName: string
  latitude: number
  longitude: number
  destinationKey: string
}

export type Money = { amount: number | null; currency: string; status: DataStatus }

/** Every discovered item - a hotel, flight, place, activity, or transfer - carries the same
 * honesty envelope: where it came from, when it was checked, and whether it can actually be
 * booked through this integration. Never render a discovered item without this data attached. */
export type ProviderMeta = { source: string; sourceUrl?: string; checkedAt: string; status: DataStatus }

export type PlaceCategory = 'place' | 'activity' | 'transfer'

export type PlaceItem = {
  id: string
  name: string
  type: string
  category: PlaceCategory
  description?: string
  address?: string
  latitude: number
  longitude: number
  rating?: number
  reviewCount?: number
  openingHours?: string
  estimatedVisitDuration?: string
  price: Money
  bookable: boolean
  meta: ProviderMeta
  reason?: string
  // Optional curated photo (absolute URL or same-origin /images/... path) - see
  // backend/src/services/providers/curatedPlacesProvider.ts. Live OSM results never set this.
  image?: string
}

export type HotelItem = {
  id: string
  name: string
  destination: string
  address?: string
  latitude?: number
  longitude?: number
  pricePerNight: Money
  totalPrice: Money
  rating?: number
  reviewCount?: number
  amenities: string[]
  roomType?: string
  cancellationPolicy?: string
  availability: string
  bookable: boolean
  meta: ProviderMeta
}

export type FlightItem = {
  id: string
  airline: string
  flightNumber: string
  origin: string
  destination: string
  departureTime: string
  arrivalTime: string
  duration: string
  stops: number
  price: Money
  baggage?: string
  refundable?: boolean
  bookable: boolean
  meta: ProviderMeta
}

export type DiscoveryResult = {
  destination: ResolvedDestination
  curatedMode: boolean
  providerReport: ProviderReport[]
  flights: FlightItem[]
  hotels: HotelItem[]
  places: PlaceItem[]
  activities: PlaceItem[]
  transfers: PlaceItem[]
  webContext: Array<{ title: string; url: string; snippet: string; source: string }>
}

/** Automated, destination-aware discovery: resolves the destination, runs live provider
 * searches, and returns normalized + ranked results split into hotels/flights/places/activities/
 * transfers/web context. This never returns the same catalog for two different destinations -
 * see backend/src/services/travelDiscoveryEngineService.ts. */
export const discoverDestination = (input: DiscoveryRequest) =>
  apiRequest<DiscoveryResult>('/travel/discover', { method: 'POST', body: JSON.stringify(input) })

export const previewDestination = (destination: string) =>
  apiRequest<{ destination: ResolvedDestination; previewQueries: string[] }>(
    `/travel/destination/${encodeURIComponent(destination)}`
  )

export const searchHotels = (input: DiscoveryRequest) =>
  apiRequest<{ status: string; hotels: HotelItem[] }>('/travel/hotels/search', { method: 'POST', body: JSON.stringify(input) })

export const searchFlights = (input: DiscoveryRequest & { origin: string }) =>
  apiRequest<{ status: string; flights: FlightItem[]; message?: string }>('/travel/flights/search', { method: 'POST', body: JSON.stringify(input) })

export const searchPlaces = (input: DiscoveryRequest) =>
  apiRequest<{ status: string; places: PlaceItem[] }>('/travel/places/search', { method: 'POST', body: JSON.stringify(input) })

export const searchActivities = (input: DiscoveryRequest) =>
  apiRequest<{ status: string; places: PlaceItem[] }>('/travel/activities/search', { method: 'POST', body: JSON.stringify(input) })

export const searchTransfers = (input: DiscoveryRequest) =>
  apiRequest<{ status: string; places: PlaceItem[] }>('/travel/transfers/search', { method: 'POST', body: JSON.stringify(input) })

/** Builds a short, honest, human-readable summary of what live discovery actually found - safe to
 * hand to the Trip Composer as background context (see generationService.ts's discoverySummary: it can
 * only flavor `reasoning` text, never select inventory). Only ever describes items this exact
 * DiscoveryResult contains - nothing invented, nothing padded out. */
export function summarizeDiscovery(result: DiscoveryResult): string {
  const parts: string[] = [`Destination resolved to ${result.destination.displayName}.`]
  if (result.hotels.length) {
    const names = result.hotels.slice(0, 3).map((hotel) => hotel.name).join(', ')
    parts.push(`Hotels found (${result.hotels[0]?.meta.status || 'UNKNOWN'}): ${names}.`)
  }
  if (result.places.length) {
    const names = result.places.slice(0, 5).map((place) => place.name).join(', ')
    parts.push(`Notable places nearby: ${names}.`)
  }
  if (result.activities.length) {
    const names = result.activities.slice(0, 5).map((place) => place.name).join(', ')
    parts.push(`Activities/food nearby: ${names}.`)
  }
  if (result.transfers.length) {
    const names = result.transfers.slice(0, 3).map((place) => place.name).join(', ')
    parts.push(`Transfer hubs nearby: ${names}.`)
  }
  if (result.flights.length) parts.push(`Flight data is available.`)
  return parts.join(' ')
}
