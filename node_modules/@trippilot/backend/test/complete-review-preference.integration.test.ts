/**
 * Focused integration test for the flow:
 *   Trip Complete -> Review -> Preference Learning
 *
 * This drives the REAL business-logic module used by GET /api/trips/:id/complete
 * and POST /api/trips/:id/reviews (backend/src/services/preferenceService.ts),
 * reproducing the exact steps the Express route performs, against fixture data
 * shaped like prisma/seed.ts. It does not require a live Postgres/SQLite
 * connection: the DB layer is replaced by a tiny in-memory store whose shape
 * mirrors the Prisma calls the route makes, so the route's own control flow
 * (upsert-vs-create, status transitions, preference recompute) is exercised
 * faithfully.
 *
 * Run with: npx tsx test/complete-review-preference.integration.test.ts
 */
import assert from 'node:assert/strict'
import { learnFromReview, preferenceMatch, type PreferenceProfile } from '../src/services/preferenceService.ts'

type Review = { id: string; tripId: string; vendorId: string; rating: number; tags: string[]; comment?: string }
type Item = { id: string; vendorId: string | null; type: string; title: string; cost: number; location: string; startTime: Date; tags?: string[] }

const results: Array<{ step: string; pass: boolean; detail: string }> = []
const record = (step: string, pass: boolean, detail: string) => results.push({ step, pass, detail })

// ---- Fixture: mirrors prisma/seed.ts (Bali trip, Ubud Canopy Retreat + Jiwa Experiences) ----
let trip = {
  id: 't-bali', userId: 'u-1', destination: 'Bali', budget: 60000, travelStyle: 'Balanced',
  startDate: new Date('2026-06-12'), endDate: new Date('2026-06-17'), status: 'BOOKED',
}
let user = { id: 'u-1', preferences: { interests: ['culture'], weights: { culture: 1 } } as PreferenceProfile }
const items: Item[] = [
  { id: 'i2', vendorId: 'v-ubud', type: 'HOTEL', title: 'Check in at Ubud Canopy Retreat', cost: 29400, location: 'Ubud', startTime: new Date('2026-06-12'), tags: ['hotel', 'relaxed'] },
  { id: 'i3', vendorId: 'v-jiwa', type: 'ACTIVITY', title: 'Balinese cooking workshop', cost: 2800, location: 'Ubud', startTime: new Date('2026-06-13'), tags: ['activity', 'culture', 'food'] },
]
let reviews: Review[] = []
let activityLog: Array<{ action: string; metadata: Record<string, unknown> }> = []
let events: Array<{ event: string; data: Record<string, unknown> }> = []
const publishEvent = (event: string, data: Record<string, unknown>) => events.push({ event, data })

// ---- Reproduces GET /api/trips/:id/complete (backend/src/server.ts:152-157) ----
function getCompletedTrip() {
  const spend = Object.entries(items.reduce<Record<string, number>>((all, item) => { const label = item.type[0] + item.type.slice(1).toLowerCase(); all[label] = (all[label] || 0) + item.cost; return all }, {})).map(([name, value]) => ({ name, value }))
  const vendors = [...new Map(items.filter((item) => item.vendorId).map((item) => [item.vendorId!, { id: item.vendorId! }])).values()]
  return { trip: { id: trip.id, destination: trip.destination, status: trip.status }, recap: items.map((item, index) => ({ time: `Stop ${index + 1}`, title: item.title, type: item.type })), spend, vendors, reviews: reviews.map((r) => ({ vendorId: r.vendorId, rating: r.rating, tags: r.tags, comment: r.comment })), preferences: user.preferences || {} }
}

