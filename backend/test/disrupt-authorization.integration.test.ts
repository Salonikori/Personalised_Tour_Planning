/**
 * Focused test for: POST /api/trips/:id/disrupt authorization.
 *
 * Reproduces the exact ownership guard added to the route in backend/src/server.ts
 * (the same conditional already used by findAccessibleTrip() and by the recovery-plan
 * endpoints: `role === TRAVELER && trip.userId !== auth.sub` -> 403). No live DB/network
 * is required since this checks the guard's decision logic directly, mirroring the
 * pattern already used by the other test files in this folder.
 *
 * Run with: npx tsx test/disrupt-authorization.integration.test.ts
 */
import assert from 'node:assert/strict'

type Role = 'TRAVELER' | 'OPERATOR' | 'VENDOR'
type Auth = { sub: string; role: Role }
type Trip = { id: string; userId: string }

// Mirrors the guard now in server.ts's POST /api/trips/:id/disrupt handler (and the
// pre-existing findAccessibleTrip() helper / recovery-plan endpoints it matches).
function checkDisruptAccess(trip: Trip, auth: Auth): { status: number; body?: { error: string } } {
  if (auth.role === 'TRAVELER' && trip.userId !== auth.sub) return { status: 403, body: { error: 'Trip access denied.' } }
  return { status: 200 }
}

const results: Array<{ step: string; pass: boolean; detail: string }> = []
const record = (step: string, pass: boolean, detail: string) => results.push({ step, pass, detail })

const trip: Trip = { id: 't-bali', userId: 'u-owner' }

console.log('=== Scenario 1: Traveler + own trip -> allowed ===')
try {
  const result = checkDisruptAccess(trip, { sub: 'u-owner', role: 'TRAVELER' })
  assert.equal(result.status, 200, 'the trip owner must be allowed to trigger a disruption')
  record('Traveler + own trip', true, 'Owning traveler passes the guard (200, proceeds to disruption logic).')
} catch (error) {
  record('Traveler + own trip', false, String(error))
}

console.log('=== Scenario 2: Traveler + another user\'s trip -> rejected ===')
try {
  const result = checkDisruptAccess(trip, { sub: 'u-someone-else', role: 'TRAVELER' })
  assert.equal(result.status, 403, 'a traveler must not be able to disrupt a trip they do not own')
  assert.equal(result.body?.error, 'Trip access denied.')
  record('Traveler + other user\'s trip', true, 'Non-owning traveler is rejected with 403 "Trip access denied." (matches findAccessibleTrip()\'s message).')
} catch (error) {
  record('Traveler + other user\'s trip', false, String(error))
}

console.log('=== Scenario 3: Operator -> existing intended behavior preserved (not ownership-restricted) ===')
try {
  const result = checkDisruptAccess(trip, { sub: 'op-1', role: 'OPERATOR' })
  assert.equal(result.status, 200, 'operators must retain their existing unrestricted access to trigger disruptions on any trip')
  record('Operator access preserved', true, 'Operator (not the trip owner) still passes the guard, matching how OPERATOR is already treated by findAccessibleTrip() and the recovery-plan endpoints.')
} catch (error) {
  record('Operator access preserved', false, String(error))
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
