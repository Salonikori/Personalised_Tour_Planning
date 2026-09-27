// Pure, dependency-free loyalty-points calculator, kept in the same style as
// budgetAllocatorService.ts / checklistService.ts: no Prisma import, no I/O, just plain input in
// and a plain number out. Nothing here awards points to a User yet - that means deciding *when*
// a trip counts as "completed" (on status change? a cron sweep?) and how to make the award
// idempotent (a trip can't be re-awarded every time its status is re-saved), which is a
// persistence/transaction concern for the route or a background job, not this module. This file
// only answers "how many points would this be worth", so that logic can be reviewed on its own.

export interface LoyaltyTrip {
  startDate: Date | string
  endDate: Date | string
}

const POINTS_PER_DAY = 10
const TRIP_COMPLETION_CAP = 100
const REFERRAL_POINTS = 50

const toDate = (value: Date | string) => (value instanceof Date ? value : new Date(value))

// Same inclusive day-count convention as checklistService's tripDurationDays: a same-day trip
// still counts as 1 day, and a start/end pair that's backwards (bad data) floors to 1 rather than
// going negative.
function tripDurationDays(trip: LoyaltyTrip): number {
  const days = Math.ceil((toDate(trip.endDate).getTime() - toDate(trip.startDate).getTime()) / 86_400_000)
  return Math.max(1, days)
}

// 10 points per completed day, capped at 100 (i.e. a 10+ day trip is worth the same as a 10-day
// trip) - long trips shouldn't dominate the leaderboard just for being long. Deliberately takes no
// `status` field: whether a trip has actually reached a completed state is the caller's decision
// (and the caller's job to avoid double-awarding), this function only prices out the duration.
export function pointsForTripCompletion(trip: LoyaltyTrip): number {
  return Math.min(TRIP_COMPLETION_CAP, tripDurationDays(trip) * POINTS_PER_DAY)
}

// Fixed value regardless of who's referred or what they go on to do - kept as its own function
// (rather than an inlined constant at the call site) so the reward can gain conditions later
// (e.g. only after the referred user completes a trip) without changing every caller.
export function pointsForReferral(): number {
  return REFERRAL_POINTS
}