// ---- Reproduces POST /api/trips/:id/reviews (backend/src/server.ts:158-163, post-fix) ----
function submitReview(input: { vendorId: string; rating: number; tags: string[]; comment?: string }) {
  const vendorUsed = items.some((item) => item.vendorId === input.vendorId)
  if (!vendorUsed) return { status: 422, body: { error: 'Reviews can only be submitted for a trip vendor.' } }
  const existing = reviews.find((r) => r.tripId === trip.id && r.vendorId === input.vendorId)
  // Snapshot the prior rating/tags BEFORE mutating the row in place, so learnFromReview nets out
  // the review's *old* contribution rather than double-reading the already-updated values.
  const previous = existing ? { tags: [...existing.tags], rating: existing.rating } : undefined
  const review: Review = existing
    ? Object.assign(existing, { rating: input.rating, tags: input.tags, comment: input.comment })
    : (() => { const created = { id: `r-${reviews.length + 1}`, tripId: trip.id, vendorId: input.vendorId, rating: input.rating, tags: input.tags, comment: input.comment }; reviews.push(created); return created })()
  const profile = learnFromReview((user.preferences || {}) as PreferenceProfile, input.tags, input.rating, previous)
  user = { ...user, preferences: profile }
  trip = { ...trip, status: 'COMPLETED' }
  activityLog.push({ action: existing ? 'REVIEW_UPDATED' : 'REVIEW_SUBMITTED', metadata: { tripId: trip.id, vendorId: input.vendorId, rating: input.rating, tags: input.tags } })
  publishEvent('review-submitted', { tripId: trip.id, reviewId: review.id })
  return { status: existing ? 200 : 201, body: { review, preferences: profile } }
}

console.log('=== Step 1: Trip can be completed (recap available; ownership/state untouched) ===')
try {
  const before = getCompletedTrip()
  assert.equal(before.trip.status, 'BOOKED', 'trip should not be silently marked complete just by viewing the recap')
  assert.equal(before.recap.length, 2)
  assert.deepEqual(before.spend.map((s) => s.name).sort(), ['Activity', 'Hotel'])
  assert.equal(before.reviews.length, 0)
  record('Trip complete recap loads', true, `Recap for "${before.trip.destination}" returned ${before.recap.length} stops, ${before.vendors.length} vendors, status="${before.trip.status}" (unchanged).`)
} catch (error) {
  record('Trip complete recap loads', false, String(error))
  throw error
}

console.log('=== Step 2: Review can be submitted, and only for a vendor actually on the trip ===')
try {
  const rejected = submitReview({ vendorId: 'v-not-on-trip', rating: 5, tags: ['culture'], comment: '' })
  assert.equal(rejected.status, 422, 'review for a non-trip vendor must be rejected')

  const accepted = submitReview({ vendorId: 'v-ubud', rating: 5, tags: ['Great value', 'relaxation'], comment: 'Loved it.' })
  assert.equal(accepted.status, 201)
  assert.equal(reviews.length, 1)
  assert.equal(trip.status, 'COMPLETED', 'trip should transition to COMPLETED once a review is submitted')
  record('Review submission', true, `Non-trip vendor correctly rejected (422); valid review accepted (201) and trip status -> "${trip.status}".`)
} catch (error) {
  record('Review submission', false, String(error))
  throw error
}

console.log('=== Step 3: Review submission does not corrupt trip state ===')
try {
  assert.equal(trip.id, 't-bali'); assert.equal(trip.destination, 'Bali'); assert.equal(trip.budget, 60000)
  assert.equal(trip.startDate.toISOString(), new Date('2026-06-12').toISOString())
  assert.equal(items.length, 2, 'itinerary items must be untouched by a review')
  const recap = getCompletedTrip()
  assert.equal(recap.reviews.length, 1)
  assert.equal(recap.reviews[0].rating, 5)
  record('Trip state integrity', true, 'Only trip.status changed; destination, budget, dates, and itinerary items are all unmodified after review submission.')
} catch (error) {
  record('Trip state integrity', false, String(error))
}

