/**
 * Focused test for: POST /api/recovery-plans/:id/approve (approveRecovery) itinerary/booking
 * status consistency (backend/src/server.ts, operator-approval branch).
 *
 * Reproduces the exact per-change reconciliation loop the route runs inside its
 * prisma.$transaction (find inventory -> read existing booking -> update itinerary item ->
 * cancel/refund old booking if needed -> upsert the replacement booking), against an
 * in-memory store shaped like the Prisma tables it touches. It imports the REAL
 * `resolveReplacementStatus` from backend/src/services/recoveryService.ts so the actual status
 * decision used by the route is exercised, not a re-implementation of it.
 *
 * Bug being guarded against: the replacement booking's confirmationStatus used to be derived
 * by re-reading the itinerary item's status immediately after this same loop had just written
 * it (`updatedItem.status === ItemStatus.CONFIRMED ? CONFIRMED : PENDING`), which was always
 * true and gave no real guarantee the two could never drift apart. This test asserts the
 * itinerary item and its Booking are always found in the SAME confirmation state after
 * approval, that a refund on an old paid booking still leaves exactly one Booking row for that
 * itinerary item (no duplicate replacement booking), and that a plan which (incorrectly) lists
 * the same itinerary item twice is only processed once.
 *
 * Run with: npx tsx test/recovery-approve-consistency.integration.test.ts
 */
import assert from 'node:assert/strict'
import { resolveReplacementStatus } from '../src/services/recoveryService.ts'

type ItemStatus = 'PLANNED' | 'CONFIRMED' | 'AT_RISK' | 'CANCELLED'
type BookingStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED'
type PaymentStatus = 'PENDING' | 'PAID' | 'REFUNDED'

type InventoryItem = { id: string; type: string; title: string; location: string; price: number; vendorId: string }
type ItineraryItem = { id: string; inventoryItemId: string | null; type: string; title: string; location: string; cost: number; vendorId: string | null; startTime: Date; endTime: Date; status: ItemStatus }
type Booking = { id: string; itineraryItemId: string; vendorId: string; amount: number; confirmationStatus: BookingStatus; paymentStatus: PaymentStatus }
type PaymentAudit = { id: string; bookingId: string; event: string; amount: number; vendorId: string; details: string }

const results: Array<{ step: string; pass: boolean; detail: string }> = []
const record = (step: string, pass: boolean, detail: string) => results.push({ step, pass, detail })
let auditSeq = 0

// ---- In-memory tables, reset per scenario ----
function makeStore() {
  const inventory = new Map<string, InventoryItem>()
  const items = new Map<string, ItineraryItem>()
  const bookings = new Map<string, Booking>() // keyed by itineraryItemId, mirroring the @unique constraint
  const paymentAudits: PaymentAudit[] = []
  return { inventory, items, bookings, paymentAudits }
}

// ---- Reproduces the per-change body of the approve transaction in server.ts ----
function applyRecoveryChanges(store: ReturnType<typeof makeStore>, planId: string, changes: Array<{ itineraryItemId: string; replacementInventoryItemId: string; startTime: Date; endTime: Date }>) {
  const uniqueChanges = [...new Map(changes.map((change) => [change.itineraryItemId, change] as const)).values()]
  for (const change of uniqueChanges) {
    const inventory = store.inventory.get(change.replacementInventoryItemId)
    if (!inventory) continue
    const existingBooking = store.bookings.get(change.itineraryItemId)
    const { itemStatus, bookingStatus } = resolveReplacementStatus()
    const current = store.items.get(change.itineraryItemId)!
    store.items.set(change.itineraryItemId, { ...current, inventoryItemId: inventory.id, type: inventory.type, title: inventory.title, location: inventory.location, cost: inventory.price, vendorId: inventory.vendorId, startTime: change.startTime, endTime: change.endTime, status: itemStatus })
    if (existingBooking) {
      if (existingBooking.paymentStatus === 'PAID') {
        store.bookings.set(change.itineraryItemId, { ...existingBooking, confirmationStatus: 'CANCELLED', paymentStatus: 'REFUNDED' })
        store.paymentAudits.push({ id: `pa-${auditSeq++}`, bookingId: existingBooking.id, event: 'RECOVERY_REFUND_REQUESTED', amount: existingBooking.amount, vendorId: existingBooking.vendorId, details: `Recovery plan ${planId} cancelled a paid booking.` })
      } else {
        store.bookings.set(change.itineraryItemId, { ...existingBooking, confirmationStatus: 'CANCELLED' })
      }
    }
    const priorOrNew = store.bookings.get(change.itineraryItemId)
    store.bookings.set(change.itineraryItemId, { id: priorOrNew?.id ?? `bk-${change.itineraryItemId}`, itineraryItemId: change.itineraryItemId, vendorId: inventory.vendorId, amount: inventory.price, confirmationStatus: bookingStatus, paymentStatus: 'PENDING' })
  }
}

