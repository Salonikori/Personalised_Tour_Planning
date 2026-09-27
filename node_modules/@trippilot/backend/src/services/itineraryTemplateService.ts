// A genuine "predefined ready-made itineraries" library: a fixed, browsable set of named,
// curated presets a traveler can pick before generation instead of leaving every selection
// empty. Applying one is a distinct mechanism from the empty-selection auto-generate path -
// it seeds a proven travelStyle/tripType/pace/interest combination (and optionally a set of
// destination-agnostic must-see tags) that then drives the *same* verified-inventory + automated reasoning
// composition pipeline used everywhere else in the app. Nothing here is destination-specific
// data (no fixed hotel/activity names) - the templates describe the *shape* of a trip, and the
// existing discovery/inventory services fill it in for whatever destination the trip already
// has, exactly like the manual flow does.
export type ItineraryTemplate = {
  id: string
  name: string
  tagline: string
  description: string
  icon: string
  tripType: string
  travelStyle: string
  pace: number
  interestTags: string[]
  recommendedDays: { min: number; max: number }
  recommendedBudgetTier: 'budget' | 'standard' | 'premium'
}

export const ITINERARY_TEMPLATES: ItineraryTemplate[] = [
  {
    id: 'relaxed-beach-escape',
    name: 'Relaxed Beach Escape',
    tagline: 'Slow mornings, warm water, no alarms.',
    description: 'A low-pace plan built around beach time, spa/relaxation stops, and unhurried meals. Best for travelers who want to switch off rather than sightsee non-stop.',
    icon: '🏖️',
    tripType: 'leisure',
    travelStyle: 'couple',
    pace: 20,
    interestTags: ['relaxation', 'food'],
    recommendedDays: { min: 3, max: 10 },
    recommendedBudgetTier: 'standard',
  },
  {
    id: 'culture-heritage-trail',
    name: 'Culture & Heritage Trail',
    tagline: 'Temples, museums, old towns, and the stories behind them.',
    description: 'Prioritizes heritage sites, museums, and local culture over nightlife or adventure sports, with a moderate daily pace that leaves room to actually read the plaques.',
    icon: '🏛️',
    tripType: 'cultural',
    travelStyle: 'solo',
    pace: 55,
    interestTags: ['culture', 'food'],
    recommendedDays: { min: 3, max: 14 },
    recommendedBudgetTier: 'standard',
  },
  {
    id: 'adventure-sprint',
    name: 'Adventure Sprint',
    tagline: 'Pack every day. Sleep when you land home.',
    description: 'A fast-paced, activity-dense plan for trekking, water sports, and outdoor adventure, plus evening nightlife. Fewer rest gaps, more doing.',
    icon: '🧗',
    tripType: 'adventure',
    travelStyle: 'group',
    pace: 85,
    interestTags: ['adventure', 'nightlife'],
    recommendedDays: { min: 3, max: 10 },
    recommendedBudgetTier: 'standard',
  },
  {
    id: 'family-friendly-classic',
    name: 'Family Friendly Classic',
    tagline: 'Something for the kids, something for the adults.',
    description: 'A balanced, moderate-pace itinerary that mixes family-friendly attractions with easygoing meals, avoiding late nights or overly strenuous activities.',
    icon: '👨‍👩‍👧‍👦',
    tripType: 'leisure',
    travelStyle: 'family',
    pace: 40,
    interestTags: ['family-friendly', 'food'],
    recommendedDays: { min: 3, max: 12 },
    recommendedBudgetTier: 'standard',
  },
  {
    id: 'romantic-getaway',
    name: 'Romantic Getaway',
    tagline: 'A trip built for two.',
    description: 'A gentle-pace plan weighted toward scenic, relaxing, and culturally rich experiences well suited to couples, with room for spontaneous plans.',
    icon: '💞',
    tripType: 'leisure',
    travelStyle: 'couple',
    pace: 30,
    interestTags: ['relaxation', 'culture'],
    recommendedDays: { min: 2, max: 8 },
    recommendedBudgetTier: 'premium',
  },
  {
    id: 'business-efficient',
    name: 'Business Efficient',
    tagline: 'In, done, out - with one good meal.',
    description: 'A tight, efficient plan for a short business trip: minimal downtime, convenient locations, and a couple of good food stops instead of full-day excursions.',
    icon: '💼',
    tripType: 'business',
    travelStyle: 'solo',
    pace: 60,
    interestTags: ['food'],
    recommendedDays: { min: 1, max: 5 },
    recommendedBudgetTier: 'premium',
  },
  {
    id: 'foodie-trail',
    name: 'Foodie Trail',
    tagline: 'Plan the day around where you are eating.',
    description: 'Centers the trip on local food culture - markets, signature dishes, and culinary experiences - with cultural stops worked in between meals.',
    icon: '🍜',
    tripType: 'leisure',
    travelStyle: 'solo',
    pace: 50,
    interestTags: ['food', 'culture'],
    recommendedDays: { min: 2, max: 10 },
    recommendedBudgetTier: 'standard',
  },
  {
    id: 'backpacker-budget-explorer',
    name: 'Backpacker Budget Explorer',
    tagline: 'Maximum experience, minimum spend.',
    description: 'A high-pace, budget-conscious plan that favors free/low-cost adventure and nightlife experiences over premium stays, for travelers optimizing for coverage over comfort.',
    icon: '🎒',
    tripType: 'adventure',
    travelStyle: 'solo',
    pace: 70,
    interestTags: ['adventure', 'nightlife'],
    recommendedDays: { min: 3, max: 21 },
    recommendedBudgetTier: 'budget',
  },
]

export function getTemplateById(id: string): ItineraryTemplate | undefined {
  return ITINERARY_TEMPLATES.find((template) => template.id === id)
}
