import type { PrismaClient } from '@prisma/client'
import { notifyTripStakeholders, type PublishNotification } from './notificationService.js'

const OPEN_METEO_GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const configuredIntervalMs = Number(process.env.WEATHER_CHECK_INTERVAL_MS || 6 * 60 * 60 * 1000)
const WEATHER_CHECK_INTERVAL_MS = Number.isFinite(configuredIntervalMs) ? configuredIntervalMs : 6 * 60 * 60 * 1000
const MAX_FORECAST_DAYS = 16

type FetchLike = typeof fetch
type DailyForecast = { time: string[]; weather_code: number[]; precipitation_sum: number[]; precipitation_probability_max: number[]; wind_gusts_10m_max: number[] }

type SevereForecast = {
  date: string
  weatherCode: number
  precipitationMm: number
  precipitationProbability: number
  windGustKph: number
  reasons: string[]
}

function dateOnly(value: Date) { return value.toISOString().slice(0, 10) }
function maxDate(a: string, b: string) { return a > b ? a : b }
function minDate(a: string, b: string) { return a < b ? a : b }

function severeForecasts(daily: DailyForecast, startDate: string, endDate: string): SevereForecast[] {
  return daily.time.flatMap((date, index) => {
    if (date < startDate || date > endDate) return []
    const weatherCode = Number(daily.weather_code[index] ?? 0)
    const precipitationMm = Number(daily.precipitation_sum[index] ?? 0)
    const precipitationProbability = Number(daily.precipitation_probability_max[index] ?? 0)
    const windGustKph = Number(daily.wind_gusts_10m_max[index] ?? 0)
    const reasons: string[] = []
    // WMO 95, 96 and 99 are thunderstorms; 96/99 include hail.
    if (weatherCode >= 95) reasons.push(weatherCode >= 96 ? 'thunderstorm with hail risk' : 'thunderstorm')
    if (windGustKph >= 75) reasons.push(`wind gusts up to ${Math.round(windGustKph)} km/h`)
    if (precipitationMm >= 50) reasons.push(`${Math.round(precipitationMm)} mm precipitation`)
    if (precipitationProbability >= 90 && precipitationMm >= 25) reasons.push(`${Math.round(precipitationProbability)}% chance of heavy precipitation`)
    return reasons.length ? [{ date, weatherCode, precipitationMm, precipitationProbability, windGustKph, reasons }] : []
  })
}

