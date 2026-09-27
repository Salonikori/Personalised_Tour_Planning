import type { ItemType } from '@prisma/client'

// Lightweight, deterministic carbon estimates. These are directional estimates for comparing
// itinerary choices, not audited emissions figures.
const FLIGHT_BANDS = [
  { maxKm: 1500, kgPerKm: 0.18 },
  { maxKm: 4000, kgPerKm: 0.13 },
  { maxKm: Infinity, kgPerKm: 0.10 },
] as const
const HOTEL_KG_PER_NIGHT = 20
const TRANSFER_KG_PER_KM: Record<string, number> = { flight: 0.18, car: 0.21, train: 0.04, bus: 0.08 }
const TRANSFER_DEFAULT_KG = 1.5

const round2 = (value: number) => Math.round(value * 100) / 100
const textOf = (item: { title?: string; location?: string; tags?: unknown }) => {
  const tags = Array.isArray(item.tags) ? item.tags.join(' ') : item.tags && typeof item.tags === 'object' ? Object.values(item.tags as Record<string, unknown>).join(' ') : ''
  return `${item.title || ''} ${item.location || ''} ${tags}`.toLowerCase()
}

function distanceKm(item: { title?: string; location?: string; tags?: unknown }): number {
  const text = textOf(item)
  const tagged = text.match(/(?:distance|distancekm|km)\s*[:=]?\s*(\d+(?:\.\d+)?)/i)
  if (tagged) return Math.max(0, Number(tagged[1]))
  if (/\b(short|nearby|domestic|local)\b/.test(text)) return 800
  if (/\b(long|international|intercontinental)\b/.test(text)) return 7000
  if (/\b(medium|medium-haul|regional)\b/.test(text)) return 2500
  return 2000
}

export function estimateItemCarbonKg(item: { type: ItemType | string; title?: string; location?: string; startTime?: Date | string; endTime?: Date | string; tags?: unknown; distanceKm?: number }): number {
  const type = String(item.type).toUpperCase()
  const text = textOf(item)
  if (type === 'FLIGHT') {
    const km = Number.isFinite(item.distanceKm) ? Math.max(0, item.distanceKm as number) : distanceKm(item)
    const band = FLIGHT_BANDS.find((entry) => km <= entry.maxKm) || FLIGHT_BANDS[2]
    return round2(Math.max(1, km * band.kgPerKm))
  }
  if (type === 'HOTEL') {
    const start = item.startTime ? new Date(item.startTime).getTime() : NaN
    const end = item.endTime ? new Date(item.endTime).getTime() : NaN
    const nights = Number.isFinite(start) && Number.isFinite(end) && end > start ? Math.max(1, Math.ceil((end - start) / 86_400_000)) : 1
    return round2(nights * HOTEL_KG_PER_NIGHT)
  }
  if (type === 'TRANSFER') {
    const mode = Object.keys(TRANSFER_KG_PER_KM).find((keyword) => text.includes(keyword)) || 'car'
    const km = Number.isFinite(item.distanceKm) ? Math.max(1, item.distanceKm as number) : distanceKm(item)
    return round2(km * TRANSFER_KG_PER_KM[mode])
  }
  return 0
}

export function estimateTripCarbonKg(items: Array<{ type: ItemType | string; title?: string; location?: string; startTime?: Date | string; endTime?: Date | string; tags?: unknown; distanceKm?: number }>): number {
  return round2(items.reduce((sum, item) => sum + estimateItemCarbonKg(item), 0))
}