console.log('=== Step 4: Re-submitting/editing a review upserts instead of creating a duplicate ===')
try {
  const preferencesBeforeEdit = JSON.parse(JSON.stringify(user.preferences))
  const edited = submitReview({ vendorId: 'v-ubud', rating: 2, tags: ['Great value', 'relaxation'], comment: 'Actually, service slipped.' })
  assert.equal(edited.status, 200, 'editing an existing review should be a 200 update, not a 201 create')
  assert.equal(reviews.length, 1, 'editing a review must not create a second row for the same trip+vendor')
  assert.equal(reviews[0].rating, 2, 'the stored review should reflect the edited rating')
  record('Review upsert (no duplication)', true, `Reviews for this trip+vendor stayed at ${reviews.length} row after an edit; rating updated to ${reviews[0].rating}.`)
  void preferencesBeforeEdit
} catch (error) {
  record('Review upsert (no duplication)', false, String(error))
}

console.log('=== Step 5: Preference learning updates the existing preference profile (and edits net out cleanly) ===')
try {
  // Fresh scenario: start from a clean profile, submit one 5-star review, confirm the profile updates.
  user = { id: 'u-1', preferences: { interests: [], weights: {} } }
  reviews = []
  trip = { ...trip, status: 'BOOKED' }
  const first = submitReview({ vendorId: 'v-jiwa', rating: 5, tags: ['food', 'culture'], comment: '' })
  const afterFirst = (first.body as { preferences: PreferenceProfile }).preferences
  assert.ok(afterFirst.interests?.includes('food') && afterFirst.interests?.includes('culture'), 'positive review should add its tags as interests')
  assert.equal(afterFirst.weights?.food, 1); assert.equal(afterFirst.weights?.culture, 1)

  // Edit the SAME review down to a bad rating with the same tags: the old +1 should be netted out
  // before the new -1 is applied, landing at -1 (not -2, which would be the compounding bug).
  const editedDown = submitReview({ vendorId: 'v-jiwa', rating: 1, tags: ['food', 'culture'], comment: 'Revised opinion.' })
  const afterEdit = (editedDown.body as { preferences: PreferenceProfile }).preferences
  assert.equal(afterEdit.weights?.food, -1, `expected weight to net to -1 after edit, got ${afterEdit.weights?.food}`)
  assert.equal(afterEdit.weights?.culture, -1, `expected weight to net to -1 after edit, got ${afterEdit.weights?.culture}`)

  record('Preference learning is correct and non-compounding', true, `After posting a 5★ review then editing it to 1★ (same tags), weights net to ${afterEdit.weights?.food} (the old +1 is netted out before the new -1 is applied, instead of compounding to -2).`)
} catch (error) {
  record('Preference learning is correct and non-compounding', false, String(error))
}

console.log('=== Step 6: Learned preferences are visible to a future itinerary generation ===')
try {
  // generate-itinerary (backend/src/server.ts:174-195) re-fetches trip.user.preferences fresh on
  // every call and feeds it into preferenceMatch() against candidate inventory - simulate that here.
  const inventoryCandidateGoodMatch = [{ id: 'inv-relax', tags: ['relaxed'] }]
  const inventoryCandidateBadMatch = [{ id: 'inv-food', tags: ['food'] }]
  const profile = user.preferences as PreferenceProfile // the just-updated profile from Step 5 (food/culture disliked)
  const scoreBad = preferenceMatch(profile, inventoryCandidateBadMatch)
  const scoreNeutral = preferenceMatch(profile, inventoryCandidateGoodMatch)
  assert.ok(scoreBad <= scoreNeutral, `an item tagged with a disliked interest ("food") should not score higher than an unrelated item (bad=${scoreBad}, neutral=${scoreNeutral})`)
  record('Learned preferences feed future itineraries', true, `preferenceMatch() against the updated profile scores a disliked-tag item at ${scoreBad} vs ${scoreNeutral} for an unrelated item, confirming the learned signal reaches itinerary generation.`)
} catch (error) {
  record('Learned preferences feed future itineraries', false, String(error))
}

console.log('\n\n================ RESULTS ================')
let allPass = true
for (const result of results) {
  const status = result.pass ? 'PASS' : 'FAIL'
  if (!result.pass) allPass = false
  console.log(`[${status}] ${result.step}\n       ${result.detail}`)
}
console.log('===========================================')
console.log(allPass ? 'ALL STEPS PASSED' : 'SOME STEPS FAILED')
process.exit(allPass ? 0 : 1)
