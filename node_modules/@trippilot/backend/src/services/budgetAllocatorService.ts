import type { ItemType } from '@prisma/client'

// Basic constraint-based budget allocator.
//
// The old guardrail was a single running total: sum every committed item and flag the trip once
// that total crossed the whole-trip budget. That can't tell a traveler *why* they're over - it
// only fires once the damage is already spread across the itinerary.
//
// This allocator treats the budget as a set of per-category constraints instead of one number:
// each category (flights/hotel/activities/food) gets a slice of the total budget sized by its
// weight, and spend inside that category is checked against its own slice. A category is
// "over-allocated" when its actual spend exceeds its allocated slice, independent of whether the
// trip as a whole is still under budget. For every over-allocated category we greedily pick the
// costliest items until removing them would close the gap, and surface those as swap candidates.

export type BudgetCategory = 'flights' | 'hotel' | 'activities' | 'food'

export const CATEGORIES: BudgetCategory[] = ['flights', 'hotel', 'activities', 'food']

export type CategoryWeights = Record<BudgetCategory, number>

// Sums to 100 for readability, but normalizeWeights() re-scales any input so the actual unit
// (percent, ratio, arbitrary points) never matters.
export const DEFAULT_CATEGORY_WEIGHTS: CategoryWeights = { flights: 35, hotel: 30, activities: 20, food: 15 }

const CATEGORY_LABEL: Record<BudgetCategory, string> = { flights: 'Flights', hotel: 'Hotel', activities: 'Activities', food: 'Food' }

const FOOD_KEYWORDS = ['food', 'restaurant', 'dining', 'breakfast', 'lunch', 'dinner', 'cafe', 'café', 'meal', 'cooking']

const round2 = (value: number) => Math.round(value * 100) / 100
const round4 = (value: number) => Math.round(value * 10_000) / 10_000

// ACTIVITY and TRANSFER items have no dedicated ItemType of their own for food, so a keyword match
// on the title (same heuristic the seed data already uses to tag "food" activities) buckets meals
// separately from sightseeing; everything else on the ground - including transfers - counts as
// "activities" spend.
export function categorizeItem(item: { type: ItemType; title: string }): BudgetCategory {
  if (item.type === 'FLIGHT') return 'flights'
  if (item.type === 'HOTEL') return 'hotel'
  const text = item.title.toLowerCase()
  if (FOOD_KEYWORDS.some((keyword) => text.includes(keyword))) return 'food'
  return 'activities'
}

export function normalizeWeights(weights: Partial<CategoryWeights> | null | undefined): CategoryWeights {
  const raw = CATEGORIES.reduce((acc, category) => { acc[category] = Math.max(0, weights?.[category] ?? 0); return acc }, {} as CategoryWeights)
  const sum = CATEGORIES.reduce((total, category) => total + raw[category], 0)
  if (sum <= 0) return normalizeWeights(DEFAULT_CATEGORY_WEIGHTS)
  return CATEGORIES.reduce((acc, category) => { acc[category] = raw[category] / sum; return acc }, {} as CategoryWeights)
}

export interface AllocatableItem { id: string; title: string; cost: number; category: BudgetCategory }

export interface CategoryAllocation {
  category: BudgetCategory
  label: string
  weight: number
  allocatedBudget: number
  actualSpend: number
  utilization: number
  overAllocated: boolean
  overBy: number
  itemCount: number
}

export interface SwapCandidate { id: string; title: string; cost: number }

export interface SwapSuggestion {
  category: BudgetCategory
  overBy: number
  candidates: SwapCandidate[]
  projectedSavings: number
  closesGap: boolean
  message: string
}

export interface AllocationResult {
  totalBudget: number
  weights: CategoryWeights
  categories: CategoryAllocation[]
  overAllocatedCategories: BudgetCategory[]
  suggestions: SwapSuggestion[]
  fullyRebalanced: boolean
}

// Greedily removes the costliest items first - the fewest swaps that close (or shrink) the gap,
// rather than nudging every item in the category by a little.
function pickSwapCandidates(items: AllocatableItem[], targetReduction: number): SwapCandidate[] {
  const sorted = [...items].sort((a, b) => b.cost - a.cost)
  const picks: SwapCandidate[] = []
  let reduced = 0
  for (const item of sorted) {
    if (reduced >= targetReduction) break
    picks.push({ id: item.id, title: item.title, cost: item.cost })
    reduced += item.cost
  }
  return picks
}

function buildSuggestion(allocation: CategoryAllocation, candidates: SwapCandidate[]): SwapSuggestion {
  const projectedSavings = round2(candidates.reduce((sum, item) => sum + item.cost, 0))
  const closesGap = projectedSavings >= allocation.overBy
  const label = CATEGORY_LABEL[allocation.category]
  const names = candidates.map((item) => item.title).join(', ')
  const message = candidates.length === 0
    ? `${label} is over by ₹${allocation.overBy.toLocaleString()} with nothing left to swap - consider raising its weight or increasing the total budget.`
    : closesGap
      ? `Swap out ${names} to bring ${label} back within its ₹${allocation.allocatedBudget.toLocaleString()} allocation.`
      : `Swapping ${names} saves ₹${projectedSavings.toLocaleString()} toward the ₹${allocation.overBy.toLocaleString()} overage in ${label} - you'll still need to trim more or shift weight from an under-used category.`
  return { category: allocation.category, overBy: allocation.overBy, candidates, projectedSavings, closesGap, message }
}

export function allocateBudget(totalBudget: number, weights: Partial<CategoryWeights> | null | undefined, items: AllocatableItem[]): AllocationResult {
  const normalized = normalizeWeights(weights)
  const grouped = CATEGORIES.reduce((acc, category) => { acc[category] = items.filter((item) => item.category === category); return acc }, {} as Record<BudgetCategory, AllocatableItem[]>)

  const categories: CategoryAllocation[] = CATEGORIES.map((category) => {
    const allocatedBudget = round2(Math.max(0, totalBudget) * normalized[category])
    const actualSpend = round2(grouped[category].reduce((sum, item) => sum + item.cost, 0))
    const overBy = round2(Math.max(0, actualSpend - allocatedBudget))
    return {
      category,
      label: CATEGORY_LABEL[category],
      weight: round4(normalized[category]),
      allocatedBudget,
      actualSpend,
      // A finite sentinel, not Number.POSITIVE_INFINITY - Infinity serializes to `null` over
      // JSON (Express's response.json()), which would silently zero out the meter on the
      // frontend for a category that's over its (zero) slice. 100 = "1000%", already far past
      // the 100% the frontend clamps its meter width to.
      utilization: allocatedBudget > 0 ? round4(actualSpend / allocatedBudget) : (actualSpend > 0 ? 100 : 0),
      overAllocated: overBy > 0,
      overBy,
      itemCount: grouped[category].length,
    }
  })

  const overAllocatedCategories = categories.filter((allocation) => allocation.overAllocated).map((allocation) => allocation.category)
  const suggestions = categories
    .filter((allocation) => allocation.overAllocated)
    .map((allocation) => buildSuggestion(allocation, pickSwapCandidates(grouped[allocation.category], allocation.overBy)))

  return { totalBudget: round2(totalBudget), weights: normalized, categories, overAllocatedCategories, suggestions, fullyRebalanced: overAllocatedCategories.length === 0 }
}
