const flightRate = (km: number) => km <= 1500 ? 0.18 : km <= 4000 ? 0.13 : 0.10
const textOf = (item: { title?: string; location?: string; tags?: unknown }) => `${item.title || ''} ${item.location || ''} ${Array.isArray(item.tags) ? item.tags.join(' ') : ''}`.toLowerCase()
const distanceKm = (item: { title?: string; location?: string; tags?: unknown }) => {
  const text = textOf(item)
  const match = text.match(/(?:distance|distancekm|km)\s*[:=]?\s*(\d+(?:\.\d+)?)/i)
  if (match) return Number(match[1])
  if (/\b(short|nearby|domestic|local)\b/.test(text)) return 800
  if (/\b(long|international|intercontinental)\b/.test(text)) return 7000
  if (/\b(medium|medium-haul|regional)\b/.test(text)) return 2500
  return 2000
}
export function estimateCarbonKg(item: { type: string; title?: string; location?: string; tags?: unknown; startTime?: string; endTime?: string; distanceKm?: number }) {
  const type = item.type.toUpperCase()
  if (type === 'FLIGHT') { const km = item.distanceKm ?? distanceKm(item); return Math.max(1, km * flightRate(km)) }
  if (type === 'HOTEL') { const start = item.startTime ? new Date(item.startTime).getTime() : NaN; const end = item.endTime ? new Date(item.endTime).getTime() : NaN; const nights = Number.isFinite(start) && Number.isFinite(end) && end > start ? Math.max(1, Math.ceil((end - start) / 86400000)) : 1; return nights * 20 }
  if (type === 'TRANSFER') { const text = textOf(item); const mode = text.includes('train') ? 'train' : text.includes('bus') ? 'bus' : text.includes('flight') ? 'flight' : 'car'; const rate = { flight: 0.18, car: 0.21, train: 0.04, bus: 0.08 }[mode]; return Math.max(1, item.distanceKm ?? distanceKm(item)) * rate }
  return 0
}
