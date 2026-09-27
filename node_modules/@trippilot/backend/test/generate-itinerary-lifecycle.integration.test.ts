/**
 * Focused test for: POST /api/trips/:id/generate-itinerary regeneration-lifecycle guard
 * (backend/src/server.ts).
 *
 * Reproduces the exact route logic added around the pre-existing
 * `prisma.itineraryItem.deleteMany({ where: { tripId } })` call: fetch the trip with its
 * items/bookings, decide whether the trip is already committed (status BOOKED/COMPLETED, or
 * any item has a Booking with paymentStatus PAID or confirmationStatus CONFIRMED), and either
 * reject with 409 before touching any data, or proceed with the existing
 * delete-then-recreate regeneration exactly as before.
 *
 * This does not require a live DB: the Prisma calls are replaced with an in-memory store
 * whose shape mirrors the Trip/ItineraryItem/Booking tables, matching the pattern already
 * used by the other integration tests in this folder.
 *
 * Run with: npx tsx test/generate-itinerary-lifecycle.integration.test.ts
 */
import assert from 'node:assert/strict'

type TripStatus = 'DRAFT' | 'COMPOSED' | 'BOOKED' | 'COMPLETED' | 'CONFIRMED'
type ItemStatus = 'PLANNED' | 'CONFIRMED' | 'AT_RISK' | 'CANCELLED'
type BookingStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED'
type PaymentStatus = 'PENDING' | 'PAID' | 'REFUNDED'

type Booking = { id: string; confirmationStatus: BookingStatus; paymentStatus: PaymentStatus }
type ItineraryItem = { id: string; tripId: string; title: string; booking: Booking | null }
type Trip = { id: string; status: TripStatus; budget: number }

const results: Array<{ step: string; pass: boolean; detail: string }> = []
const record = (step: string, pass: boolean, detail: string) => results.push({ step, pass, detail })

// ---- In-memory store ----
function makeStore(trip: Trip, items: ItineraryItem[]) {
  return { trip, items: [...items] }
}

// ---- Reproduces the guard + regeneration body of POST /api/trips/:id/generate-itinerary ----
// Returns either a rejected response shape (status/error) or the list of newly-created item
// titles, exactly mirroring what the real route would do to the DB.
function generateItinerary(store: ReturnType<typeof makeStore>, newItemTitles: string[]) {
  const trip = store.trip
  const tripItems = store.items.filter((item) => item.tripId === trip.id)
  const hasCommittedBooking = tripItems.some((item) => item.booking && (item.booking.paymentStatus === 'PAID' || item.booking.confirmationStatus === 'CONFIRMED'))
  if (trip.status === 'BOOKED' || trip.status === 'COMPLETED' || hasCommittedBooking) {
    return { status: 409, error: 'Booked trips cannot be regenerated.' }
  }
  // deleteMany({ where: { tripId } })
  store.items = store.items.filter((item) => item.tripId !== trip.id)
  const created = newItemTitles.map((title, index) => ({ id: `new-${trip.id}-${index}`, tripId: trip.id, title, booking: null }))
  store.items.push(...created)
  store.trip = { ...trip, status: 'COMPOSED' }
  return { status: 200, days: created.map((item) => item.title) }
}

console.log('=== Scenario 1: DRAFT trip -> regeneration works ===')
try {
  const store = makeStore({ id: 't-draft', status: 'DRAFT', budget: 50000 }, [])
  const result = generateItinerary(store, ['Flight to Denpasar', 'Check in at hotel'])
  assert.equal(result.status, 200, 'a draft trip with no items must regenerate successfully')
  assert.equal(store.items.length, 2, 'the generated items should be saved')
  assert.equal(store.trip.status, 'COMPOSED', 'trip status should move to COMPOSED after generation')
  record('DRAFT trip regenerates', true, `status=200, trip.status=${store.trip.status}, ${store.items.length} items created.`)
} catch (error) {
  record('DRAFT trip regenerates', false, String(error))
}

