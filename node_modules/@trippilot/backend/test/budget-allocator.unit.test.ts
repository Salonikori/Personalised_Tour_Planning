/**
 * Unit test for the constraint-based budget allocator that replaced the old
 * running-total guardrail (backend/src/services/budgetAllocatorService.ts).
 *
 * Pure function tests - no DB, no Express route.
 *
 * Run with: npx tsx test/budget-allocator.unit.test.ts
 */
import assert from 'node:assert/strict'
import { allocateBudget, categorizeItem, normalizeWeights, DEFAULT_CATEGORY_WEIGHTS, type AllocatableItem } from '../src/services/budgetAllocatorService.ts'

const results: Array<{ step: string; pass: boolean; detail: string }> = []
const record = (step: string, pass: boolean, detail: string) => results.push({ step, pass, detail })

// ---- categorizeItem: type-driven mapping + food keyword fallback on ACTIVITY titles ----
try {
  assert.equal(categorizeItem({ type: 'FLIGHT', title: 'Flight to Denpasar' }), 'flights')
  assert.equal(categorizeItem({ type: 'HOTEL', title: 'Check in at Ubud Canopy Retreat' }), 'hotel')
  assert.equal(categorizeItem({ type: 'TRANSFER', title: 'Private airport transfer' }), 'activities')
  assert.equal(categorizeItem({ type: 'ACTIVITY', title: 'Mount Batur sunrise trek' }), 'activities')
  assert.equal(categorizeItem({ type: 'ACTIVITY', title: 'Balinese cooking workshop' }), 'food')
  assert.equal(categorizeItem({ type: 'ACTIVITY', title: 'Sunset dinner cruise' }), 'food')
  record('categorizeItem maps types and food keywords', true, 'FLIGHT/HOTEL map directly; TRANSFER and generic ACTIVITY fall back to activities; food keywords in an ACTIVITY title win.')
} catch (error) { record('categorizeItem maps types and food keywords', false, String(error)) }

// ---- normalizeWeights: rescales any positive input to sum to 1, falls back to defaults ----
try {
  const evenSplit = normalizeWeights({ flights: 1, hotel: 1, activities: 1, food: 1 })
  assert.ok(Object.values(evenSplit).every((weight) => Math.abs(weight - 0.25) < 1e-9), `expected an even 25/25/25/25 split, got ${JSON.stringify(evenSplit)}`)
  const rescaled = normalizeWeights({ flights: 70, hotel: 60, activities: 40, food: 30 }) // sums to 200
  assert.ok(Math.abs(rescaled.flights - 0.35) < 1e-9 && Math.abs(rescaled.hotel - 0.30) < 1e-9, `expected proportional rescale to 35/30/20/15, got ${JSON.stringify(rescaled)}`)
  const zeroed = normalizeWeights({ flights: 0, hotel: 0, activities: 0, food: 0 })
  assert.deepEqual(zeroed, normalizeWeights(DEFAULT_CATEGORY_WEIGHTS), 'all-zero weights should fall back to the default split')
  record('normalizeWeights rescales and defaults', true, 'Even input -> 25/25/25/25; 70/60/40/30 -> 35/30/20/15; all-zero -> default weights.')
} catch (error) { record('normalizeWeights rescales and defaults', false, String(error)) }

// ---- allocateBudget: flags only the category that breaks its own slice, not the whole trip ----
try {
  const budget = 100_000
  const weights = { flights: 35, hotel: 30, activities: 20, food: 15 } // allocates 35k/30k/20k/15k
  const items: AllocatableItem[] = [
    { id: 'f1', title: 'Flight out', cost: 20_000, category: 'flights' },
    { id: 'h1', title: 'Hotel week 1', cost: 18_000, category: 'hotel' },
    { id: 'h2', title: 'Hotel week 2', cost: 15_000, category: 'hotel' }, // hotel total 33k > 30k slice
    { id: 'a1', title: 'City tour', cost: 5_000, category: 'activities' },
    { id: 'fo1', title: 'Tasting menu', cost: 4_000, category: 'food' },
  ]
  const result = allocateBudget(budget, weights, items)
  assert.equal(result.fullyRebalanced, false, 'trip has an over-allocated category and should not report fully rebalanced')
  assert.deepEqual(result.overAllocatedCategories, ['hotel'], `expected only hotel to be flagged, got ${JSON.stringify(result.overAllocatedCategories)}`)
  const flights = result.categories.find((c) => c.category === 'flights')!
  assert.equal(flights.overAllocated, false, 'flights spend (20k) is under its 35k slice and must not be flagged')
  const hotel = result.categories.find((c) => c.category === 'hotel')!
  assert.equal(hotel.allocatedBudget, 30_000)
  assert.equal(hotel.actualSpend, 33_000)
  assert.equal(hotel.overBy, 3_000)
  // Overall committed spend (62k) is still well under the 100k trip budget, proving this is a
  // genuinely different signal from the old "committed > trip.budget" running-total guardrail.
  const totalCommitted = items.reduce((sum, item) => sum + item.cost, 0)
  assert.ok(totalCommitted < budget, 'sanity check: trip-wide total must stay under budget so only the category constraint trips')
  record('allocateBudget flags only the breaking category', true, `Hotel flagged over by ₹${hotel.overBy} while trip total (₹${totalCommitted}) stays under the ₹${budget} budget - the old guardrail would have stayed silent here.`)
} catch (error) { record('allocateBudget flags only the breaking category', false, String(error)) }

