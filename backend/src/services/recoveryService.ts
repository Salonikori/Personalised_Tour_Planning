import { type BookingStatus, type InventoryItem, type ItemStatus, type ItineraryItem, type Vendor } from '@prisma/client'
import { getDownstreamItemIds } from '../lib/dependencyGraph.js'
import { preferenceMatch, type PreferenceProfile } from './preferenceService.js'

export type RecoveryAlternative = InventoryItem & { vendor: Vendor }
export type RecoveryProposal = { name: string; changedItems: Array<{ itineraryItemId: string; replacementInventoryItemId: string; startTime: string; endTime: string }>; extraCost: number; timeDeltaMinutes: number; preferenceMatchScore: number; vendorReliability: number; finalScore: number; explanation: string }
export const decisionModeValues = ['cheapest', 'fastest', 'comfort', 'experience', 'balanced'] as const
export type DecisionMode = typeof decisionModeValues[number]
const rankingWeights: Record<DecisionMode, { cost: number; time: number; comfort: number; experience: number; reliability: number }> = {
  balanced: { cost: 0.2, time: 0.2, comfort: 0.2, experience: 0.25, reliability: 0.15 },
  cheapest: { cost: 0.6, time: 0.1, comfort: 0.05, experience: 0.1, reliability: 0.15 },
  fastest: { cost: 0.1, time: 0.6, comfort: 0.1, experience: 0.1, reliability: 0.1 },
  comfort: { cost: 0.05, time: 0.15, comfort: 0.45, experience: 0.1, reliability: 0.25 },
  experience: { cost: 0.1, time: 0.1, comfort: 0.1, experience: 0.6, reliability: 0.1 },
}
const normalizedScore = (value: number, values: number[], lowerIsBetter = false) => {
  const minimum = Math.min(...values); const maximum = Math.max(...values)
  if (minimum === maximum) return 100
  const score = ((value - minimum) / (maximum - minimum)) * 100
  return lowerIsBetter ? 100 - score : score
}
// Single source of truth for the status a recovery *replacement* item/booking pair gets
// when an operator approves a plan (approveRecovery, see server.ts). The rest of TripPilot
// never leaves a replacement half-confirmed: checkout (`/api/trips/:id/checkout`) commits
// ItineraryItem.status and Booking.confirmationStatus together in the same call, and there
// is no separate "awaiting confirmation" step anywhere else in the app. Recovery approval
// follows that same rule, so it derives the itinerary item's status and the booking's
// confirmationStatus from this one function instead of one being computed from the other
// (which previously let a booking upsert fall out of sync with the itinerary item it
// belongs to). PaymentStatus is intentionally untouched here -- capturing payment stays a
// separate, later action (checkout), exactly as it already is for every other booking path.
export function resolveReplacementStatus(): { itemStatus: ItemStatus; bookingStatus: BookingStatus } {
  return { itemStatus: 'CONFIRMED' as ItemStatus, bookingStatus: 'CONFIRMED' as BookingStatus }
}
export function analyzeImpact(affected: ItineraryItem, items: ItineraryItem[], dependencies: Array<{ predecessorId: string; dependentId: string }>, type: string, details: string) {
  const ids = getDownstreamItemIds(affected.id, dependencies)
  const delay = Number(details.match(/\d+/)?.[0] || 0)
  const depth = ids.size - 1
  const score = delay / 30 + depth * 1.5 + (affected.type === 'FLIGHT' ? 2 : 0)
  const severity = score >= 7 ? 'CRITICAL' : score >= 4 ? 'HIGH' : score >= 2 ? 'MEDIUM' : 'LOW'
  return { ids: [...ids], severity, explanation: `${type} on ${affected.title} affects ${ids.size} connected itinerary item${ids.size === 1 ? '' : 's'} across ${depth} dependency level${depth === 1 ? '' : 's'}.` }
}
export function buildProposals(affectedItems: ItineraryItem[], alternatives: RecoveryAlternative[], preferences: PreferenceProfile, decisionMode: DecisionMode = 'balanced') {
  const target = affectedItems.find((item) => item.type === 'ACTIVITY') || affectedItems[affectedItems.length - 1]
  const compatibleAlternatives = alternatives.filter((alternative) => alternative.type === target.type)
  const duration = target.endTime.getTime() - target.startTime.getTime()
  const candidates = compatibleAlternatives.map((alternative) => {
    const match = preferenceMatch(preferences, [alternative])
    const extraCost = alternative.price - target.cost
    const timeDeltaMinutes = alternative.location === target.location ? 20 : alternative.vendorId === target.vendorId ? 45 : 75
    const reliability = alternative.vendor.reliabilityScore
    return { alternative, match, extraCost, timeDeltaMinutes, reliability }
  })
  const weights = rankingWeights[decisionMode]
  const costs = candidates.map((candidate) => candidate.extraCost)
  const timeDeltas = candidates.map((candidate) => candidate.timeDeltaMinutes)
  return candidates.map((candidate) => {
    const locationScore = candidate.alternative.location === target.location ? 100 : 35
    const comfortScore = candidate.reliability * 0.7 + locationScore * 0.3
    const finalScore = Math.round(Math.max(0, Math.min(100,
      normalizedScore(candidate.extraCost, costs, true) * weights.cost +
      normalizedScore(candidate.timeDeltaMinutes, timeDeltas, true) * weights.time +
      comfortScore * weights.comfort +
      candidate.match * weights.experience +
      candidate.reliability * weights.reliability,
    )))
    return { name: `${decisionMode} recovery`, changedItems: [{ itineraryItemId: target.id, replacementInventoryItemId: candidate.alternative.id, startTime: new Date(target.startTime.getTime() + candidate.timeDeltaMinutes * 60_000).toISOString(), endTime: new Date(target.startTime.getTime() + candidate.timeDeltaMinutes * 60_000 + duration).toISOString() }], extraCost: candidate.extraCost, timeDeltaMinutes: candidate.timeDeltaMinutes, preferenceMatchScore: candidate.match, vendorReliability: candidate.reliability, finalScore, explanation: `Replace ${target.title} with verified ${candidate.alternative.title} from ${candidate.alternative.vendor.name}; ${decisionMode} mode deterministically ranks database cost, timing, preference tags, location, and vendor reliability.` } satisfies RecoveryProposal
  }).sort((a, b) => {
    // The weighted finalScore blends multiple factors, so for the two modes whose
    // name promises a single dominant metric ("cheapest" = lowest extra cost,
    // "fastest" = lowest time delta), that raw metric must decide the #1 ranking
    // deterministically -- otherwise comfort/reliability/preference weighting can
    // outvote the metric the mode is named after. finalScore still breaks ties.
    if (decisionMode === 'cheapest' && a.extraCost !== b.extraCost) return a.extraCost - b.extraCost
    if (decisionMode === 'fastest' && a.timeDeltaMinutes !== b.timeDeltaMinutes) return a.timeDeltaMinutes - b.timeDeltaMinutes
    return b.finalScore - a.finalScore
  }).slice(0, 3)
}
