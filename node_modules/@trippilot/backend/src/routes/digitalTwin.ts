// Weather-driven Digital Twin API surface. Additive only - mounted alongside every existing
// route in server.ts. Read-only: nothing here writes to trips, bookings or inventory. See
// src/services/digitalTwinService.ts for the simulation engine and demo-data fallbacks.
import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import {
  fetchLiveWeather,
  fetchSocialSignals,
  getCity,
  listCities,
  simulateDigitalTwin,
  type ScenarioInput,
} from '../services/digitalTwinService.js'

export const digitalTwinRouter = Router()

const asyncRoute = (handler: (request: Request, response: Response) => Promise<unknown>) =>
  (request: Request, response: Response, next: NextFunction) => handler(request, response).catch(next)

// GET /api/digital-twin/cities - supported showcase cities for the map/city picker.
digitalTwinRouter.get('/cities', requireAuth, asyncRoute(async (_request, response) => {
  return response.json({ cities: listCities() })
}))

const scenarioQuerySchema = z.object({
  city: z.string().min(2).default('goa'),
  rain: z.coerce.number().min(0).max(100).optional(),
  temperature: z.coerce.number().min(-20).max(55).optional(),
  stormHours: z.coerce.number().min(0).max(72).optional(),
  flood: z.coerce.number().min(0).max(100).optional(),
})

// GET /api/digital-twin/state - live weather + entities + social signals + a what-if simulation.
// Every query param is optional: with none supplied the scenario defaults to the live/fallback
// weather reading itself, so the twin always renders a sensible "current conditions" view; moving
// any slider on the frontend re-requests this endpoint with new values for an instant what-if.
digitalTwinRouter.get('/state', requireAuth, asyncRoute(async (request, response) => {
  const query = scenarioQuerySchema.parse(request.query)
  const city = getCity(query.city)
  if (!city) return response.status(404).json({ error: `Unknown city "${query.city}". Supported: goa, delhi, paris.` })

  const [weather, social] = await Promise.all([fetchLiveWeather(city), fetchSocialSignals(city)])

  const scenario: ScenarioInput = {
    rainIntensity: query.rain ?? weather.precipitationProbability,
    temperatureC: query.temperature ?? weather.temperatureC,
    stormDurationHours: query.stormHours ?? (weather.precipitationProbability > 60 ? 12 : 3),
    floodLevel: query.flood ?? Math.round(Math.max(0, weather.precipitationMm - 20) * 1.5),
  }
  const simulation = simulateDigitalTwin(city, weather, scenario)

  return response.json({
    city: { id: city.id, name: city.name, country: city.country, latitude: city.latitude, longitude: city.longitude },
    entities: city.entities,
    weather,
    social,
    simulation,
  })
}))

// POST /api/digital-twin/simulate - explicit what-if run with a fully caller-specified scenario,
// used by the interactive sliders so a scenario can be re-run without re-fetching live weather.
const simulateBodySchema = z.object({
  city: z.string().min(2),
  rainIntensity: z.number().min(0).max(100),
  temperatureC: z.number().min(-20).max(55),
  stormDurationHours: z.number().min(0).max(72),
  floodLevel: z.number().min(0).max(100),
})

digitalTwinRouter.post('/simulate', requireAuth, asyncRoute(async (request, response) => {
  const body = simulateBodySchema.parse(request.body)
  const city = getCity(body.city)
  if (!city) return response.status(404).json({ error: `Unknown city "${body.city}". Supported: goa, delhi, paris.` })
  const weather = await fetchLiveWeather(city)
  const simulation = simulateDigitalTwin(city, weather, {
    rainIntensity: body.rainIntensity, temperatureC: body.temperatureC, stormDurationHours: body.stormDurationHours, floodLevel: body.floodLevel,
  })
  return response.json({ city: { id: city.id, name: city.name, country: city.country, latitude: city.latitude, longitude: city.longitude }, entities: city.entities, weather, simulation })
}))
