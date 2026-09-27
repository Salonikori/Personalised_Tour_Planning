import bcrypt from 'bcryptjs'
import { ItemStatus, ItemType, PaymentStatus, PrismaClient, Role, BookingStatus } from '@prisma/client'

const prisma = new PrismaClient()
const at = (day: number, hour: number, minute = 0) => new Date(Date.UTC(2026, 5, day, hour, minute))

const inventory = [
  ['Bali Airways', 'FLIGHT', 'Denpasar arrival flight', 'Ngurah Rai Airport', 12800], ['Bali Airways', 'FLIGHT', 'Denpasar sunset departure', 'Ngurah Rai Airport', 11900], ['Bali Airways', 'FLIGHT', 'Jakarta connection flight', 'Ngurah Rai Airport', 8900], ['Bali Airways', 'FLIGHT', 'Lombok island hop', 'Ngurah Rai Airport', 6200],
  ['Ubud Canopy Retreat', 'HOTEL', 'Garden suite', 'Ubud', 9800], ['Ubud Canopy Retreat', 'HOTEL', 'River-view suite', 'Ubud', 12800], ['Ubud Canopy Retreat', 'HOTEL', 'Family villa', 'Ubud', 16400], ['Ubud Canopy Retreat', 'HOTEL', 'Wellness loft', 'Ubud', 11300],
  ['Canggu Tide House', 'HOTEL', 'Surfside king room', 'Canggu', 8600], ['Canggu Tide House', 'HOTEL', 'Pool courtyard room', 'Canggu', 9400], ['Canggu Tide House', 'HOTEL', 'Ocean terrace suite', 'Canggu', 14200], ['Canggu Tide House', 'HOTEL', 'Long-stay studio', 'Canggu', 7700],
  ['Jiwa Experiences', 'ACTIVITY', 'Mount Batur sunrise trek', 'Kintamani', 3200], ['Jiwa Experiences', 'ACTIVITY', 'Tegalalang rice terrace walk', 'Ubud', 1500], ['Jiwa Experiences', 'ACTIVITY', 'Balinese cooking workshop', 'Ubud', 2800], ['Jiwa Experiences', 'ACTIVITY', 'Uluwatu fire dance', 'Uluwatu', 1800], ['Jiwa Experiences', 'ACTIVITY', 'Water temple ceremony', 'Tampaksiring', 2100], ['Jiwa Experiences', 'ACTIVITY', 'Canggu sunset surf lesson', 'Canggu', 2400],
  ['Island Transfer Co.', 'TRANSFER', 'Private airport transfer', 'Denpasar → Ubud', 2200], ['Island Transfer Co.', 'TRANSFER', 'Ubud to Canggu transfer', 'Ubud → Canggu', 1700], ['Island Transfer Co.', 'TRANSFER', 'Canggu airport transfer', 'Canggu → Denpasar', 1500], ['Island Transfer Co.', 'TRANSFER', 'Kintamani sunrise shuttle', 'Ubud → Kintamani', 1300],
  ['Serenity Spa Bali', 'ACTIVITY', 'Traditional Balinese massage', 'Ubud', 2600], ['Serenity Spa Bali', 'ACTIVITY', 'Flower bath ritual', 'Ubud', 1900], ['Serenity Spa Bali', 'ACTIVITY', 'Sound healing session', 'Canggu', 2200], ['Serenity Spa Bali', 'ACTIVITY', 'Recovery yoga session', 'Canggu', 1200], ['Serenity Spa Bali', 'ACTIVITY', 'Couples spa journey', 'Ubud', 5200], ['Serenity Spa Bali', 'ACTIVITY', 'Beach meditation', 'Canggu', 900],
] as const