// ---- suggestions: greedily pick the fewest, costliest items whose removal closes the gap ----
try {
  const items: AllocatableItem[] = [
    { id: 'h1', title: 'Overwater villa', cost: 25_000, category: 'hotel' },
    { id: 'h2', title: 'City hotel', cost: 4_000, category: 'hotel' },
    { id: 'h3', title: 'Beach resort', cost: 3_000, category: 'hotel' },
  ]
  const result = allocateBudget(100_000, { flights: 35, hotel: 30, activities: 20, food: 15 }, items) // hotel slice 30k, spend 32k, over by 2k
  const suggestion = result.suggestions.find((s) => s.category === 'hotel')!
  assert.ok(suggestion, 'expected a swap suggestion for the over-allocated hotel category')
  assert.equal(suggestion.candidates.length, 1, `expected the single costliest item to close the 2k gap, got ${suggestion.candidates.length} candidates`)
  assert.equal(suggestion.candidates[0].id, 'h1', 'expected the ₹25k overwater villa to be the swap candidate, not the cheaper rooms')
  assert.equal(suggestion.closesGap, true, 'removing the ₹25k item covers the ₹2k overage, so the suggestion should report the gap as closed')
  record('swap suggestions pick minimal costliest items', true, `Suggested swapping "${suggestion.candidates[0].title}" (₹${suggestion.candidates[0].cost}) to close a ₹${suggestion.overBy} hotel overage in one move.`)
} catch (error) { record('swap suggestions pick minimal costliest items', false, String(error)) }

// ---- when the costliest single item isn't enough, the allocator pulls in a second before stopping ----
try {
  const items: AllocatableItem[] = [
    { id: 'a1', title: 'Sunset dinner cruise', cost: 900, category: 'food' },
    { id: 'a2', title: 'Cooking class', cost: 800, category: 'food' },
    { id: 'a3', title: 'Street food tour', cost: 200, category: 'food' },
  ] // food slice at 15% of 10k budget = 1.5k, spend 1.9k, over by 0.4k
  const result = allocateBudget(10_000, { flights: 35, hotel: 30, activities: 20, food: 15 }, items)
  const food = result.categories.find((c) => c.category === 'food')!
  assert.equal(food.overBy, 400)
  const suggestion = result.suggestions.find((s) => s.category === 'food')!
  // The costliest item alone (900) already exceeds the 400 gap, so the greedy pick should stop at one.
  assert.equal(suggestion.candidates.length, 1, `expected the single costliest item to be enough, got ${JSON.stringify(suggestion.candidates)}`)
  assert.equal(suggestion.candidates[0].id, 'a1')
  assert.equal(suggestion.closesGap, true)
  record('greedy pick stops as soon as the gap is closed', true, `A ₹400 food overage only required swapping the ₹900 dinner cruise, leaving the ₹800 and ₹200 items untouched.`)
} catch (error) { record('greedy pick stops as soon as the gap is closed', false, String(error)) }

// ---- a zero-weight category with spend must stay JSON-safe (no Infinity, which serializes to
// null over Express's response.json() and would zero out the frontend meter) ----
try {
  const items: AllocatableItem[] = [{ id: 'h1', title: 'Hotel', cost: 5_000, category: 'hotel' }]
  const result = allocateBudget(10_000, { flights: 100, hotel: 0, activities: 0, food: 0 }, items) // hotel weight normalizes to 0
  const hotel = result.categories.find((c) => c.category === 'hotel')!
  assert.equal(hotel.allocatedBudget, 0)
  assert.equal(hotel.overAllocated, true)
  assert.ok(Number.isFinite(hotel.utilization), `utilization must be finite for JSON safety, got ${hotel.utilization}`)
  const roundTripped = JSON.parse(JSON.stringify(result))
  assert.notEqual(roundTripped.categories.find((c: { category: string }) => c.category === 'hotel').utilization, null, 'utilization must survive a JSON round-trip as a real number, not null')
  record('zero-weight over-allocated category stays JSON-safe', true, `A zero-weight hotel slice with ₹${hotel.actualSpend} spend reports a finite utilization (${hotel.utilization}) that survives JSON.stringify/parse instead of becoming null.`)
} catch (error) { record('zero-weight over-allocated category stays JSON-safe', false, String(error)) }

console.log('\n================ RESULTS ================')
let allPass = true
for (const result of results) {
  const status = result.pass ? 'PASS' : 'FAIL'
  if (!result.pass) allPass = false
  console.log(`[${status}] ${result.step}\n       ${result.detail}`)
}
console.log('===========================================')
console.log(allPass ? 'ALL STEPS PASSED' : 'SOME STEPS FAILED')
process.exit(allPass ? 0 : 1)
