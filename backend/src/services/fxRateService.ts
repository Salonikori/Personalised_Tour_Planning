import type { PrismaClient } from '@prisma/client'

const FRANKFURTER_RATE_URL = 'https://api.frankfurter.dev/v2/rate'
const codePattern = /^[A-Z]{3}$/

function utcDay() { const now = new Date(); return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) }

/** Gets a no-key Frankfurter rate, memoized in SQLite for the current UTC day. */
export async function getDailyFxRate(prisma: PrismaClient, from: string, to: string) {
  const baseCurrency = from.toUpperCase(); const quoteCurrency = to.toUpperCase()
  if (!codePattern.test(baseCurrency) || !codePattern.test(quoteCurrency)) throw new Error('Invalid ISO currency code.')
  if (baseCurrency === quoteCurrency) return { rate: 1, asOf: utcDay(), cached: true }
  const asOf = utcDay()
  const cached = await prisma.fxRate.findUnique({ where: { baseCurrency_quoteCurrency_asOf: { baseCurrency, quoteCurrency, asOf } } })
  if (cached) return { rate: cached.rate, asOf: cached.asOf, cached: true }
  const response = await fetch(`${FRANKFURTER_RATE_URL}/${baseCurrency}/${quoteCurrency}`, { signal: AbortSignal.timeout(10_000), headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`FX provider returned ${response.status}.`)
  const data = await response.json() as { rate?: number; date?: string }
  if (!Number.isFinite(data.rate) || !data.rate || data.rate <= 0) throw new Error('FX provider returned an invalid rate.')
  const stored = await prisma.fxRate.upsert({ where: { baseCurrency_quoteCurrency_asOf: { baseCurrency, quoteCurrency, asOf } }, create: { baseCurrency, quoteCurrency, rate: data.rate, asOf }, update: { rate: data.rate, fetchedAt: new Date() } })
  return { rate: stored.rate, asOf: stored.asOf, cached: false }
}

export function currencyFromTags(tags: unknown, fallback = 'INR') {
  const tagged = Array.isArray(tags) ? tags.find((tag): tag is string => typeof tag === 'string' && tag.toLowerCase().startsWith('currency:')) : undefined
  const currency = tagged?.slice('currency:'.length).toUpperCase() || fallback
  return codePattern.test(currency) ? currency : fallback
}
