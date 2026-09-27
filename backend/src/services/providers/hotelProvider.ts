// Live hotel search via the Amadeus Self-Service API (Hotel List + Hotel Search).
// Requires AMADEUS_API_KEY / AMADEUS_API_SECRET. If they are absent, AmadeusHotelProvider reports
// itself as not configured and returns []; it never invents a hotel, price, or availability.
//
// CuratedHotelProvider is separate and explicit: it is only ever selected when FALLBACK_CATALOG_MODE=true, and
// every item it returns is tagged priceStatus CURATED so the UI can render "Curated Data" clearly.
import type { HotelProvider, HotelResult, HotelSearchParams } from './types.js'
import { nowIso } from './types.js'

let amadeusToken: { value: string; expiresAt: number } | null = null

async function getAmadeusToken(): Promise<string> {
  if (amadeusToken && amadeusToken.expiresAt > Date.now()) return amadeusToken.value
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
  const payload = (await response.json()) as { access_token: string; expires_in: number }
  amadeusToken = { value: payload.access_token, expiresAt: Date.now() + (payload.expires_in - 60) * 1000 }
  return amadeusToken.value
}

export class AmadeusHotelProvider implements HotelProvider {
  readonly name = 'Amadeus Hotel Search'

  isConfigured() {
    return Boolean(process.env.AMADEUS_API_KEY && process.env.AMADEUS_API_SECRET)
  }

  async searchHotels(params: HotelSearchParams): Promise<HotelResult[]> {
    if (!this.isConfigured()) return []
    const token = await getAmadeusToken()
    const authHeader = { Authorization: `Bearer ${token}` }

    const listResponse = await fetch(
      `https://test.api.amadeus.com/v1/reference-data/locations/hotels/by-geocode?latitude=${params.destination.latitude}&longitude=${params.destination.longitude}&radius=20&radiusUnit=KM`,
      { headers: authHeader, signal: AbortSignal.timeout(10_000) }
    )
    if (!listResponse.ok) throw new Error(`Amadeus hotel list failed with ${listResponse.status}`)
    const listPayload = (await listResponse.json()) as { data?: Array<{ hotelId: string; name: string; geoCode?: { latitude: number; longitude: number }; address?: { lines?: string[] } }> }
    const hotelIds = (listPayload.data || []).slice(0, 20).map((hotel) => hotel.hotelId)
    if (!hotelIds.length) return []

    const offersResponse = await fetch(
      `https://test.api.amadeus.com/v3/shopping/hotel-offers?hotelIds=${hotelIds.join(',')}&checkInDate=${params.checkIn}&checkOutDate=${params.checkOut}&adults=${Math.max(1, params.travelers)}&bestRateOnly=true`,
      { headers: authHeader, signal: AbortSignal.timeout(12_000) }
    )
    if (!offersResponse.ok) throw new Error(`Amadeus hotel offers failed with ${offersResponse.status}`)
    const offersPayload = (await offersResponse.json()) as {
      data?: Array<{
        hotel: { hotelId: string; name: string; latitude?: number; longitude?: number; address?: { lines?: string[] } }
        offers: Array<{ id: string; price: { total: string; currency: string }; room?: { typeEstimated?: { category?: string } }; policies?: { cancellations?: Array<{ description?: { text?: string } }> } }>
      }>
    }

    const checkedAt = nowIso()
    return (offersPayload.data || []).flatMap((entry) => {
      const offer = entry.offers[0]
      if (!offer) return []
      const nights = Math.max(
        1,
        Math.round((new Date(params.checkOut).getTime() - new Date(params.checkIn).getTime()) / 86_400_000)
      )
      const total = Number(offer.price.total)
      return [
        {
          id: `amadeus:${entry.hotel.hotelId}:${offer.id}`,
          name: entry.hotel.name,
          destination: params.destination.city,
          address: entry.hotel.address?.lines?.join(', '),
          latitude: entry.hotel.latitude,
          longitude: entry.hotel.longitude,
          pricePerNight: { amount: Math.round((total / nights) * 100) / 100, currency: offer.price.currency, status: 'LIVE' as const },
          totalPrice: { amount: total, currency: offer.price.currency, status: 'LIVE' as const },
          amenities: [],
          roomType: offer.room?.typeEstimated?.category,
          cancellationPolicy: offer.policies?.cancellations?.[0]?.description?.text,
          availability: 'Available',
          bookable: true,
          meta: { source: 'Amadeus', sourceUrl: 'https://amadeus.com', checkedAt, status: 'LIVE' as const },
        },
      ]
    })
  }
}

export class CuratedHotelProvider implements HotelProvider {
  readonly name = 'Curated Hotel Data'

  isConfigured() {
    return true
  }

  async searchHotels(params: HotelSearchParams): Promise<HotelResult[]> {
    const checkedAt = nowIso()
    const nights = Math.max(
      1,
      Math.round((new Date(params.checkOut).getTime() - new Date(params.checkIn).getTime()) / 86_400_000)
    )
    const tiers = [
      { label: 'boutique stay', multiplier: 0.7 },
      { label: 'well-rated hotel', multiplier: 1.0 },
      { label: 'upscale property', multiplier: 1.6 },
    ]
    const base = params.budgetPerNight ?? 6_000
    return tiers.map((tier, index) => {
      const pricePerNight = Math.round(base * tier.multiplier)
      return {
        id: `curated:hotel:${params.destination.destinationKey}:${index}`,
        name: `${params.destination.city} ${tier.label}`,
        destination: params.destination.city,
        pricePerNight: { amount: pricePerNight, currency: 'INR', status: 'CURATED' as const },
        totalPrice: { amount: pricePerNight * nights, currency: 'INR', status: 'CURATED' as const },
        rating: 4 + index * 0.2,
        amenities: ['Wi-Fi', 'Breakfast'],
        availability: 'Estimated',
        bookable: false,
        meta: { source: 'Curated Data', checkedAt, status: 'CURATED' as const },
      }
    })
  }
}

export const amadeusHotelProvider = new AmadeusHotelProvider()
export const curatedHotelProvider = new CuratedHotelProvider()
