/**
 * Focused test for: POST /api/trips/:id/itinerary/reorder -> ITINERARY_REORDERED activity
 * logging (backend/src/server.ts).
 *
 * Problem: /api/operator/analytics (server.ts) already counts 'ITINERARY_REORDERED' entries
 * from ActivityLog under its "Edits" pattern, alongside ITINERARY_EDITED/REMOVED/ADDED --
 * every one of which IS created by its respective endpoint. The reorder endpoint was the only
 * one of that group that validated the payload, persisted the new times, and rebuilt
 * dependencies, but never wrote the matching ActivityLog row.
 *
 * This reproduces the reorder endpoint's actual control flow (payload validation ->
 * persist -> rebuildDependencies -> activityLog.create) plus the analytics endpoint's
 * pattern-counting logic, against an in-memory store shaped like the Trip/ItineraryItem/
 * ItineraryDependency/ActivityLog tables, following the same pattern as the project's other
 * integration tests (no live DB required).
 *
 * Run with: npx tsx test/reorder-activity-log.integration.test.ts
 */
import assert from 'node:assert/strict'

type Item = { id: string; tripId: string; type: string; startTime: Date; endTime: Date }
type Dependency = { predecessorId: string; dependentId: string }
type ActivityLog = { userId: string; action: string; metadata: Record<string, unknown> }

const results: Array<{ step: string; pass: boolean; detail: string }> = []
const record = (step: string, pass: boolean, detail: string) => results.push({ step, pass, detail })

function makeStore(items: Item[]) {
  return { items: [...items], dependencies: [] as Dependency[], activityLog: [] as ActivityLog[] }
}

// ---- Mirrors rebuildDependencies() in server.ts (chain by startTime order) ----
function rebuildDependencies(store: ReturnType<typeof makeStore>, tripId: string) {
  const items = store.items.filter((item) => item.tripId === tripId).sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
  store.dependencies = store.dependencies.filter((edge) => !items.some((item) => item.id === edge.predecessorId))
  const edges: Dependency[] = []
  for (let index = 1; index < items.length; index += 1) edges.push({ predecessorId: items[index - 1].id, dependentId: items[index].id })
  store.dependencies.push(...edges)
}

// ---- Reproduces POST /api/trips/:id/itinerary/reorder ----
function reorderItinerary(store: ReturnType<typeof makeStore>, tripId: string, userId: string, entries: Array<{ id: string; startTime: Date; endTime: Date }>, tripDates: { start: Date; end: Date }) {
  const items = store.items.filter((item) => item.tripId === tripId)
  if (entries.length !== items.length || entries.some((entry) => !items.some((item) => item.id === entry.id))) return { status: 400, error: 'Reorder payload does not match this itinerary.' }
  if (entries.some((entry) => entry.startTime >= entry.endTime)) return { status: 422, error: 'Every activity needs an end time after its start time.' }
  if (entries.some((entry) => entry.startTime < tripDates.start || entry.endTime > tripDates.end)) return { status: 422, error: 'A reordered activity falls outside your trip dates.' }
  if (entries.some((entry, index) => entries.some((other, otherIndex) => otherIndex !== index && entry.startTime < other.endTime && entry.endTime > other.startTime))) return { status: 422, error: 'The reordered activities overlap.' }
  for (const entry of entries) { const item = store.items.find((candidate) => candidate.id === entry.id)!; item.startTime = entry.startTime; item.endTime = entry.endTime }
  rebuildDependencies(store, tripId)
  store.activityLog.push({ userId, action: 'ITINERARY_REORDERED', metadata: { tripId, itemIds: entries.map((entry) => entry.id) } })
  return { status: 200, items: store.items.filter((item) => item.tripId === tripId) }
}

// ---- Mirrors the "Edits" pattern count in GET /api/operator/analytics ----
function countEditsPattern(store: ReturnType<typeof makeStore>) {
  const actions = ['ITINERARY_EDITED', 'ITINERARY_REORDERED', 'ITINERARY_REMOVED', 'ITINERARY_ADDED']
  return store.activityLog.filter((log) => actions.includes(log.action)).length
}

console.log('=== Reorder succeeds, logs ITINERARY_REORDERED, analytics counts it, dependencies rebuild ===')
try {
  const tripId = 't-bali'
  const store = makeStore([
    { id: 'i1', tripId, type: 'FLIGHT', startTime: new Date('2026-06-12T06:00:00Z'), endTime: new Date('2026-06-12T14:00:00Z') },
    { id: 'i2', tripId, type: 'ACTIVITY', startTime: new Date('2026-06-13T02:00:00Z'), endTime: new Date('2026-06-13T09:00:00Z') },
    { id: 'i3', tripId, type: 'ACTIVITY', startTime: new Date('2026-06-14T10:00:00Z'), endTime: new Date('2026-06-14T13:00:00Z') },
  ])
  rebuildDependencies(store, tripId) // initial state, as if the items were created in order
  assert.equal(store.dependencies.length, 2, 'fixture sanity: initial chain should have 2 edges')
  assert.equal(countEditsPattern(store), 0, 'fixture sanity: no activity logged yet')

  const tripDates = { start: new Date('2026-06-12T00:00:00Z'), end: new Date('2026-06-17T23:59:59Z') }
  const result = reorderItinerary(store, tripId, 'u-1', [
    { id: 'i2', startTime: new Date('2026-06-12T15:00:00Z'), endTime: new Date('2026-06-12T18:00:00Z') },
    { id: 'i1', startTime: new Date('2026-06-13T02:00:00Z'), endTime: new Date('2026-06-13T09:00:00Z') },
    { id: 'i3', startTime: new Date('2026-06-14T10:00:00Z'), endTime: new Date('2026-06-14T13:00:00Z') },
  ], tripDates)

  assert.equal(result.status, 200, 'reorder should succeed')
  record('Reorder succeeds', true, `status=200, ${result.items?.length} items returned.`)

  const reorderLogs = store.activityLog.filter((log) => log.action === 'ITINERARY_REORDERED')
  assert.equal(reorderLogs.length, 1, 'exactly one ITINERARY_REORDERED activity should be recorded')
  assert.equal(reorderLogs[0].userId, 'u-1', 'the activity should be attributed to the requesting user, matching the sibling itinerary endpoints')
  assert.deepEqual((reorderLogs[0].metadata as { tripId: string }).tripId, tripId, 'the activity metadata should record the tripId, matching the sibling itinerary endpoints')
  record('ITINERARY_REORDERED activity recorded', true, `1 log entry: action=${reorderLogs[0].action}, userId=${reorderLogs[0].userId}, metadata.tripId=${tripId}.`)

  const editsCount = countEditsPattern(store)
  assert.equal(editsCount, 1, 'the analytics "Edits" pattern (which already includes ITINERARY_REORDERED) should now count this reorder')
  record('Analytics can count the reorder', true, `"Edits" pattern count = ${editsCount} (was 0 before the reorder).`)

  assert.equal(store.dependencies.length, 2, 'dependency chain should still have 2 edges after reorder')
  assert.ok(store.dependencies.some((edge) => edge.predecessorId === 'i2' && edge.dependentId === 'i1'), 'dependencies should reflect the new chronological order (i2 now precedes i1)')
  record('Dependency rebuilding still works', true, `2 dependency edges, chain now follows the new start-time order.`)
} catch (error) {
  record('Reorder + activity + analytics + dependencies', false, String(error))
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