async function main() {
  await prisma.recoveryPlan.deleteMany(); await prisma.disruption.deleteMany(); await prisma.review.deleteMany(); await prisma.paymentAudit.deleteMany(); await prisma.booking.deleteMany(); await prisma.itineraryDependency.deleteMany(); await prisma.itineraryItem.deleteMany(); await prisma.simulation.deleteMany(); await prisma.trip.deleteMany(); await prisma.inventoryItem.deleteMany(); await prisma.vendor.deleteMany(); await prisma.activityLog.deleteMany(); await prisma.platformSettings.deleteMany(); await prisma.user.deleteMany()
  const passwordHash = await bcrypt.hash('TripPilotAccess!', 12)
  const traveler = await prisma.user.create({ data: { name: 'Saloni Sharma', email: 'traveler@trippilot.io', passwordHash, role: Role.TRAVELER, phone: '+91 98765 43210', preferences: { interests: ['food', 'culture', 'relaxation'], pace: 'balanced' } } })
  await prisma.user.create({ data: { name: 'Alex Morgan', email: 'operator@trippilot.io', passwordHash, role: Role.OPERATOR, phone: '+1 555 010 2000', preferences: {} } })
  await prisma.user.create({ data: { name: 'Priya Nair', email: 'admin@trippilot.io', passwordHash, role: Role.ADMIN, phone: '+91 90000 11122', preferences: {} } })
  await prisma.platformSettings.create({ data: { id: 'singleton' } })
  const vendorData = [{ name: 'Bali Airways', category: 'Air', availability: 'Available', priceRange: '₹6k–₹13k', reliabilityScore: 92, confirmationRate: 98.2, cancellationRate: 1.1, responseTime: 14 }, { name: 'Ubud Canopy Retreat', category: 'Stay', availability: 'Limited', priceRange: '₹9k–₹16k', reliabilityScore: 96, confirmationRate: 99.1, cancellationRate: 0.5, responseTime: 11 }, { name: 'Canggu Tide House', category: 'Stay', availability: 'Available', priceRange: '₹7k–₹14k', reliabilityScore: 88, confirmationRate: 95.4, cancellationRate: 2.4, responseTime: 22 }, { name: 'Jiwa Experiences', category: 'Experience', availability: 'Available', priceRange: '₹1k–₹4k', reliabilityScore: 90, confirmationRate: 96.2, cancellationRate: 1.8, responseTime: 19 }, { name: 'Island Transfer Co.', category: 'Transfer', availability: 'Waitlist', priceRange: '₹1k–₹3k', reliabilityScore: 84, confirmationRate: 92.7, cancellationRate: 3.1, responseTime: 34 }, { name: 'Serenity Spa Bali', category: 'Wellness', availability: 'Available', priceRange: '₹900–₹5k', reliabilityScore: 94, confirmationRate: 98.6, cancellationRate: 0.8, responseTime: 16 }]
  const vendors = await Promise.all(vendorData.map((data) => prisma.vendor.create({ data })))
  const vendorByName = new Map(vendors.map((vendor) => [vendor.name, vendor]))
  await prisma.user.create({ data: { name: 'Mika Tanaka', email: 'vendor@trippilot.io', passwordHash, role: Role.VENDOR, phone: '+62 812 0012 0000', preferences: {}, vendorId: vendorByName.get('Bali Airways')!.id } })
  const tagsFor = (type: string, title: string) => {
    const base = type === 'HOTEL' ? ['relaxed', 'accommodation', 'comfort'] : type === 'FLIGHT' || type === 'TRANSFER' ? ['transportation', 'balanced'] : ['activity', 'culture']
    const text = title.toLowerCase()
    if (text.includes('surf') || text.includes('trek')) base.push('adventure', 'water-sports')
    if (text.includes('cooking') || text.includes('food')) base.push('food')
    if (text.includes('spa') || text.includes('meditation') || text.includes('yoga')) base.push('relaxed', 'wellness')
    if (text.includes('temple') || text.includes('terrace')) base.push('culture')
    return base
  }
  await Promise.all(inventory.map(([vendorName, type, title, location, price]) => prisma.inventoryItem.create({ data: { vendorId: vendorByName.get(vendorName)!.id, type: type as ItemType, title, location, price, availability: 'Available', tags: tagsFor(type, title) } })))
  const trip = await prisma.trip.create({ data: { userId: traveler.id, destination: 'Bali, Indonesia', startDate: at(12, 6), endDate: at(17, 20), budget: 95000, travelStyle: 'Balanced', status: 'CONFIRMED' } })
  const itemData = [
    ['Flight to Denpasar', 'FLIGHT', 12, 6, 12, 14, 'Ngurah Rai Airport', 12800, 'Bali Airways', 'CONFIRMED'], ['Private airport transfer', 'TRANSFER', 12, 14, 12, 16, 'Denpasar → Ubud', 2200, 'Island Transfer Co.', 'CONFIRMED'], ['Check in at Ubud Canopy Retreat', 'HOTEL', 12, 16, 15, 11, 'Ubud', 29400, 'Ubud Canopy Retreat', 'CONFIRMED'], ['Balinese cooking workshop', 'ACTIVITY', 13, 10, 13, 13, 'Ubud', 2800, 'Jiwa Experiences', 'CONFIRMED'], ['Mount Batur sunrise trek', 'ACTIVITY', 14, 2, 14, 9, 'Kintamani', 3200, 'Jiwa Experiences', 'AT_RISK'], ['Ubud to Canggu transfer', 'TRANSFER', 15, 11, 15, 13, 'Ubud → Canggu', 1700, 'Island Transfer Co.', 'PLANNED'], ['Check in at Canggu Tide House', 'HOTEL', 15, 14, 17, 11, 'Canggu', 17200, 'Canggu Tide House', 'CONFIRMED'], ['Canggu sunset surf lesson', 'ACTIVITY', 15, 17, 15, 19, 'Canggu', 2400, 'Jiwa Experiences', 'PLANNED'], ['Beach meditation', 'ACTIVITY', 16, 8, 16, 9, 'Canggu', 900, 'Serenity Spa Bali', 'PLANNED'], ['Airport departure transfer', 'TRANSFER', 17, 16, 17, 18, 'Canggu → Denpasar', 1500, 'Island Transfer Co.', 'PLANNED'],
  ] as const
  const items = await Promise.all(itemData.map(([title, type, startDay, startHour, endDay, endHour, location, cost, vendorName, status]) => prisma.itineraryItem.create({ data: { tripId: trip.id, title, type: type as ItemType, startTime: at(startDay, startHour), endTime: at(endDay, endHour), location, cost, vendorId: vendorByName.get(vendorName)!.id, status: status as ItemStatus } })))
  for (const [from, to] of [[0, 1], [1, 2], [2, 3], [2, 4], [4, 5], [5, 6], [6, 7], [6, 8], [8, 9]]) await prisma.itineraryDependency.create({ data: { predecessorId: items[from].id, dependentId: items[to].id } })
  for (const index of [0, 1, 2, 3]) await prisma.booking.create({ data: { itineraryItemId: items[index].id, vendorId: items[index].vendorId!, confirmationStatus: BookingStatus.CONFIRMED, paymentStatus: index < 3 ? PaymentStatus.PAID : PaymentStatus.PENDING, amount: items[index].cost } })
  const disruption = await prisma.disruption.create({ data: { tripId: trip.id, affectedItemId: items[4].id, type: 'WEATHER', severity: 'MEDIUM', status: 'OPEN', details: 'Cloud cover may limit Mount Batur sunrise visibility.' } })
  await prisma.recoveryPlan.createMany({ data: [{ disruptionId: disruption.id, changedItems: [items[4].id], extraCost: 0, timeDelta: 60, preferenceScore: 92, finalScore: 92, explanation: 'Shift the trek by one day and preserve the balanced pace.', status: 'DRAFT' }, { disruptionId: disruption.id, changedItems: [items[4].id, items[5].id], extraCost: 1200, timeDelta: 15, preferenceScore: 87, finalScore: 81, explanation: 'Switch to an afternoon volcano viewpoint with a private driver.', status: 'DRAFT' }] })
  await prisma.review.create({ data: { tripId: trip.id, vendorId: vendorByName.get('Ubud Canopy Retreat')!.id, rating: 5, tags: ['Peaceful', 'Great service'], comment: 'A perfect start to Bali.' } })
  await prisma.activityLog.create({ data: { userId: traveler.id, action: 'SEED_TRIP_CREATED', metadata: { tripId: trip.id, destination: trip.destination } } })
  console.log(`Seeded ${vendors.length} vendors, ${inventory.length} inventory items, and Bali trip ${trip.id}`)
}
main().finally(() => prisma.$disconnect())
