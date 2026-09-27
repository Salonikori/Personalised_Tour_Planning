// Canonical provider architecture for TripPilot's destination-aware discovery layer.
//
// Reasoning & orchestration layer = personalization (travelDiscoveryEngineService.ts)
// Live APIs/Web Search = factual/current travel data (this file + the provider implementations)
// Deterministic backend = validation/calculation/security (normalize.ts + server.ts route handlers)
//
// No provider here is allowed to invent a price, an availability status, or a fact. If a provider
// cannot get real data it returns an empty result or throws — callers decide whether to fall back to
// FALLBACK_CATALOG_MODE, never silently substitute unrelated destination data.

export type PriceStatus = 'LIVE' | 'SEARCHED' | 'ESTIMATED' | 'UNAVAILABLE' | 'CURATED'

// Places, activities, and transfers are all discovered through the same Overpass query and the
// same PlaceResult shape - this is the only thing that differs between them. See
// placesProvider.ts's classifyPlace() for how a raw OSM tag set is mapped to a category.
export type PlaceCategory = 'place' | 'activity' | 'transfer'

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

export type Money = {
  amount: number | null
  currency: string
  status: PriceStatus
}

export type ProviderMeta = {
  source: string
  sourceUrl?: string
  checkedAt: string
  status: PriceStatus
  // Free-text disclaimer surfaced to the UI, e.g. explaining that a CURATED result is a rough
  // estimate rather than a real, bookable schedule/fare. Optional — LIVE results rarely need one.
  note?: string
}

export type FlightSearchParams = {
  origin: string
  destination: ResolvedDestination
  departureDate: string
  returnDate?: string
  travelers: number
  cabinClass?: 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST'
  // Trip-level total budget, used only by CuratedFlightProvider to scale its placeholder estimate.
  // Amadeus ignores this — live fares are never adjusted toward a traveler's budget.
  budgetTotal?: number
}

export type FlightResult = {
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

export type HotelSearchParams = {
  destination: ResolvedDestination
  checkIn: string
  checkOut: string
  travelers: number
  budgetPerNight?: number
  preferences?: string[]
}

export type HotelResult = {
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

export type PlaceSearchParams = {
  destination: ResolvedDestination
  categories?: string[]
  limit?: number
}

export type PlaceResult = {
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
  // OSM/Wikipedia results are informational, not a bookable inventory line - always false here.
  // Kept on every result (places, hotels, flights) so the client never has to guess.
  bookable: boolean
  meta: ProviderMeta
  // Optional display image (an absolute URL or a same-origin /images/... path served from
  // frontend/public). Only ever set by curated fallback data (see curatedPlacesProvider.ts) -
  // live Overpass results never carry one, since OSM doesn't provide photos.
  image?: string
}

export type WebSearchResult = {
  title: string
  url: string
  snippet: string
  source: string
}

export interface FlightProvider {
  readonly name: string
  isConfigured(): boolean
  searchFlights(params: FlightSearchParams): Promise<FlightResult[]>
}

export interface HotelProvider {
  readonly name: string
  isConfigured(): boolean
  searchHotels(params: HotelSearchParams): Promise<HotelResult[]>
}

export interface PlacesProvider {
  readonly name: string
  isConfigured(): boolean
  searchPlaces(params: PlaceSearchParams): Promise<PlaceResult[]>
  resolveDestination(query: string): Promise<ResolvedDestination | null>
}

export interface WebSearchProvider {
  readonly name: string
  isConfigured(): boolean
  search(query: string): Promise<WebSearchResult[]>
}

export function nowIso() {
  return new Date().toISOString()
}