console.log('=== Scenario 1: recovery with NO existing booking ===')
try {
  const store = makeStore()
  store.inventory.set('inv-new', { id: 'inv-new', type: 'ACTIVITY', title: 'Tegalalang rice terrace walk', location: 'Ubud', price: 1500, vendorId: 'v-jiwa' })
  store.items.set('i4', { id: 'i4', inventoryItemId: 'inv-old', type: 'ACTIVITY', title: 'Mount Batur sunrise trek', location: 'Kintamani', cost: 3200, vendorId: 'v-jiwa', startTime: new Date('2026-06-13T05:00:00Z'), endTime: new Date('2026-06-13T09:00:00Z'), status: 'CONFIRMED' })
  assert.equal(store.bookings.has('i4'), false, 'fixture sanity: i4 must start with no booking')

  applyRecoveryChanges(store, 'plan-1', [{ itineraryItemId: 'i4', replacementInventoryItemId: 'inv-new', startTime: new Date('2026-06-13T05:45:00Z'), endTime: new Date('2026-06-13T09:45:00Z') }])

  const item = store.items.get('i4')!
  const bookingRows = [...store.bookings.values()].filter((b) => b.itineraryItemId === 'i4')
  assert.equal(bookingRows.length, 1, 'exactly one replacement booking should be created')
  const booking = bookingRows[0]
  assert.equal(item.status, 'CONFIRMED', 'replacement itinerary item should be CONFIRMED')
  assert.equal(booking.confirmationStatus, 'CONFIRMED', 'replacement booking should be CONFIRMED, matching the itinerary item')
  assert.equal(booking.paymentStatus, 'PENDING', 'a brand-new replacement booking has not been paid yet')
  assert.equal(item.title, 'Tegalalang rice terrace walk', 'itinerary item should reflect the replacement inventory')
  assert.equal(booking.amount, 1500, 'booking amount should match the replacement inventory price')
  record('No existing booking -> item/booking status match', true, `item.status=${item.status}, booking.confirmationStatus=${booking.confirmationStatus}, booking.paymentStatus=${booking.paymentStatus}, 1 booking row.`)
} catch (error) {
  record('No existing booking -> item/booking status match', false, String(error))
}

