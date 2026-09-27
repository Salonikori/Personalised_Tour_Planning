// Deterministic "Prepare" stage checklist generator, kept as a pure, DB-free module in the same
// style as budgetAllocatorService.ts: it never touches Prisma or the network, only shapes plain
// input into a plain output so the route layer can decide how (and whether) to persist it.
//
// The list is built from three deterministic sources:
//  - PACKING items derived from destination climate cues already surfaced by weatherCheckService
//    (severe-weather reasons for the trip window) plus trip-length staples that don't depend on
//    weather at all (documents wallet, chargers, etc.).
//  - DOCUMENT items: a passport/ID reminder is always included; a visa reminder is added only
//    when the traveler's stated home country (from User.preferences, itself a free-form JSON
//    blob elsewhere in this codebase) differs from the trip's destination country and both are
//    known - never guessed.
//  - REMINDER items: a couple of trip-shape-driven prompts (check-in cutoffs, confirm bookings)
//    that don't need weather or destination data at all.

export type ChecklistCategory = 'DOCUMENT' | 'PACKING' | 'REMINDER'

export interface GeneratedChecklistItem {
  category: ChecklistCategory
  label: string
}

// Structurally compatible with (but intentionally not imported from) weatherCheckService's
// SevereForecast - this module stays dependency-free, so it only declares the handful of fields
// it actually reads.
export interface ChecklistWeatherSignal {
  date: string
  reasons: string[]
}

export interface ChecklistTrip {
  destination: string
  startDate: Date | string
  endDate: Date | string
  user?: { preferences?: unknown } | null
}

export interface ChecklistItineraryItem {
  type: string
  title: string
}

const toDate = (value: Date | string) => (value instanceof Date ? value : new Date(value))
const tripDurationDays = (trip: ChecklistTrip) => Math.max(1, Math.ceil((toDate(trip.endDate).getTime() - toDate(trip.startDate).getTime()) / 86_400_000))

// Destination strings in this app are free-text ("Kyoto, Japan", "Goa"), so country extraction is
// a best-effort read of the text after the last comma - good enough to compare against a
// traveler's stated home country without pretending to be a real geocoder (that's Open-Meteo's
// job elsewhere in the app, and it isn't wired into this pure module on purpose).
function destinationCountry(destination: string): string | null {
  const parts = destination.split(',').map((part) => part.trim()).filter(Boolean)
  return parts.length > 1 ? parts[parts.length - 1] : null
}

function travelerHomeCountry(preferences: unknown): string | null {
  if (!preferences || typeof preferences !== 'object') return null
  const value = (preferences as Record<string, unknown>).homeCountry
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

const WEATHER_PACKING_RULES: Array<{ keyword: string; item: string }> = [
  { keyword: 'thunderstorm', item: 'Compact travel umbrella / rain shell' },
  { keyword: 'hail', item: 'Sturdy waterproof footwear' },
  { keyword: 'wind gust', item: 'Windbreaker jacket' },
  { keyword: 'precipitation', item: 'Waterproof bag cover for electronics' },
]

function packingFromWeather(weatherForecast: ChecklistWeatherSignal[] | null | undefined): string[] {
  if (!weatherForecast?.length) return []
  const reasons = weatherForecast.flatMap((day) => day.reasons.map((reason) => reason.toLowerCase()))
  const items = WEATHER_PACKING_RULES.filter((rule) => reasons.some((reason) => reason.includes(rule.keyword))).map((rule) => rule.item)
  return [...new Set(items)]
}

function packingFromTripShape(trip: ChecklistTrip, itineraryItems: ChecklistItineraryItem[]): string[] {
  const days = tripDurationDays(trip)
  const items = ['Phone + charger', 'Travel adapter', days >= 4 ? 'Laundry bag' : 'Extra change of clothes']
  if (itineraryItems.some((item) => item.type === 'FLIGHT')) items.push('Printed/downloaded boarding passes')
  if (itineraryItems.some((item) => item.type === 'HOTEL')) items.push('Reusable toiletries kit')
  if (itineraryItems.some((item) => item.type === 'ACTIVITY')) items.push('Comfortable walking shoes')
  return items
}

export function generateChecklist(trip: ChecklistTrip, weatherForecast: ChecklistWeatherSignal[] | null | undefined, itineraryItems: ChecklistItineraryItem[]): GeneratedChecklistItem[] {
  const packing = [...new Set([...packingFromTripShape(trip, itineraryItems), ...packingFromWeather(weatherForecast)])]
    .map((label): GeneratedChecklistItem => ({ category: 'PACKING', label }))

  const documents: GeneratedChecklistItem[] = [{ category: 'DOCUMENT', label: 'Valid passport / government-issued ID' }]
  const home = travelerHomeCountry(trip.user?.preferences)
  const destination = destinationCountry(trip.destination)
  if (home && destination && home.toLowerCase() !== destination.toLowerCase()) {
    documents.push({ category: 'DOCUMENT', label: `Check visa requirements for ${destination} (traveling from ${home})` })
    documents.push({ category: 'DOCUMENT', label: `Check whether your insurance covers medical evacuation in ${destination}` })
  } else {
    documents.push({ category: 'DOCUMENT', label: 'Confirm travel insurance covers your trip dates and destination' })
  }

  const reminders: GeneratedChecklistItem[] = [
    { category: 'REMINDER', label: 'Confirm all pending bookings are paid and confirmed' },
    { category: 'REMINDER', label: 'Check flight/hotel check-in windows the day before departure' },
  ]

  return [...documents, ...packing, ...reminders]
}
