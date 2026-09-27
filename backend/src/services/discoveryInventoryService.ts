import { ItemType, type PrismaClient } from '@prisma/client'
import type { DiscoveryBundle } from './travelDiscoveryEngineService.js'

type InventoryWithVendor = Awaited<ReturnType<typeof getByIds>>[number]

async function getByIds(prisma: PrismaClient, ids: string[]) {
  if (!ids.length) return []
  return prisma.inventoryItem.findMany({ where: { id: { in: ids } }, include: { vendor: true } })
}

async function vendorFor(prisma: PrismaClient, name: string, category: string, reliabilityScore = 80) {
  return prisma.vendor.upsert({
    where: { name },
    create: { name, category, availability: 'Live discovery', priceRange: 'Provider sourced', reliabilityScore, confirmationRate: reliabilityScore, cancellationRate: 0, responseTime: 0 },
    update: {},
  })
}

/** Persist live/curated discovery into the existing inventory contract so the current Trip Canvas,
 * recovery engine and booking flow can consume the same destination-scoped candidates. */
export async function syncDiscoveryInventory(prisma: PrismaClient, bundle: DiscoveryBundle) {
  const destinationTag = `destination:${bundle.destination.destinationKey}`
  const ids: string[] = []
  const existingPool = await prisma.inventoryItem.findMany({ include: { vendor: true } })
  const findExisting = (providerId: string) => existingPool.find((item) => Array.isArray(item.tags) && (item.tags as unknown[]).includes(providerId))

  // Confirm and log why no flight inventory is being synced for this destination, rather than
  // leaving a silent gap - surfaces the exact providerReport entry (LIVE/CURATED/UNAVAILABLE + note)
  // that travelDiscoveryEngineService already recorded for this discovery pass.
  if (!bundle.flights.length) {
    const flightReport = bundle.providerReport.find((entry) => entry.name.toLowerCase().includes('flight'))
    console.warn(
      `✈️ FLIGHT INVENTORY: no flights to sync for ${bundle.destination.displayName} — status=${flightReport?.status ?? 'UNKNOWN'}${flightReport?.note ? `, reason: ${flightReport.note}` : ''}`
    )
  }
  const activityVendor = await vendorFor(prisma, `OSM · ${bundle.destination.city}`, 'Places Discovery', 82)
  for (const place of [...bundle.places, ...bundle.activities]) {
    const tags = ['discovered', 'live', destinationTag, `currency:${place.price.currency}`, place.type.toLowerCase(), place.id]
    // Carry the place's photo (curated or live) through to the itinerary the traveler actually
    // sees in "My Itinerary" — details is a free-form JSON column, so no schema change needed.
    const details = place.image ? { image: place.image } : undefined
    const existing = findExisting(place.id)
    const item = existing
      ? await prisma.inventoryItem.update({ where: { id: existing.id }, data: { title: place.name, type: ItemType.ACTIVITY, location: place.address || bundle.destination.displayName, price: place.price.amount ?? 0, availability: 'Discovery only', tags, details, source: place.meta.source, bookable: false } })
      : await prisma.inventoryItem.create({ data: { vendorId: activityVendor.id, type: ItemType.ACTIVITY, title: place.name, location: place.address || bundle.destination.displayName, price: place.price.amount ?? 0, availability: 'Discovery only', tags, details, source: place.meta.source, bookable: false } })
    ids.push(item.id)
  }

  for (const place of bundle.transfers) {
    const tags = ['discovered', 'live', destinationTag, `currency:${place.price.currency}`, 'transfer', place.id]
    const existing = findExisting(place.id)
    const item = existing
      ? await prisma.inventoryItem.update({ where: { id: existing.id }, data: { title: place.name, type: ItemType.TRANSFER, location: place.address || bundle.destination.displayName, price: place.price.amount ?? 0, availability: 'Discovery only', tags, source: place.meta.source, bookable: false } })
      : await prisma.inventoryItem.create({ data: { vendorId: activityVendor.id, type: ItemType.TRANSFER, title: place.name, location: place.address || bundle.destination.displayName, price: place.price.amount ?? 0, availability: 'Discovery only', tags, source: place.meta.source, bookable: false } })
    ids.push(item.id)
  }

  if (bundle.hotels.length) {
    const vendor = await vendorFor(prisma, `Amadeus Hotels · ${bundle.destination.city}`, 'Hotel Discovery', 86)
    for (const hotel of bundle.hotels) {
      if (hotel.pricePerNight.amount == null) continue
      const tags = ['discovered', destinationTag, `currency:${hotel.pricePerNight.currency}`, 'hotel', hotel.id]
      const existing = findExisting(hotel.id)
      const item = existing
        ? await prisma.inventoryItem.update({ where: { id: existing.id }, data: { title: hotel.name, type: ItemType.HOTEL, location: hotel.address || bundle.destination.displayName, price: hotel.pricePerNight.amount, availability: hotel.availability, tags, source: hotel.meta.source, bookable: hotel.bookable && hotel.meta.status === 'LIVE' } })
        : await prisma.inventoryItem.create({ data: { vendorId: vendor.id, type: ItemType.HOTEL, title: hotel.name, location: hotel.address || bundle.destination.displayName, price: hotel.pricePerNight.amount, availability: hotel.availability, tags, source: hotel.meta.source, bookable: hotel.bookable && hotel.meta.status === 'LIVE' } })
      ids.push(item.id)
    }
  }

  if (bundle.flights.length) {
    const vendor = await vendorFor(prisma, `Amadeus Flights · ${bundle.destination.city}`, 'Flight Discovery', 88)
    for (const flight of bundle.flights) {
      if (flight.price.amount == null) continue
      const tags = ['discovered', destinationTag, `currency:${flight.price.currency}`, 'flight', flight.id]
      const existing = findExisting(flight.id)
      const item = existing
        ? await prisma.inventoryItem.update({ where: { id: existing.id }, data: { title: `${flight.airline} ${flight.flightNumber}`, type: ItemType.FLIGHT, location: `${flight.origin} → ${flight.destination}`, price: flight.price.amount, availability: 'Available', tags, source: flight.meta.source, bookable: flight.meta.status === 'LIVE' } })
        : await prisma.inventoryItem.create({ data: { vendorId: vendor.id, type: ItemType.FLIGHT, title: `${flight.airline} ${flight.flightNumber}`, location: `${flight.origin} → ${flight.destination}`, price: flight.price.amount, availability: 'Available', tags, source: flight.meta.source, bookable: flight.meta.status === 'LIVE' } })
      ids.push(item.id)
    }
  }

  return getByIds(prisma, ids) as Promise<InventoryWithVendor[]>
}
