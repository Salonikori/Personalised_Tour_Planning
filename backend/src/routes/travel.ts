
// New, additive API surface for destination-aware discovery (spec section 20). Mounted in
// server.ts alongside every existing route - nothing here replaces or modifies prior endpoints.
import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import {
  discoverDestination,
  resolveDestination,
  generateSearchQueries,
  explainPlaceSelection,
  explainTransfer,
  type DiscoveryRequest,
} from '../services/travelDiscoveryEngineService.js'
import { placesProvider } from '../services/providers/placesProvider.js'
import { amadeusHotelProvider, curatedHotelProvider } from '../services/providers/hotelProvider.js'
import { amadeusFlightProvider, curatedFlightProvider } from '../services/providers/flightProvider.js'

export const travelRouter = Router()

const asyncRoute =
  (handler: (request: Request, response: Response) => Promise<unknown>) =>
  (request: Request, response: Response, next: NextFunction) =>
    handler(request, response).catch(next)

const discoverySchema = z.object({
  destination: z.string().min(2),
  origin: z.string().min(2).optional(),
  checkIn: z.string().optional(),
  checkOut: z.string().optional(),
  travelers: z.number().int().positive().max(20).optional(),
  budget: z.number().positive().optional(),
  interests: z.array(z.string()).max(20).optional(),
  tripStyle: z.string().optional(),
})

// POST /api/travel/discover - full pipeline: destination resolution -> live search -> normalize -> rank
travelRouter.post(
  '/discover',
  requireAuth,
  asyncRoute(async (request, response) => {
    const input = discoverySchema.parse(request.body) as DiscoveryRequest
    const bundle = await discoverDestination(input)
    return response.json({
      destination: bundle.destination,
      curatedMode: bundle.curatedMode,
      providerReport: bundle.providerReport,
      flights: bundle.flights,
      hotels: bundle.hotels,
      places: bundle.places.map((place) => ({ ...place, reason: explainPlaceSelection(place, input) })),
      activities: bundle.activities.map((place) => ({ ...place, reason: explainPlaceSelection(place, input) })),
      transfers: bundle.transfers.map((place) => ({ ...place, reason: explainTransfer(place) })),
      webContext: bundle.webContext,
    })
  })
)

// GET /api/travel/destination/:destination - lightweight resolution + query preview, no live search
travelRouter.get(
  '/destination/:destination',
  requireAuth,
  asyncRoute(async (request, response) => {
    const destinationParam = Array.isArray(request.params.destination)
      ? request.params.destination[0]
      : request.params.destination

    const destination = await resolveDestination(destinationParam)

    return response.json({
      destination,
      previewQueries: generateSearchQueries(
        { destination: destinationParam },
        destination
      ),
    })
  })
)

travelRouter.post(
  '/flights/search',
  requireAuth,
  asyncRoute(async (request, response) => {
    const input = discoverySchema.extend({ origin: z.string().min(2) }).parse(request.body)
    const destination = await resolveDestination(input.destination)
    const checkIn = input.checkIn || new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
    const checkOut = input.checkOut
    let liveError: string | undefined

    if (amadeusFlightProvider.isConfigured()) {
      try {
        const flights = await amadeusFlightProvider.searchFlights({
          destination,
          origin: input.origin,
          departureDate: checkIn,
          returnDate: checkOut,
          travelers: input.travelers ?? 1,
        })

        if (flights.length) {
          return response.json({ status: 'LIVE', flights })
        }

        liveError = `No live fare found for ${input.origin} → ${destination.city} on the selected date.`
      } catch (error) {
        // e.g. an unmapped/unresolved airport code for this destination - fall through to curated fallback
        // mode or an honest UNAVAILABLE response instead of a 500.
        liveError = error instanceof Error ? error.message : 'Flight search failed.'
      }
    }

    if (process.env.FALLBACK_CATALOG_MODE === 'true') {
      const flights = await curatedFlightProvider.searchFlights({
        destination,
        origin: input.origin,
        departureDate: checkIn,
        returnDate: checkOut,
        travelers: input.travelers ?? 1,
      })

      return response.json({ status: 'CURATED', flights })
    }

    return response.json({
      status: 'UNAVAILABLE',
      flights: [],
      message: liveError || 'Live fare unavailable',
    })
  })
)