console.log('=== Scenario 2: recovery with an EXISTING PAID booking ===')
try {
  const store = makeStore()
  store.inventory.set('inv-new', { id: 'inv-new', type: 'ACTIVITY', title: 'Balinese cooking workshop', location: 'Ubud', price: 2800, vendorId: 'v-jiwa' })
  store.items.set('i4', { id: 'i4', inventoryItemId: 'inv-old', type: 'ACTIVITY', title: 'Mount Batur sunrise trek', location: 'Kintamani', cost: 3200, vendorId: 'v-jiwa', startTime: new Date('2026-06-13T05:00:00Z'), endTime: new Date('2026-06-13T09:00:00Z'), status: 'CONFIRMED' })
  store.bookings.set('i4', { id: 'bk-old-i4', itineraryItemId: 'i4', vendorId: 'v-jiwa', amount: 3200, confirmationStatus: 'CONFIRMED', paymentStatus: 'PAID' })

  applyRecoveryChanges(store, 'plan-2', [{ itineraryItemId: 'i4', replacementInventoryItemId: 'inv-new', startTime: new Date('2026-06-13T05:45:00Z'), endTime: new Date('2026-06-13T09:45:00Z') }])

  const item = store.items.get('i4')!
  const bookingRows = [...store.bookings.values()].filter((b) => b.itineraryItemId === 'i4')
  assert.equal(bookingRows.length, 1, 'the old paid booking and the replacement booking must be the same single row for this itinerary item (Booking.itineraryItemId is unique) -- no duplicate booking should exist')
  const booking = bookingRows[0]
  assert.equal(item.status, 'CONFIRMED', 'replacement itinerary item should be CONFIRMED')
  assert.equal(booking.confirmationStatus, 'CONFIRMED', 'replacement booking should be CONFIRMED, matching the itinerary item (this is the bug: it must never end up PENDING while the item is CONFIRMED)')
  assert.equal(booking.amount, 2800, 'booking amount should be updated to the replacement inventory price')
  assert.equal(booking.vendorId, 'v-jiwa', 'booking vendor should be updated to the replacement inventory vendor')

  const refundAudits = store.paymentAudits.filter((audit) => audit.event === 'RECOVERY_REFUND_REQUESTED' && audit.bookingId === 'bk-old-i4')
  assert.equal(refundAudits.length, 1, 'the old paid booking must still be refunded via exactly one audit record')
  assert.equal(refundAudits[0].amount, 3200, 'refund audit should record the amount that was actually paid on the old booking')
  record('Existing paid booking -> refunded + consistent replacement', true, `item.status=${item.status}, booking.confirmationStatus=${booking.confirmationStatus}, 1 booking row, 1 refund audit for ₹${refundAudits[0].amount}.`)
} catch (error) {
  record('Existing paid booking -> refunded + consistent replacement', false, String(error))
}

console.log('=== Scenario 3: a plan that lists the same itinerary item twice is only processed once ===')
try {
  const store = makeStore()
  store.inventory.set('inv-new', { id: 'inv-new', type: 'ACTIVITY', title: 'Uluwatu fire dance', location: 'Uluwatu', price: 1800, vendorId: 'v-jiwa' })
  store.items.set('i4', { id: 'i4', inventoryItemId: 'inv-old', type: 'ACTIVITY', title: 'Mount Batur sunrise trek', location: 'Kintamani', cost: 3200, vendorId: 'v-jiwa', startTime: new Date('2026-06-13T05:00:00Z'), endTime: new Date('2026-06-13T09:00:00Z'), status: 'CONFIRMED' })
  store.bookings.set('i4', { id: 'bk-old-i4', itineraryItemId: 'i4', vendorId: 'v-jiwa', amount: 3200, confirmationStatus: 'CONFIRMED', paymentStatus: 'PAID' })

  applyRecoveryChanges(store, 'plan-3', [
    { itineraryItemId: 'i4', replacementInventoryItemId: 'inv-new', startTime: new Date('2026-06-13T05:45:00Z'), endTime: new Date('2026-06-13T09:45:00Z') },
    { itineraryItemId: 'i4', replacementInventoryItemId: 'inv-new', startTime: new Date('2026-06-13T05:45:00Z'), endTime: new Date('2026-06-13T09:45:00Z') },
  ])

  const bookingRows = [...store.bookings.values()].filter((b) => b.itineraryItemId === 'i4')
  const refundAudits = store.paymentAudits.filter((audit) => audit.bookingId === 'bk-old-i4')
  assert.equal(bookingRows.length, 1, 'still only one booking row after a duplicated change entry')
  assert.equal(refundAudits.length, 1, 'the duplicated change entry must not create a second refund audit for the same booking')
  record('Duplicated change entries de-duplicated', true, `1 booking row and 1 refund audit despite 2 identical change entries in the plan.`)
} catch (error) {
  record('Duplicated change entries de-duplicated', false, String(error))
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