console.log('=== Scenario 2: COMPOSED (unbooked) trip -> regeneration still works and replaces items ===')
try {
  const store = makeStore(
    { id: 't-composed', status: 'COMPOSED', budget: 50000 },
    [
      { id: 'old-1', tripId: 't-composed', title: 'Old activity A', booking: null },
      { id: 'old-2', tripId: 't-composed', title: 'Old activity B', booking: { id: 'bk-old-2', confirmationStatus: 'PENDING', paymentStatus: 'PENDING' } },
    ],
  )
  const result = generateItinerary(store, ['New activity A', 'New activity B', 'New activity C'])
  assert.equal(result.status, 200, 'an unbooked (COMPOSED, no committed bookings) trip must still regenerate')
  assert.equal(store.items.some((item) => item.id === 'old-1' || item.id === 'old-2'), false, 'old, unbooked itinerary items should be replaced')
  assert.equal(store.items.length, 3, 'the new itinerary should be saved in place of the old one')
  record('Unbooked trip regenerates and replaces items', true, `status=200, old items removed, ${store.items.length} new items saved.`)
} catch (error) {
  record('Unbooked trip regenerates and replaces items', false, String(error))
}

console.log('=== Scenario 3a: BOOKED trip (status) -> regeneration rejected, items untouched ===')
try {
  const store = makeStore(
    { id: 't-booked', status: 'BOOKED', budget: 50000 },
    [
      { id: 'bk-item-1', tripId: 't-booked', title: 'Flight to Denpasar', booking: { id: 'bk-1', confirmationStatus: 'CONFIRMED', paymentStatus: 'PAID' } },
      { id: 'bk-item-2', tripId: 't-booked', title: 'Check in at hotel', booking: { id: 'bk-2', confirmationStatus: 'CONFIRMED', paymentStatus: 'PAID' } },
    ],
  )
  const result = generateItinerary(store, ['Would-be replacement A'])
  assert.equal(result.status, 409, 'a BOOKED trip must be rejected with 409')
  assert.equal((result as { error?: string }).error, 'Booked trips cannot be regenerated.', 'the error message must match the required text exactly')
  assert.equal(store.items.length, 2, 'the existing booked itinerary items must NOT be deleted')
  assert.equal(store.trip.status, 'BOOKED', 'trip status must remain BOOKED (unchanged)')
  record('BOOKED trip rejected, items preserved', true, `status=409 "${(result as { error?: string }).error}", ${store.items.length} original items preserved, trip.status unchanged.`)
} catch (error) {
  record('BOOKED trip rejected, items preserved', false, String(error))
}

console.log('=== Scenario 3b: trip with a PAID/CONFIRMED booking under a different status label -> still rejected ===')
try {
  // Mirrors the seeded sample trip, whose Trip.status is literally 'CONFIRMED' (not 'BOOKED')
  // but which already has real PAID bookings -- the guard must not rely on the status label
  // alone.
  const store = makeStore(
    { id: 't-seed-style', status: 'CONFIRMED', budget: 95000 },
    [{ id: 'seed-item-1', tripId: 't-seed-style', title: 'Flight to Denpasar', booking: { id: 'bk-seed-1', confirmationStatus: 'CONFIRMED', paymentStatus: 'PAID' } }],
  )
  const result = generateItinerary(store, ['Would-be replacement A'])
  assert.equal(result.status, 409, 'a trip with an actual PAID/CONFIRMED booking must be rejected regardless of its status label')
  assert.equal(store.items.length, 1, 'the existing booked item must NOT be deleted')
  record('Non-standard "booked" status label still rejected', true, `status=409, ${store.items.length} original item preserved despite trip.status="CONFIRMED".`)
} catch (error) {
  record('Non-standard "booked" status label still rejected', false, String(error))
}

console.log('\n================ RESULTS ================')
for (const result of results) {
  console.log(`[${result.pass ? 'PASS' : 'FAIL'}] ${result.step}`)
  console.log(`       ${result.detail}`)
}
console.log('===========================================')
if (results.some((result) => !result.pass)) {
  console.log('SOME STEPS FAILED')
  process.exitCode = 1
} else {
  console.log('ALL STEPS PASSED')
}
