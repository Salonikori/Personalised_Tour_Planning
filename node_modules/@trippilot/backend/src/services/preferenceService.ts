export type PreferenceProfile = { interests?: string[]; weights?: Record<string, number>; pace?: number; travelStyle?: string; travelPace?: string; accommodationPreference?: string; transportationPreference?: string; activityPreference?: string; onboardingComplete?: boolean }
export type TaggedInventory = { id: string; tags: unknown }

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, '-')
export function preferenceMatch(profile: PreferenceProfile, inventory: TaggedInventory[]) {
  const signals = [profile.travelStyle, profile.travelPace, profile.accommodationPreference, profile.transportationPreference, profile.activityPreference, ...(profile.interests || [])].filter((value): value is string => Boolean(value)).map(normalize)
  if (!signals.length || !inventory.length) return 70
  const tags = new Set(inventory.flatMap((item) => Array.isArray(item.tags) ? item.tags : []).filter((tag): tag is string => typeof tag === 'string').map(normalize))
  const weights = profile.weights || {}
  // `importance` (always positive) sizes each signal's share of the 0-30 point swing; the signed
  // raw weight is what actually moves `matchedWeight`, so a learned dislike (negative weight)
  // pulls the score below the 70 baseline instead of always adding to it. Flooring importance at
  // 0.25 keeps an unweighted/neutral signal from ever having zero say, and bounds the final score
  // to [40, 100] since |raw weight| <= importance for every signal.
  const importance = (weight: number) => Math.max(0.25, Math.abs(weight))
  const totalWeight = signals.reduce((sum, signal) => sum + importance(weights[signal] ?? 1), 0)
  const matchedWeight = signals.filter((signal) => tags.has(signal)).reduce((sum, signal) => sum + (weights[signal] ?? 1), 0)
  return Math.round(70 + (matchedWeight / totalWeight) * 30)
}

// Applies a rating+tags delta to the profile. `sign` lets a caller net out ("undo")
// a previous review's contribution (sign = -1) before applying the new one (sign = 1),
// so editing/resubmitting a review doesn't compound its effect on the learned weights.
function applyReviewDelta(profile: PreferenceProfile, tags: string[], rating: number, sign: 1 | -1) {
  const weights = { ...(profile.weights || {}) }; const interests = new Set((profile.interests || []).map(normalize)); const delta = (rating >= 4 ? 1 : rating <= 2 ? -1 : 0) * sign
  tags.map(normalize).forEach((tag) => { weights[tag] = Math.max(-5, Math.min(5, (weights[tag] || 0) + delta)); if (delta > 0) interests.add(tag); if (delta < 0 && weights[tag] <= -3) interests.delete(tag) })
  return { ...profile, interests: [...interests], weights }
}

export function learnFromReview(profile: PreferenceProfile, tags: string[], rating: number, previous?: { tags: string[]; rating: number }) {
  const base = previous ? applyReviewDelta(profile, previous.tags, previous.rating, -1) : profile
  return applyReviewDelta(base, tags, rating, 1)
}