async function getJson<T>(fetcher: FetchLike, url: URL): Promise<T> {
  const response = await fetcher(url, { signal: AbortSignal.timeout(12_000), headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`Open-Meteo returned ${response.status} for ${url.pathname}`)
  return response.json() as Promise<T>
}

async function forecastForDestination(destination: string, startDate: string, endDate: string, fetcher: FetchLike): Promise<SevereForecast[]> {
  const geocodingUrl = new URL(OPEN_METEO_GEOCODING_URL)
  geocodingUrl.search = new URLSearchParams({ name: destination, count: '1', language: 'en', format: 'json' }).toString()
  const geocoding = await getJson<{ results?: Array<{ latitude: number; longitude: number; name: string }> }>(fetcher, geocodingUrl)
  const place = geocoding.results?.[0]
  if (!place) throw new Error(`Open-Meteo could not geocode "${destination}"`)

  const forecastUrl = new URL(OPEN_METEO_FORECAST_URL)
  forecastUrl.search = new URLSearchParams({
    latitude: String(place.latitude), longitude: String(place.longitude), timezone: 'auto', forecast_days: String(MAX_FORECAST_DAYS),
    daily: 'weather_code,precipitation_sum,precipitation_probability_max,wind_gusts_10m_max',
  }).toString()
  const forecast = await getJson<{ daily?: DailyForecast }>(fetcher, forecastUrl)
  if (!forecast.daily) throw new Error(`Open-Meteo returned no daily forecast for "${destination}"`)
  return severeForecasts(forecast.daily, startDate, endDate)
}

export type WeatherCheckResult = { checkedTrips: number; createdDisruptions: number; skippedOutsideForecastWindow: number; errors: Array<{ tripId: string; message: string }> }

/**
 * Checks all upcoming trips against Open-Meteo's no-key forecast. The existing schema requires
 * an affected itinerary item, so an alert is attached to the first activity on the severe day
 * (or the first itinerary item when the day itself has no scheduled item).
 */
export async function runWeatherCheck(prisma: PrismaClient, publishEvent: (event: string, data: Record<string, unknown>) => void, publishNotification: PublishNotification, fetcher: FetchLike = fetch): Promise<WeatherCheckResult> {
  const today = dateOnly(new Date())
  const lastForecastDate = dateOnly(new Date(Date.now() + (MAX_FORECAST_DAYS - 1) * 86_400_000))
  const trips = await prisma.trip.findMany({
    where: { endDate: { gte: new Date(`${today}T00:00:00.000Z`) }, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
    include: { items: { orderBy: { startTime: 'asc' } } },
  })
  const result: WeatherCheckResult = { checkedTrips: 0, createdDisruptions: 0, skippedOutsideForecastWindow: 0, errors: [] }
  for (const trip of trips) {
    const tripStart = maxDate(today, dateOnly(trip.startDate)); const tripEnd = dateOnly(trip.endDate)
    if (tripStart > lastForecastDate) { result.skippedOutsideForecastWindow++; continue }
    result.checkedTrips++
    try {
      const severeDays = await forecastForDestination(trip.destination, tripStart, minDate(tripEnd, lastForecastDate), fetcher)
      for (const severe of severeDays) {
        const marker = `[weather:${severe.date}]`
        const affectedItem = trip.items.find((item) => item.type === 'ACTIVITY' && dateOnly(item.startTime) === severe.date)
          ?? trip.items.find((item) => dateOnly(item.startTime) <= severe.date && dateOnly(item.endTime) >= severe.date)
          ?? trip.items[0]
        if (!affectedItem) { result.errors.push({ tripId: trip.id, message: 'Trip has no itinerary item to attach a weather disruption to.' }); continue }
        const existing = await prisma.disruption.findFirst({ where: { tripId: trip.id, type: 'WEATHER', details: { contains: marker }, status: { notIn: ['RESOLVED', 'REVERTED'] } } })
        if (existing) continue
        const details = `${marker} Open-Meteo forecasts ${severe.reasons.join(', ')} in ${trip.destination} on ${severe.date}.`
        const disruption = await prisma.disruption.create({ data: { tripId: trip.id, affectedItemId: affectedItem.id, type: 'WEATHER', severity: severe.weatherCode >= 96 || severe.windGustKph >= 100 || severe.precipitationMm >= 80 ? 'HIGH' : 'MEDIUM', status: 'OPEN', details } })
        await prisma.activityLog.create({ data: { userId: trip.userId, action: 'WEATHER_DISRUPTION_AUTO_CREATED', metadata: { tripId: trip.id, disruptionId: disruption.id, date: severe.date, destination: trip.destination } } })
        await notifyTripStakeholders(prisma, publishNotification, { tripId: trip.id, type: 'DISRUPTION', title: 'Severe weather alert', message: `Open-Meteo forecasts ${severe.reasons.join(', ')} in ${trip.destination} on ${severe.date}.` })
        publishEvent('disruption-created', { tripId: trip.id, disruptionId: disruption.id, source: 'open-meteo' })
        result.createdDisruptions++
      }
    } catch (error) { result.errors.push({ tripId: trip.id, message: error instanceof Error ? error.message : 'Unknown weather-check error' }) }
  }
  return result
}

export function startWeatherCheckJob(prisma: PrismaClient, publishEvent: (event: string, data: Record<string, unknown>) => void, publishNotification: PublishNotification) {
  const execute = () => runWeatherCheck(prisma, publishEvent, publishNotification).then((result) => console.info('Weather check complete', result)).catch((error) => console.error('Weather check failed', error))
  execute()
  const interval = setInterval(execute, Math.max(WEATHER_CHECK_INTERVAL_MS, 5 * 60 * 1000))
  interval.unref()
  return () => clearInterval(interval)
}