travelRouter.post(
  '/hotels/search',
  requireAuth,
  asyncRoute(async (request, response) => {
    const input = discoverySchema.parse(request.body)
    const destination = await resolveDestination(input.destination)
    const checkIn =
      input.checkIn ||
      new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
    const checkOut =
      input.checkOut ||
      new Date(Date.now() + 33 * 86_400_000).toISOString().slice(0, 10)

    if (amadeusHotelProvider.isConfigured()) {
      const hotels = await amadeusHotelProvider.searchHotels({
        destination,
        checkIn,
        checkOut,
        travelers: input.travelers ?? 1,
        budgetPerNight: input.budget,
      })

      if (hotels.length) {
        return response.json({ status: 'LIVE', hotels })
      }
    }

    if (process.env.FALLBACK_CATALOG_MODE === 'true') {
      const hotels = await curatedHotelProvider.searchHotels({
        destination,
        checkIn,
        checkOut,
        travelers: input.travelers ?? 1,
        budgetPerNight: input.budget,
      })

      return response.json({ status: 'CURATED', hotels })
    }

    return response.json({
      status: 'UNAVAILABLE',
      hotels: [],
      message: 'Live hotel data is temporarily unavailable.',
    })
  })
)

travelRouter.post(
  '/places/search',
  requireAuth,
  asyncRoute(async (request, response) => {
    const input = discoverySchema.parse(request.body)
    const destination = await resolveDestination(input.destination)

    const places = await placesProvider.searchPlaces({
      destination,
      categories: ['attraction', 'landmark', 'culture', 'park'],
      limit: 40,
    })

    return response.json({ status: 'LIVE', places })
  })
)

travelRouter.post(
  '/activities/search',
  requireAuth,
  asyncRoute(async (request, response) => {
    const input = discoverySchema.parse(request.body)
    const destination = await resolveDestination(input.destination)

    const places = await placesProvider.searchPlaces({
      destination,
      categories: ['restaurant', 'shopping', 'nightlife'],
      limit: 30,
    })

    return response.json({ status: 'LIVE', places })
  })
)

// POST /api/travel/transfers/search - airport/rail/bus/ferry hubs near the destination, same
// live Overpass source and honesty rules as every other places-derived endpoint.
travelRouter.post(
  '/transfers/search',
  requireAuth,
  asyncRoute(async (request, response) => {
    const input = discoverySchema.parse(request.body)
    const destination = await resolveDestination(input.destination)

    const places = await placesProvider.searchPlaces({
      destination,
      categories: ['airport', 'train_station', 'bus_station'],
      limit: 20,
    })

    return response.json({
      status: 'LIVE',
      places: places.map((place) => ({
        ...place,
        reason: explainTransfer(place),
      })),
    })
  })
)

// POST /api/travel/compose - runs the full discovery pipeline and returns it pre-shaped for the
// existing Trip Composer / Trip Canvas to consume without changing their contracts.
travelRouter.post(
  '/compose',
  requireAuth,
  asyncRoute(async (request, response) => {
    const input = discoverySchema.parse(request.body) as DiscoveryRequest
    const bundle = await discoverDestination(input)

    return response.json({
      destination: bundle.destination,
      curatedMode: bundle.curatedMode,
      providerReport: bundle.providerReport,
      candidateInventory: [
        ...bundle.hotels.map((hotel) => ({
          kind: 'HOTEL' as const,
          ...hotel,
        })),
        ...bundle.flights.map((flight) => ({
          kind: 'FLIGHT' as const,
          ...flight,
        })),
        ...bundle.places.map((place) => ({
          kind: 'ACTIVITY' as const,
          ...place,
          reason: explainPlaceSelection(place, input),
        })),
        ...bundle.activities.map((place) => ({
          kind: 'ACTIVITY' as const,
          ...place,
          reason: explainPlaceSelection(place, input),
        })),
        ...bundle.transfers.map((place) => ({
          kind: 'TRANSFER' as const,
          ...place,
          reason: explainTransfer(place),
        })),
      ],
    })
  })
)
