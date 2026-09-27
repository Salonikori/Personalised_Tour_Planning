import 'dotenv/config'
import bcrypt from 'bcryptjs'
import cors from 'cors'
import express, { type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { BookingStatus, GroupParticipantStatus, ItemStatus, ItemType, PaymentStatus, Prisma, Role } from '@prisma/client'
import { toReactFlowGraph } from './lib/dependencyGraph.js'
import { prisma } from './lib/prisma.js'
import { publicUser } from './lib/serializers.js'
import { allowRoles, issueToken, requireAuth, verifyToken } from './middleware/auth.js'
import { classifyCopilotIntent, generateRecoveryNarratives, generateWithGroq } from './services/generationService.js'
import { learnFromReview, preferenceMatch, type PreferenceProfile } from './services/preferenceService.js'
import { analyzeImpact, buildProposals, decisionModeValues, resolveReplacementStatus } from './services/recoveryService.js'
import { getAvailableAlternatives, getBudgetSummary, getItinerarySummary, localizeCopilotMessage, simulateBudgetChange, triggerDisruptionAnalysis, type CopilotContext } from './services/copilotService.js'
import { getDestinationInventory, DestinationDiscoveryUnavailableError } from './services/destinationService.js'
import { discoverDestination } from './services/travelDiscoveryEngineService.js'
import { syncDiscoveryInventory } from './services/discoveryInventoryService.js'
import { travelRouter } from './routes/travel.js'
import { digitalTwinRouter } from './routes/digitalTwin.js'
import { getActivePaymentProvider, verifyRazorpaySignature } from './services/providers/paymentProvider.js'
import { startWeatherCheckJob } from './services/weatherCheckService.js'
import { notifyTripStakeholders, notifySosStakeholders, notifyUsers, type NotificationPayload } from './services/notificationService.js'
import { resolveTripHelp } from './services/nearbyHelpService.js'
import { currencyFromTags, getDailyFxRate } from './services/fxRateService.js'
import { allocateBudget, categorizeItem, normalizeWeights, CATEGORIES, type CategoryWeights } from './services/budgetAllocatorService.js'
import { estimateTripCarbonKg } from './services/carbonService.js'
import { generateChecklist, type ChecklistWeatherSignal } from './services/checklistService.js'
import { pointsForReferral, pointsForTripCompletion } from './services/loyaltyService.js'
import { getTemplateById, ITINERARY_TEMPLATES } from './services/itineraryTemplateService.js'
import { assessWeatherRisks } from './services/nugenWeatherService.js'
import { decideSafetyZone } from './services/safetyIntelligenceService.js'

const app = express()
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173' }))
app.use(express.json())
// Destination-aware live discovery API (spec: orchestration + live providers). Additive only -
// every route below this line already existed and is untouched.
app.use('/api/travel', travelRouter)
// Weather-driven Digital Twin (hospitality & travel ecosystem simulation layer). Additive only.
app.use('/api/digital-twin', digitalTwinRouter)
const eventClients = new Map<Response, string>()
const publishEvent = (event: string, data: Record<string, unknown>) => { const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; eventClients.forEach((_userId, client) => client.write(payload)) }
const publishNotification = (userId: string, notification: NotificationPayload) => { const payload = `event: notification\ndata: ${JSON.stringify(notification)}\n\n`; eventClients.forEach((clientUserId, client) => { if (clientUserId === userId) client.write(payload) }) }
const notifyTrip = (tripId: string, type: string, title: string, message: string) => notifyTripStakeholders(prisma, publishNotification, { tripId, type, title, message })
const asyncRoute = (handler: (request: Request, response: Response) => Promise<unknown>) => (request: Request, response: Response, next: NextFunction) => { handler(request, response).catch(next) }
const roleSchema = z.enum(['TRAVELER', 'OPERATOR', 'VENDOR', 'COORDINATOR', 'ADMIN'])
const authSchema = z.object({ email: z.string().email(), password: z.string().min(8), role: roleSchema, currentLocation: z.string().trim().min(1).max(200).optional() })
const registerSchema = authSchema.extend({ name: z.string().min(2), phone: z.string().min(6).optional(), referredBy: z.string().trim().min(1).max(64).optional() })

app.get('/api/health', (_request, response) => response.json({ status: 'ok' }))
// Read-only weather digital twin: live Open-Meteo conditions + a traveler-controlled counterfactual.
app.get('/api/trips/:id/weather-twin', requireAuth, asyncRoute(async (request, response) => {
  const trip = await findAccessibleTrip(request.params.id as string, request, response); if (!trip) return
  const [items, geocoding] = await Promise.all([
    prisma.itineraryItem.findMany({ where: { tripId: trip.id, status: { not: ItemStatus.CANCELLED } }, orderBy: { startTime: 'asc' } }),
    fetch(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: trip.destination, count: '1', language: 'en', format: 'json' })}`, { signal: AbortSignal.timeout(12000) }).then(r => { if (!r.ok) throw new Error('Weather geocoding unavailable'); return r.json() as Promise<{ results?: Array<{ latitude: number; longitude: number; name: string }> }> }),
  ])
  const place = geocoding.results?.[0]; if (!place) return response.status(502).json({ error: 'Could not locate this destination for weather.' })
  const url = new URL('https://api.open-meteo.com/v1/forecast'); url.search = new URLSearchParams({ latitude: String(place.latitude), longitude: String(place.longitude), timezone: 'auto', forecast_days: '7', current: 'temperature_2m,precipitation,weather_code,wind_speed_10m', daily: 'temperature_2m_max,precipitation_sum,precipitation_probability_max,weather_code' }).toString()
  const weather = await fetch(url, { signal: AbortSignal.timeout(12000) }).then(r => { if (!r.ok) throw new Error('Live forecast unavailable'); return r.json() as Promise<{ current?: Record<string, number|string>; daily?: { time: string[]; temperature_2m_max: number[]; precipitation_sum: number[]; precipitation_probability_max: number[]; weather_code: number[] } }> })
  const intensity = Math.max(0, Math.min(100, Number(request.query.rain ?? weather.daily?.precipitation_probability_max?.[0] ?? 0)))
  const temperature = Math.max(-20, Math.min(55, Number(request.query.temperature ?? weather.current?.temperature_2m ?? 25)))
  const intensityFactor = intensity / 100
  let impacts = items.map(item => {
    const outdoor = item.type === ItemType.ACTIVITY
    const exposure = outdoor ? 1 : item.type === ItemType.TRANSFER || item.type === ItemType.FLIGHT ? .55 : .2
    const risk = Math.min(.96, (intensityFactor * .72 + Math.max(0, temperature - 32) / 40) * exposure)
    return { id: item.id, title: item.title, type: item.type, location: item.location, startTime: item.startTime, exposure: Math.round(exposure * 100), risk: Math.round(risk * 100), expectedDelayMinutes: Math.round(risk * (outdoor ? 75 : 35)), status: risk >= .55 ? 'high' : risk >= .25 ? 'moderate' : 'low' }
  })
  let modelInference: { provider: 'nugen-aligned' | 'local-estimate'; model: string | null; confidenceScore: number | null; error?: string } = { provider: 'local-estimate', model: null, confidenceScore: null }
  try {
    const assessment = await assessWeatherRisks({ destination: trip.destination, rainProbability: intensity, temperatureC: temperature, items: impacts })
    if (assessment) {
      const byId = new Map(assessment.impacts.map(item => [item.id, item]))
      impacts = impacts.map(item => { const aligned = byId.get(item.id)!; const risk = aligned.risk / 100; return { ...item, risk: aligned.risk, expectedDelayMinutes: aligned.expectedDelayMinutes, status: risk >= .55 ? 'high' : risk >= .25 ? 'moderate' : 'low', rationale: aligned.rationale } })
      modelInference = { provider: 'nugen-aligned', model: assessment.model, confidenceScore: assessment.confidenceScore }
    }
  } catch (error) { modelInference.error = error instanceof Error ? error.message : 'Nugen inference failed' }
  const [social, news] = await Promise.all([
    fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?${new URLSearchParams({ q: `${trip.destination} (weather OR rain OR storm OR heat OR flood)`, limit: '5' })}`, { signal: AbortSignal.timeout(8000) }).then(r => r.ok ? r.json() as Promise<{ posts?: Array<{ uri: string; author: { handle: string }; record: { text?: string }; indexedAt: string }> }> : { posts: [] }).catch(() => ({ posts: [] as Array<{ uri: string; author: { handle: string }; record: { text?: string }; indexedAt: string }> })),
    fetch(`https://api.gdeltproject.org/api/v2/doc/doc?${new URLSearchParams({ query: `${trip.destination} (weather OR rain OR storm OR heat OR flood)`, mode: 'ArtList', format: 'json', maxrecords: '5', sort: 'DateDesc' })}`, { signal: AbortSignal.timeout(8000) }).then(r => r.ok ? r.json() as Promise<{ articles?: Array<{ title: string; url: string; domain: string; seendate: string }> }> : { articles: [] }).catch(() => ({ articles: [] as Array<{ title: string; url: string; domain: string; seendate: string }> })),
  ])
  const socialSignals = [
    ...(social.posts ?? []).map(post => ({ title: post.record.text ?? 'Public Bluesky post', url: `https://bsky.app/profile/${post.author.handle}/post/${post.uri.split('/').pop()}`, source: `Bluesky · @${post.author.handle}`, date: post.indexedAt })),
    ...(news.articles ?? []).map(article => ({ title: article.title, url: article.url, source: article.domain, date: article.seendate })),
  ]
  return response.json({ destination: place.name, location: { latitude: place.latitude, longitude: place.longitude }, current: weather.current, forecast: weather.daily, modelInference, scenario: { rainProbability: intensity, temperatureC: temperature, expectedAffectedItems: impacts.filter(i => i.risk >= 25).length, meanDisruptionProbability: impacts.length ? Math.round(impacts.reduce((sum, i) => sum + i.risk, 0) / impacts.length) : 0, impacts }, socialSignals })
}))
app.get('/api/events', (request, response) => {
  const token = typeof request.query.token === 'string' ? request.query.token : ''
  let auth: { sub: string }
  try { auth = verifyToken(token) } catch { return response.status(401).end() }
  response.setHeader('Content-Type', 'text/event-stream'); response.setHeader('Cache-Control', 'no-cache'); response.setHeader('Connection', 'keep-alive'); response.flushHeaders(); response.write('event: connected\ndata: {}\n\n'); eventClients.set(response, auth.sub); request.on('close', () => eventClients.delete(response))
})

// Operator resource center: read views and maintenance actions backed by the same trip,
// vendor and inventory records used by itinerary generation and recovery planning.
app.get('/api/operator/customers', requireAuth, allowRoles(Role.OPERATOR), asyncRoute(async (_request, response) => {
  const customers = await prisma.user.findMany({ where: { role: Role.TRAVELER }, orderBy: { createdAt: 'desc' }, include: { trips: { orderBy: { startDate: 'desc' }, include: { items: { include: { booking: true } } } } } })
  return response.json({ customers: customers.map(({ passwordHash: _passwordHash, ...customer }) => ({ ...customer, trips: customer.trips.map((trip) => ({ id: trip.id, destination: trip.destination, startDate: trip.startDate, endDate: trip.endDate, status: trip.status, budget: trip.budget, bookedItems: trip.items.filter((item) => item.booking?.confirmationStatus === BookingStatus.CONFIRMED).length })) })) })
}))
app.get('/api/operator/coordinators', requireAuth, allowRoles(Role.OPERATOR), asyncRoute(async (_request, response) => {
  const coordinators = await prisma.user.findMany({ where: { role: Role.COORDINATOR }, orderBy: { name: 'asc' }, select: { id: true, name: true, email: true, phone: true, supportPhone: true, coordinatedTrips: { select: { id: true } }, coordinatedTourGroups: { select: { id: true } } } })
  return response.json({ coordinators: coordinators.map(({ coordinatedTrips, coordinatedTourGroups, ...user }) => ({ ...user, assignedTours: coordinatedTrips.length + coordinatedTourGroups.length })) })
}))
app.get('/api/operator/inventory', requireAuth, allowRoles(Role.OPERATOR), asyncRoute(async (_request, response) => {
  const inventory = await prisma.inventoryItem.findMany({ include: { vendor: { select: { id: true, name: true, category: true } } }, orderBy: [{ type: 'asc' }, { title: 'asc' }] })
  return response.json({ inventory })
}))
app.post('/api/operator/inventory', requireAuth, allowRoles(Role.OPERATOR), asyncRoute(async (request, response) => {
  const data = z.object({ vendorId: z.string().min(1), type: z.nativeEnum(ItemType), title: z.string().trim().min(2), location: z.string().trim().min(2), price: z.number().nonnegative(), availability: z.string().trim().min(2), tags: z.array(z.string().trim().min(1)).max(30).default([]), details: z.record(z.string(), z.unknown()).nullable().optional() }).parse(request.body)
  if (!(await prisma.vendor.findUnique({ where: { id: data.vendorId }, select: { id: true } }))) return response.status(422).json({ error: 'Choose an existing vendor before adding inventory.' })
  const inventory = await prisma.inventoryItem.create({ data: { ...data, source: 'operator', bookable: data.availability.toLowerCase() !== 'unavailable' }, include: { vendor: { select: { id: true, name: true, category: true } } } })
  await prisma.activityLog.create({ data: { userId: request.auth!.sub, action: 'INVENTORY_CREATED', metadata: { inventoryId: inventory.id, vendorId: inventory.vendorId, type: inventory.type } } })
  return response.status(201).json({ inventory })
}))
app.patch('/api/operator/inventory/:id', requireAuth, allowRoles(Role.OPERATOR), asyncRoute(async (request, response) => {
  const data = z.object({ title: z.string().trim().min(2).optional(), location: z.string().trim().min(2).optional(), price: z.number().nonnegative().optional(), availability: z.string().trim().min(2).optional(), tags: z.array(z.string().trim().min(1)).max(30).optional(), details: z.record(z.string(), z.unknown()).nullable().optional() }).parse(request.body)
  const inventory = await prisma.inventoryItem.update({ where: { id: request.params.id as string }, data: { ...data, ...(data.availability !== undefined ? { bookable: data.availability.toLowerCase() !== 'unavailable' } : {}) }, include: { vendor: { select: { id: true, name: true, category: true } } } })
  await prisma.activityLog.create({ data: { userId: request.auth!.sub, action: 'INVENTORY_UPDATED', metadata: { inventoryId: inventory.id, availability: inventory.availability, price: inventory.price } } })
  return response.json({ inventory })
}))
app.delete('/api/operator/inventory/:id', requireAuth, allowRoles(Role.OPERATOR), asyncRoute(async (request, response) => {
  const current = await prisma.inventoryItem.findUnique({ where: { id: request.params.id as string }, include: { _count: { select: { itineraryItems: true } } } })
  if (!current) return response.status(404).json({ error: 'Inventory item not found.' })
  if (current._count.itineraryItems > 0) return response.status(409).json({ error: 'This service is attached to a trip. Mark it unavailable to keep the trip record intact.' })
  await prisma.inventoryItem.delete({ where: { id: current.id } })
  await prisma.activityLog.create({ data: { userId: request.auth!.sub, action: 'INVENTORY_DELETED', metadata: { inventoryId: current.id, title: current.title } } })
  return response.json({ ok: true })
}))
app.get('/api/operator/schedule', requireAuth, allowRoles(Role.OPERATOR), asyncRoute(async (_request, response) => {
  const schedule = await prisma.itineraryItem.findMany({ where: { status: { not: ItemStatus.CANCELLED } }, include: { trip: { include: { user: { select: { id: true, name: true, email: true } } } }, vendor: { select: { id: true, name: true, category: true } }, booking: true }, orderBy: { startTime: 'asc' } })
  return response.json({ schedule: schedule.map((item) => ({ id: item.id, title: item.title, type: item.type, startTime: item.startTime, endTime: item.endTime, location: item.location, status: item.status, tripId: item.tripId, destination: item.trip.destination, traveler: item.trip.user, vendor: item.vendor, bookingStatus: item.booking?.confirmationStatus ?? null })) })
}))
app.get('/api/coordinator/schedule', requireAuth, allowRoles(Role.COORDINATOR), asyncRoute(async (request, response) => {
  const schedule = await prisma.itineraryItem.findMany({ where: { status: { not: ItemStatus.CANCELLED }, trip: { coordinatorId: request.auth!.sub } }, include: { trip: { include: { user: { select: { id: true, name: true, email: true } } } }, vendor: { select: { id: true, name: true, category: true } }, booking: true }, orderBy: { startTime: 'asc' } })
  return response.json({ schedule: schedule.map((item) => ({ id: item.id, title: item.title, type: item.type, startTime: item.startTime, endTime: item.endTime, location: item.location, status: item.status, tripId: item.tripId, destination: item.trip.destination, traveler: item.trip.user, vendor: item.vendor, bookingStatus: item.booking?.confirmationStatus ?? null })) })
}))
app.patch('/api/operator/trips/:id/coordinator', requireAuth, allowRoles(Role.OPERATOR), asyncRoute(async (request, response) => {
  const { coordinatorId } = z.object({ coordinatorId: z.string().nullable() }).parse(request.body)
  if (coordinatorId) { const coordinator = await prisma.user.findUnique({ where: { id: coordinatorId }, select: { role: true } }); if (!coordinator || coordinator.role !== Role.COORDINATOR) return response.status(400).json({ error: 'Choose a registered coordinator account.' }) }
  const trip = await prisma.trip.update({ where: { id: request.params.id as string }, data: { coordinatorId }, select: { id: true, destination: true, coordinatorId: true } })
  if (coordinatorId) await notifyUsers(prisma, publishNotification, [coordinatorId], { tripId: trip.id, type: 'COORDINATOR_ASSIGNMENT', title: 'Tour assigned to you', message: `You are now coordinating the ${trip.destination} tour.` })
  await prisma.activityLog.create({ data: { userId: request.auth!.sub, action: 'COORDINATOR_ASSIGNED', metadata: { tripId: trip.id, coordinatorId } } })
  publishEvent('coordinator-assigned', { tripId: trip.id, coordinatorId })
  return response.json({ trip })
}))
app.post('/api/auth/register', asyncRoute(async (request, response) => {
  const data = registerSchema.parse(request.body)
  // Admin accounts are provisioned by seeding/an existing admin only - never through self-service signup.
  if (data.role === Role.ADMIN) return response.status(403).json({ error: 'Admin accounts cannot be created through self-registration.' })
  const existing = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } })
  if (existing) return response.status(409).json({ error: 'An account with this email already exists.' })
  const user = await prisma.user.create({ data: { name: data.name, email: data.email.toLowerCase(), passwordHash: await bcrypt.hash(data.password, 12), phone: data.phone, role: data.role, preferences: {} } })
  // referredBy is just a code lookup, not a foreign key, so a stale, mistyped, or made-up code
  // simply matches no one - it never fails registration, it just means no referral bonus lands.
  if (data.referredBy) { const referrer = await prisma.user.findUnique({ where: { referralCode: data.referredBy } }); if (referrer) await prisma.user.update({ where: { id: referrer.id }, data: { loyaltyPoints: { increment: pointsForReferral() } } }) }
  return response.status(201).json({ user: publicUser(user), token: issueToken(user.id, user.role) })
}))
app.post('/api/auth/login', asyncRoute(async (request, response) => {
  const data = authSchema.parse(request.body)
  const user = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } })
  if (!user || user.role !== data.role || !(await bcrypt.compare(data.password, user.passwordHash))) return response.status(401).json({ error: 'Invalid email, password, or role.' })
  const sessionUser = data.currentLocation ? await prisma.user.update({ where: { id: user.id }, data: { currentLocation: data.currentLocation } }) : user
  return response.json({ user: publicUser(sessionUser), token: issueToken(user.id, user.role) })
}))
app.get('/api/auth/me', requireAuth, asyncRoute(async (request, response) => {
  const user = await prisma.user.findUnique({ where: { id: request.auth!.sub } })
  return user ? response.json({ user: publicUser(user) }) : response.status(404).json({ error: 'User not found.' })
}))
app.get('/api/notifications', requireAuth, asyncRoute(async (request, response) => {
  const notifications = await prisma.notification.findMany({ where: { userId: request.auth!.sub }, orderBy: { createdAt: 'desc' }, take: 50 })
  return response.json({ notifications })
}))
app.patch('/api/notifications/:id/read', requireAuth, asyncRoute(async (request, response) => {
  const updated = await prisma.notification.updateMany({ where: { id: request.params.id as string, userId: request.auth!.sub, readAt: null }, data: { readAt: new Date() } })
  if (updated.count === 0) return response.status(404).json({ error: 'Unread notification not found.' })
  return response.json({ ok: true })
}))

const tripBaseSchema = z.object({ origin: z.string().trim().min(2).optional(), destination: z.string().trim().min(2, 'Destination is required.'), startDate: z.string().datetime(), endDate: z.string().datetime(), budget: z.number().positive(), travelerCount: z.number().int().min(1).max(100).optional(), tripType: z.string().trim().min(2).optional(), travelStyle: z.string().trim().min(2), interests: z.array(z.string().min(1).max(80)).max(20).optional(), pace: z.number().min(0).max(100).optional(), status: z.string().default('DRAFT'), requestedPlaces: z.array(z.string().min(1)).max(50).optional(), requestedActivities: z.array(z.string().min(1)).max(50).optional(), requestedActivityDays: z.record(z.string(), z.string()).optional(), companyName: z.string().trim().max(120).optional() })
const tripSchema = tripBaseSchema.superRefine((value, ctx) => { if (new Date(value.endDate) <= new Date(value.startDate)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: 'Return date must be after departure date.' }) })
const profileFrom = (value: unknown): PreferenceProfile => value && typeof value === 'object' && !Array.isArray(value) ? value as PreferenceProfile : {}
const paceLabel = (pace: number) => pace < 34 ? 'unhurried' : pace > 66 ? 'fast-paced' : 'balanced'
const itemPayload = z.object({ title: z.string().min(2).optional(), startTime: z.string().datetime().optional(), endTime: z.string().datetime().optional(), location: z.string().min(2).optional(), cost: z.number().nonnegative().optional(), status: z.nativeEnum(ItemStatus).optional(), vendorId: z.string().nullable().optional() })
// Replaces the old single-number guardrail (committed > trip.budget) with a basic constraint-based
// allocator: the budget is split across flights/hotel/activities/food by weight, committed spend is
// checked against each category's own slice, and any category that breaks its slice is flagged with
// concrete items to swap - see budgetAllocatorService.ts for the allocation/rebalancing logic itself.
async function tripSummary(tripId: string) {
  const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } })
  const items = await prisma.itineraryItem.findMany({ where: { tripId }, include: { booking: true } })
  const planned = items.reduce((sum, item) => sum + item.cost, 0)
  const committedItems = items.filter((item) => item.booking?.confirmationStatus !== BookingStatus.CANCELLED)
  const committed = committedItems.reduce((sum, item) => sum + item.cost, 0)
  const paid = items.filter((item) => item.booking?.paymentStatus === PaymentStatus.PAID).reduce((sum, item) => sum + item.cost, 0)
  const allocation = allocateBudget(trip.budget, trip.categoryWeights as Partial<CategoryWeights> | null, committedItems.map((item) => ({ id: item.id, title: item.title, cost: item.cost, category: categorizeItem(item) })))
  const carbonKg = estimateTripCarbonKg(committedItems)
  const group = await prisma.tourGroup.findFirst({ where: { tripId }, include: { participants: { where: { status: GroupParticipantStatus.CONFIRMED }, include: { user: true } } } })
  const confirmed = group?.participants || []
  const totalWeight = confirmed.reduce((sum, participant) => sum + (participant.shareWeight && participant.shareWeight > 0 ? participant.shareWeight : 1), 0)
  const participantShares = totalWeight > 0 ? confirmed.map((participant) => ({ id: participant.id, userId: participant.userId, name: participant.user.name, email: participant.user.email, shareWeight: participant.shareWeight && participant.shareWeight > 0 ? participant.shareWeight : 1, amount: Number((committed * (participant.shareWeight && participant.shareWeight > 0 ? participant.shareWeight : 1) / totalWeight).toFixed(2)) })) : []
  const costPerParticipant = confirmed.length ? Number((committed / confirmed.length).toFixed(2)) : null
  return { planned, committed, paid, remaining: trip.budget - committed, budget: trip.budget, budgetOverflow: !allocation.fullyRebalanced, allocation, carbonKg, costPerParticipant, participantShares }
}
// Ownership rule shared by every trip-scoped route: a TRAVELER only owns their own trips, a
// COORDINATOR only owns trips explicitly assigned to them via Trip.coordinatorId, and every other
// role (OPERATOR, VENDOR) keeps its existing unrestricted access.
function isTripOwner(auth: { sub: string; role: Role }, trip: { userId: string; coordinatorId: string | null }) {
  if (auth.role === Role.TRAVELER) return trip.userId === auth.sub
  if (auth.role === Role.COORDINATOR) return trip.coordinatorId === auth.sub
  return true
}
// Shared ownership guard matching the check already used by GET/PATCH /api/trips/:id, so every other
// trip-scoped read (itinerary, dependency graph, wallet) enforces the same access rule instead of being
// openly readable by any authenticated account that knows/guesses the trip id.
async function findAccessibleTrip(tripId: string, request: Request, response: Response) {
  const trip = await prisma.trip.findUnique({ where: { id: tripId } })
  if (!trip) { response.status(404).json({ error: 'Trip not found.' }); return null }
  if (!isTripOwner(request.auth!, trip)) { response.status(403).json({ error: 'Trip access denied.' }); return null }
  return trip
}
async function validateItineraryChange(tripId: string, candidateId: string | undefined, startTime: Date, endTime: Date, type?: ItemType) {
  const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } })
  if (startTime >= endTime) throw new Error('End time must be after start time.')
  if (startTime < trip.startDate || endTime > trip.endDate) throw new Error('This activity falls outside the trip dates.')
  const items = await prisma.itineraryItem.findMany({ where: { tripId, ...(candidateId ? { id: { not: candidateId } } : {}) } })
  if (items.some((item) => startTime < item.endTime && endTime > item.startTime)) throw new Error('This time overlaps another itinerary item.')
  if (type === ItemType.HOTEL && items.some((item) => item.type === ItemType.HOTEL && startTime < item.endTime && endTime > item.startTime)) throw new Error('This hotel check-in conflicts with an existing stay.')
}
// Builds meaningful dependency edges instead of a flat chronological chain: consecutive ACTIVITY items sharing
// the same preceding "hub" (the nearest earlier FLIGHT/HOTEL/TRANSFER anchor, e.g. a hotel check-in) become
// parallel siblings that each depend on that hub rather than on each other, so disrupting one activity does not
// falsely cascade to unrelated activities from the same stay. The journey's main path still flows forward
// chronologically through every non-activity leg and through the last activity in each group.
async function rebuildDependencies(tripId: string, client: Prisma.TransactionClient | typeof prisma = prisma) {
  const items = await client.itineraryItem.findMany({ where: { tripId }, orderBy: { startTime: 'asc' } })
  await client.itineraryDependency.deleteMany({ where: { predecessor: { tripId } } })
  const edges: Array<{ predecessorId: string; dependentId: string }> = []
  for (let index = 1; index < items.length; index += 1) {
    const current = items[index]
    const previous = items[index - 1]
    let predecessor = previous
    if (current.type === ItemType.ACTIVITY && previous.type === ItemType.ACTIVITY) {
      for (let hubIndex = index - 1; hubIndex >= 0; hubIndex -= 1) {
        if (items[hubIndex].type !== ItemType.ACTIVITY) { predecessor = items[hubIndex]; break }
      }
    }
    edges.push({ predecessorId: predecessor.id, dependentId: current.id })
  }
  if (edges.length) await client.itineraryDependency.createMany({ data: edges })
  return items
}
type SimulationInput = { budgetDelta?: number; durationDays?: number; hotelTier?: 'cheaper' | 'standard' | 'premium'; activityReplacement?: { itineraryItemId: string; inventoryItemId: string } }
async function makeSimulation(trip: { id: string; budget: number; startDate: Date; endDate: Date; travelStyle: string; user: { preferences: unknown } }, items: Awaited<ReturnType<typeof prisma.itineraryItem.findMany>>, inventory: Awaited<ReturnType<typeof prisma.inventoryItem.findMany>>, input: SimulationInput) {
  const budget = Math.max(1, trip.budget + (input.budgetDelta || 0)); const simulated = items.map((item) => ({ itineraryItemId: item.id, inventoryItemId: item.inventoryItemId, type: item.type, title: item.title, startTime: item.startTime.toISOString(), endTime: item.endTime.toISOString(), location: item.location, cost: item.cost, vendorId: item.vendorId }))
  const replacement = (targetIndex: number, candidate: typeof inventory[number]) => { const target = simulated[targetIndex]; if (!target) return; target.inventoryItemId = candidate.id; target.type = candidate.type; target.title = candidate.title; target.location = candidate.location; target.cost = candidate.price; target.vendorId = candidate.vendorId }
  if (input.activityReplacement) { const targetIndex = simulated.findIndex((item) => item.itineraryItemId === input.activityReplacement!.itineraryItemId); const candidate = inventory.find((item) => item.id === input.activityReplacement!.inventoryItemId); if (targetIndex < 0 || !candidate || candidate.type !== simulated[targetIndex].type) throw new Error('The requested replacement is not compatible with this itinerary item.'); replacement(targetIndex, candidate) }
  if (input.hotelTier) { const targetIndex = simulated.findIndex((item) => item.type === ItemType.HOTEL); const target = simulated[targetIndex]; const candidates = inventory.filter((item) => item.type === ItemType.HOTEL && item.id !== target?.inventoryItemId).sort((a, b) => input.hotelTier === 'cheaper' ? a.price - b.price : input.hotelTier === 'premium' ? b.price - a.price : Math.abs(a.price - (target?.cost || 0)) - Math.abs(b.price - (target?.cost || 0))); if (targetIndex >= 0 && candidates[0]) replacement(targetIndex, candidates[0]) }
  if (input.budgetDelta) { const targetIndex = input.budgetDelta > 0 ? simulated.findIndex((item) => item.type === ItemType.ACTIVITY) : simulated.map((item, index) => ({ item, index })).filter(({ item }) => item.type === ItemType.ACTIVITY).sort((a, b) => b.item.cost - a.item.cost)[0]?.index; const target = targetIndex === undefined ? undefined : simulated[targetIndex]; const candidates = target ? inventory.filter((item) => item.type === target.type && item.id !== target.inventoryItemId && (input.budgetDelta! > 0 ? item.price > target.cost : item.price < target.cost)).sort((a, b) => input.budgetDelta! > 0 ? b.price - a.price : a.price - b.price) : []; if (targetIndex !== undefined && targetIndex >= 0 && candidates[0]) replacement(targetIndex, candidates[0]) }
  if (input.budgetDelta || input.durationDays && input.durationDays !== Math.ceil((trip.endDate.getTime() - trip.startDate.getTime()) / 86_400_000)) { const endDate = new Date(trip.startDate.getTime() + (input.durationDays || Math.ceil((trip.endDate.getTime() - trip.startDate.getTime()) / 86_400_000)) * 86_400_000); const ai = await generateWithGroq({ destination: 'simulation', startDate: trip.startDate, endDate, budget, preferences: { ...(trip.user.preferences as object), travelStyle: trip.travelStyle }, inventory: inventory.map((item) => ({ id: item.id, title: item.title, type: item.type, location: item.location, price: item.price, tags: item.tags })) }); const targetIndex = simulated.findIndex((item) => item.type === ItemType.ACTIVITY); const target = simulated[targetIndex]; const aiCandidate = target ? ai.days.flatMap((day) => day.items).map((item) => inventory.find((candidate) => candidate.id === item.itineraryItemId)).find((candidate) => candidate && candidate.type === target.type && candidate.id !== target.inventoryItemId) : undefined; if (targetIndex >= 0 && aiCandidate) replacement(targetIndex, aiCandidate) }
  const currentCost = items.reduce((sum, item) => sum + item.cost, 0); const simulatedCost = simulated.reduce((sum, item) => sum + item.cost, 0); const currentCarbonKg = estimateTripCarbonKg(items); const simulatedCarbonKg = estimateTripCarbonKg(simulated); const carbonDeltaKg = simulatedCarbonKg - currentCarbonKg; const profile = { ...((trip.user.preferences || {}) as PreferenceProfile), travelStyle: trip.travelStyle }; const currentScore = preferenceMatch(profile, items.map((item) => ({ id: item.id, tags: inventory.find((candidate) => candidate.id === item.inventoryItemId)?.tags || [] }))); const simulatedScore = preferenceMatch(profile, simulated.map((item) => ({ id: item.itineraryItemId, tags: inventory.find((candidate) => candidate.id === item.inventoryItemId)?.tags || [] }))); return { currentItinerary: items.map((item) => ({ id: item.id, title: item.title, type: item.type, cost: item.cost, startTime: item.startTime.toISOString(), endTime: item.endTime.toISOString(), location: item.location })), simulatedItinerary: simulated, currentCost, simulatedCost, costDelta: simulatedCost - currentCost, currentCarbonKg, simulatedCarbonKg, carbonDeltaKg, timeDelta: input.durationDays ? (input.durationDays - Math.ceil((trip.endDate.getTime() - trip.startDate.getTime()) / 86_400_000)) * 1440 : 0, preferenceScoreDelta: simulatedScore - currentScore, budgetImpact: { currentBudget: trip.budget, simulatedBudget: budget, remaining: budget - simulatedCost, overflow: simulatedCost > budget }, changes: simulated.filter((item, index) => item.inventoryItemId !== items[index].inventoryItemId || item.startTime !== items[index].startTime.toISOString()) }
}
app.post('/api/trips', requireAuth, allowRoles(Role.TRAVELER), asyncRoute(async (request, response) => {
  const data = tripSchema.parse(request.body)
  const { interests, pace, ...tripData } = data
  const user = await prisma.user.findUniqueOrThrow({ where: { id: request.auth!.sub }, select: { preferences: true } })
  const preferences: PreferenceProfile = {
    ...profileFrom(user.preferences),
    travelStyle: tripData.travelStyle,
    ...(interests === undefined ? {} : { interests }),
    ...(pace === undefined ? {} : { pace, travelPace: paceLabel(pace) }),
    ...(interests === undefined && pace === undefined ? {} : { onboardingComplete: true }),
  }
  const [trip] = await prisma.$transaction([
    prisma.trip.create({ data: { ...tripData, startDate: new Date(tripData.startDate), endDate: new Date(tripData.endDate), userId: request.auth!.sub, travelerCount: data.travelerCount ?? 1, tripType: data.tripType ?? 'leisure', requestedPlaces: data.requestedPlaces ?? [], requestedActivities: data.requestedActivities ?? [], requestedActivityDays: data.requestedActivityDays ?? {}, companyName: data.companyName ?? null, approvalStatus: 'NOT_SUBMITTED' } }),
    prisma.user.update({ where: { id: request.auth!.sub }, data: { preferences } }),
  ])
  return response.status(201).json({ trip })
}))
app.get('/api/trips/:id', requireAuth, asyncRoute(async (request, response) => { const trip = await prisma.trip.findUnique({ where: { id: (request.params.id as string) }, include: { user: true, tourGroups: { orderBy: { createdAt: 'asc' }, take: 1, include: { operator: true } } } }); if (!trip) return response.status(404).json({ error: 'Trip not found.' }); if (!isTripOwner(request.auth!, trip)) return response.status(403).json({ error: 'Trip access denied.' }); const { tourGroups, ...tripFields } = trip; const operatorAccount = tourGroups[0]?.operator; const operator = operatorAccount ? { id: operatorAccount.id, name: operatorAccount.name, supportPhone: operatorAccount.supportPhone } : null; return response.json({ trip: { ...tripFields, operator } }) }))
app.patch('/api/trips/:id', requireAuth, asyncRoute(async (request, response) => { const data = tripBaseSchema.partial().parse(request.body); const existing = await prisma.trip.findUnique({ where: { id: (request.params.id as string) } }); if (!existing) return response.status(404).json({ error: 'Trip not found.' }); if (!isTripOwner(request.auth!, existing)) return response.status(403).json({ error: 'Trip access denied.' }); const trip = await prisma.trip.update({ where: { id: existing.id }, data: { ...data, startDate: data.startDate ? new Date(data.startDate) : undefined, endDate: data.endDate ? new Date(data.endDate) : undefined } }); return response.json({ trip }) }))
app.patch('/api/trips/:id/coordinator', requireAuth, allowRoles(Role.OPERATOR), asyncRoute(async (request, response) => {
  const data = z.object({ coordinatorId: z.string().nullable() }).parse(request.body)
  const trip = await prisma.trip.findUnique({ where: { id: (request.params.id as string) } })
  if (!trip) return response.status(404).json({ error: 'Trip not found.' })
  if (data.coordinatorId) {
    const coordinator = await prisma.user.findUnique({ where: { id: data.coordinatorId } })
    if (!coordinator || coordinator.role !== Role.COORDINATOR) return response.status(422).json({ error: 'coordinatorId must reference a user with the COORDINATOR role.' })
  }
  const updated = await prisma.trip.update({ where: { id: trip.id }, data: { coordinatorId: data.coordinatorId } })
  return response.json({ trip: updated })
}))
app.patch('/api/trips/:id/budget-weights', requireAuth, asyncRoute(async (request, response) => {
  const data = z.object({ flights: z.number().nonnegative(), hotel: z.number().nonnegative(), activities: z.number().nonnegative(), food: z.number().nonnegative() }).refine((value) => CATEGORIES.some((category) => value[category] > 0), { message: 'At least one category needs a positive weight.' }).parse(request.body)
  const trip = await findAccessibleTrip(request.params.id as string, request, response)
  if (!trip) return
  const categoryWeights = normalizeWeights(data)
  await prisma.trip.update({ where: { id: trip.id }, data: { categoryWeights } })
  return response.json({ summary: await tripSummary(trip.id) })
}))
app.get('/api/trips', requireAuth, asyncRoute(async (request, response) => { const where = request.auth!.role === Role.TRAVELER ? { userId: request.auth!.sub } : request.auth!.role === Role.COORDINATOR ? { coordinatorId: request.auth!.sub } : {}; const trips = await prisma.trip.findMany({ where, orderBy: { updatedAt: 'desc' } }); return response.json({ trips }) }))
app.get('/api/operator/trips', requireAuth, allowRoles(Role.OPERATOR), asyncRoute(async (_request, response) => {
  const trips = await prisma.trip.findMany({ include: { user: true, items: { include: { booking: true } }, disruptions: { include: { plans: true }, orderBy: { timestamp: 'desc' } } }, orderBy: { updatedAt: 'desc' } })
  const operationalTrips = trips.map((trip) => { const openDisruptions = trip.disruptions.filter((disruption) => !['RESOLVED', 'REVERTED'].includes(disruption.status)); const proposedPlans = trip.disruptions.flatMap((disruption) => disruption.plans).filter((plan) => plan.status === 'TRAVELER_APPROVED'); const planned = trip.items.reduce((sum, item) => sum + item.cost, 0); const bookingProblems = trip.items.filter((item) => item.booking?.confirmationStatus === 'CANCELLED' || item.status === ItemStatus.CANCELLED).length; const conflicts = trip.items.some((item, index) => trip.items.some((other, otherIndex) => otherIndex > index && item.startTime < other.endTime && item.endTime > other.startTime)); const score = openDisruptions.length * 4 + proposedPlans.length * 2 + Number(planned > trip.budget) * 3 + bookingProblems * 2 + Number(conflicts) * 2; const riskLevel = score >= 6 ? 'critical' : score >= 3 ? 'high' : score >= 1 ? 'medium' : 'low'; return { id: trip.id, destination: trip.destination, traveler: { id: trip.user.id, name: trip.user.name, email: trip.user.email }, coordinatorId: trip.coordinatorId, budget: trip.budget, plannedCost: planned, riskLevel, openDisruptions: openDisruptions.length, pendingApprovals: proposedPlans.length, bookingProblems, scheduleConflicts: conflicts, updatedAt: trip.updatedAt } })
  const kpis = {
    activeTours: operationalTrips.filter((trip) => { const status = trips.find((item) => item.id === trip.id)!.status; return !['COMPLETED', 'CANCELLED'].includes(status) && status !== 'DRAFT' }).length,
    upcomingTours: trips.filter((trip) => trip.startDate > new Date() && !['CANCELLED', 'COMPLETED'].includes(trip.status)).length,
    pendingBookings: trips.reduce((sum, trip) => sum + trip.items.filter((item) => item.booking?.confirmationStatus === BookingStatus.PENDING || item.booking?.paymentStatus === PaymentStatus.PENDING).length, 0),
    toursAtRisk: operationalTrips.filter((trip) => trip.riskLevel !== 'low').length,
    issuesRequiringAction: operationalTrips.filter((trip) => trip.riskLevel !== 'low').length,
    pendingApprovals: operationalTrips.reduce((sum, trip) => sum + trip.pendingApprovals, 0),
    totalRevenue: trips.reduce((sum, trip) => sum + trip.items.filter((item) => item.booking?.paymentStatus === PaymentStatus.PAID).reduce((items, item) => items + item.cost, 0), 0),
  }
  return response.json({ trips: operationalTrips, kpis })
}))
app.get('/api/operator/disruptions', requireAuth, allowRoles(Role.OPERATOR), asyncRoute(async (_request, response) => {
  const disruptions = await prisma.disruption.findMany({ include: { trip: { include: { user: true, items: { include: { dependenciesFrom: true } } } }, affectedItem: true, plans: { orderBy: { finalScore: 'desc' } } }, orderBy: { timestamp: 'desc' }, take: 30 })
  return response.json({ disruptions: disruptions.map((disruption) => ({ id: disruption.id, type: disruption.type, severity: disruption.severity, status: disruption.status, details: disruption.details, timestamp: disruption.timestamp, trip: { id: disruption.trip.id, destination: disruption.trip.destination, traveler: disruption.trip.user.name }, affectedItem: { id: disruption.affectedItem.id, title: disruption.affectedItem.title, type: disruption.affectedItem.type }, nodes: disruption.trip.items.map((item, index) => ({ id: item.id, data: { label: item.title }, position: { x: 70 + (index % 4) * 190, y: 70 + Math.floor(index / 4) * 120 } })), edges: disruption.trip.items.flatMap((item) => item.dependenciesFrom.map((edge) => ({ id: edge.id, source: edge.predecessorId, target: edge.dependentId }))), plans: disruption.plans })) })
}))
app.get('/api/operator/analytics', requireAuth, allowRoles(Role.OPERATOR), asyncRoute(async (_request, response) => {
  const [cancelled, scoredItems, logs, disruptions] = await Promise.all([prisma.itineraryItem.findMany({ where: { status: ItemStatus.CANCELLED }, select: { type: true } }), prisma.itineraryItem.findMany({ where: { preferenceScore: { not: null }, trip: { is: { status: { in: ['COMPOSED', 'BOOKED', 'COMPLETED', 'CONFIRMED'] } } } }, select: { preferenceScore: true, trip: { select: { updatedAt: true } } } }), prisma.activityLog.findMany({ select: { action: true, createdAt: true } }), prisma.disruption.findMany({ select: { type: true } })])
  const types = [ItemType.FLIGHT, ItemType.HOTEL, ItemType.ACTIVITY, ItemType.TRANSFER]; const cancellations = types.map((type) => ({ label: type[0] + type.slice(1).toLowerCase(), value: cancelled.filter((item) => item.type === type).length }))
  const byMonth = new Map<string, number[]>(); scoredItems.forEach((item) => { const key = `${item.trip.updatedAt.getUTCFullYear()}-${String(item.trip.updatedAt.getUTCMonth() + 1).padStart(2, '0')}`; byMonth.set(key, [...(byMonth.get(key) || []), item.preferenceScore || 0]) }); const preferenceMatch = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, scores]) => ({ week, score: Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) })); if (!preferenceMatch.length) preferenceMatch.push({ week: 'Current', score: 0 })
  const patterns = [{ name: 'Edits', actions: ['ITINERARY_EDITED', 'ITINERARY_REORDERED', 'ITINERARY_REMOVED', 'ITINERARY_ADDED'] }, { name: 'Swaps', actions: ['ITINERARY_SWAPPED'] }, { name: 'Simulations', actions: ['SIMULATION_APPLIED'] }, { name: 'Recovery approvals', actions: ['RECOVERY_APPROVED'] }].map((pattern) => ({ name: pattern.name, value: logs.filter((log) => pattern.actions.includes(log.action)).length }))
  const disruptionTypes = ['DELAY', 'CANCELLATION', 'WEATHER', 'AVAILABILITY'].map((type) => ({ label: type[0] + type.slice(1).toLowerCase(), value: disruptions.filter((item) => item.type === type).length }))
  return response.json({ cancellations, preferenceMatch, patterns, disruptions: disruptionTypes, averagePreferenceMatch: scoredItems.length ? Math.round(scoredItems.reduce((sum, item) => sum + (item.preferenceScore || 0), 0) / scoredItems.length) : 0 })
}))

app.get('/api/trips/:id/itinerary', requireAuth, asyncRoute(async (request, response) => { const trip = await findAccessibleTrip(request.params.id as string, request, response); if (!trip) return; const items = await prisma.itineraryItem.findMany({ where: { tripId: trip.id }, include: { vendor: true, booking: true, dependenciesFrom: true, inventoryItem: { select: { tags: true } } }, orderBy: { startTime: 'asc' } }); return response.json({ items: items.map(({ inventoryItem, ...item }) => ({ ...item, currency: currencyFromTags(inventoryItem?.tags), nativeAmount: item.cost })) }) }))
// TODO(export): add GET /api/trips/:id/export.pdf once a PDF library is an approved backend dependency - skipped here since none is in package.json and no new package should be added for this change. The .ics export (frontend/src/lib/ics.ts) covers the client-side itinerary export in the meantime.
app.get('/api/trips/:id/complete', requireAuth, asyncRoute(async (request, response) => {
  const trip = await prisma.trip.findUnique({ where: { id: (request.params.id as string) }, include: { user: true, items: { include: { vendor: true }, orderBy: { startTime: 'asc' } }, reviews: { include: { vendor: true } } } }); if (!trip) return response.status(404).json({ error: 'Trip not found.' }); if (!isTripOwner(request.auth!, trip)) return response.status(403).json({ error: 'Trip access denied.' })
  const spend = Object.entries(trip.items.reduce<Record<string, number>>((all, item) => { const label = item.type[0] + item.type.slice(1).toLowerCase(); all[label] = (all[label] || 0) + item.cost; return all }, {})).map(([name, value]) => ({ name, value }))
  const vendors = [...new Map(trip.items.filter((item) => item.vendor).map((item) => [item.vendorId!, { id: item.vendorId!, name: item.vendor!.name }])).values()]
  return response.json({ trip: { id: trip.id, destination: trip.destination, status: trip.status }, recap: trip.items.map((item, index) => ({ time: `Stop ${index + 1}`, title: item.title, note: `${item.location} · ${new Date(item.startTime).toLocaleDateString()}`, type: item.type })), spend, vendors, reviews: trip.reviews.map((review) => ({ vendorId: review.vendorId, rating: review.rating, tags: review.tags, comment: review.comment })), preferences: trip.user.preferences || {}, loyaltyPoints: trip.user.loyaltyPoints, referralCode: trip.user.referralCode })
}))
app.post('/api/trips/:id/reviews', requireAuth, allowRoles(Role.TRAVELER), asyncRoute(async (request, response) => {
  const data = z.object({ vendorId: z.string(), rating: z.number().int().min(1).max(5), tags: z.array(z.string().min(1)).max(10), comment: z.string().max(1000).optional() }).parse(request.body)
  const trip = await prisma.trip.findUnique({ where: { id: (request.params.id as string) }, include: { user: true, items: { include: { inventoryItem: true } } } }); if (!trip) return response.status(404).json({ error: 'Trip not found.' }); if (trip.userId !== request.auth!.sub) return response.status(403).json({ error: 'Trip access denied.' }); const vendorUsed = trip.items.some((item) => item.vendorId === data.vendorId); if (!vendorUsed) return response.status(422).json({ error: 'Reviews can only be submitted for a trip vendor.' })
  const existing = await prisma.review.findUnique({ where: { tripId_vendorId: { tripId: trip.id, vendorId: data.vendorId } } })
  const review = await prisma.review.upsert({ where: { tripId_vendorId: { tripId: trip.id, vendorId: data.vendorId } }, create: { tripId: trip.id, vendorId: data.vendorId, rating: data.rating, tags: data.tags, comment: data.comment }, update: { rating: data.rating, tags: data.tags, comment: data.comment } })
  const profile = learnFromReview((trip.user.preferences || {}) as PreferenceProfile, data.tags, data.rating, existing ? { tags: existing.tags as string[], rating: existing.rating } : undefined)
  // A trip can collect a review per vendor, and each one upserts here, but the trip only *becomes*
  // COMPLETED once - award loyalty points on that first transition only, so re-submitting a review
  // for an already-completed trip (a second vendor, or an edit) never double-awards.
  const pointsEarned = trip.status === 'COMPLETED' ? 0 : pointsForTripCompletion(trip)
  const updatedUser = await prisma.user.update({ where: { id: trip.userId }, data: { preferences: profile, ...(pointsEarned > 0 ? { loyaltyPoints: { increment: pointsEarned } } : {}) } })
  await prisma.trip.update({ where: { id: trip.id }, data: { status: 'COMPLETED' } }); await prisma.activityLog.create({ data: { userId: trip.userId, action: existing ? 'REVIEW_UPDATED' : 'REVIEW_SUBMITTED', metadata: { tripId: trip.id, vendorId: data.vendorId, rating: data.rating, tags: data.tags } } }); publishEvent('review-submitted', { tripId: trip.id, reviewId: review.id })
  return response.status(existing ? 200 : 201).json({ review, preferences: profile, pointsEarned, loyaltyPoints: updatedUser.loyaltyPoints })
}))
app.post('/api/trips/:id/simulate', requireAuth, allowRoles(Role.TRAVELER), asyncRoute(async (request, response) => {
  const input = z.object({ budgetDelta: z.number().min(-1000000).max(1000000).optional(), durationDays: z.number().int().min(1).max(30).optional(), hotelTier: z.enum(['cheaper', 'standard', 'premium']).optional(), activityReplacement: z.object({ itineraryItemId: z.string(), inventoryItemId: z.string() }).optional() }).parse(request.body)
  const trip = await prisma.trip.findUnique({ where: { id: (request.params.id as string) }, include: { user: true } }); if (!trip) return response.status(404).json({ error: 'Trip not found.' }); if (trip.userId !== request.auth!.sub) return response.status(403).json({ error: 'Trip access denied.' })
  const items = await prisma.itineraryItem.findMany({ where: { tripId: trip.id }, orderBy: { startTime: 'asc' } }); const inventory = await prisma.inventoryItem.findMany({ where: { availability: { not: 'Unavailable' } } }); const result = await makeSimulation(trip, items, inventory, input); const simulation = await prisma.simulation.create({ data: { tripId: trip.id, input, result } })
  return response.status(201).json({ simulationId: simulation.id, ...result })
}))
app.post('/api/trips/:id/simulations/:simulationId/apply', requireAuth, allowRoles(Role.TRAVELER), asyncRoute(async (request, response) => {
  const trip = await prisma.trip.findUnique({ where: { id: (request.params.id as string) } }); if (!trip) return response.status(404).json({ error: 'Trip not found.' }); if (trip.userId !== request.auth!.sub) return response.status(403).json({ error: 'Trip access denied.' }); const simulation = await prisma.simulation.findFirst({ where: { id: (request.params.simulationId as string), tripId: trip.id } }); if (!simulation) return response.status(404).json({ error: 'Simulation not found.' }); if (simulation.appliedAt) return response.status(409).json({ error: 'This simulation has already been applied.' })
  const input = simulation.input as SimulationInput; const result = simulation.result as unknown as { simulatedItinerary: Array<{ itineraryItemId: string; inventoryItemId: string | null; type: ItemType; title: string; startTime: string; endTime: string; location: string; cost: number; vendorId: string | null }> }; await prisma.$transaction([prisma.trip.update({ where: { id: trip.id }, data: { budget: trip.budget + (input.budgetDelta || 0) } }), ...result.simulatedItinerary.map((item) => prisma.itineraryItem.update({ where: { id: item.itineraryItemId }, data: { inventoryItemId: item.inventoryItemId, type: item.type, title: item.title, startTime: new Date(item.startTime), endTime: new Date(item.endTime), location: item.location, cost: item.cost, vendorId: item.vendorId } })), prisma.simulation.update({ where: { id: simulation.id }, data: { appliedAt: new Date() } })]); await rebuildDependencies(trip.id); await prisma.activityLog.create({ data: { userId: trip.userId, action: 'SIMULATION_APPLIED', metadata: { tripId: trip.id, simulationId: simulation.id } } }); publishEvent('simulation-applied', { tripId: trip.id, simulationId: simulation.id }); return response.json({ wallet: await tripSummary(trip.id) })
}))
// Optional, best-effort body: a short client-built summary of the live discovery pass (see
// travelDiscoveryService.ts / ComposerPage.tsx). Parsed leniently (falls back to {} on a missing
// or malformed body) since every existing caller of this route sends no body at all and must keep
// working exactly as before.
const generateItinerarySchema = z.object({ discoverySummary: z.string().max(4000).optional(), changeRequest: z.string().max(1000).optional() })
app.post('/api/trips/:id/submit-review', requireAuth, allowRoles(Role.TRAVELER), asyncRoute(async (request, response) => {
  const trip = await prisma.trip.findUnique({ where: { id: request.params.id as string }, include: { items: true } })
  if (!trip) return response.status(404).json({ error: 'Trip not found.' })
  if (trip.userId !== request.auth!.sub) return response.status(403).json({ error: 'Trip access denied.' })
  if (!trip.items.length) return response.status(422).json({ error: 'Generate an itinerary before submitting it for approval.' })
  if (!['COMPOSED', 'CHANGES_REQUESTED'].includes(trip.status)) return response.status(409).json({ error: 'This trip is not ready for review.' })
  const updated = await prisma.trip.update({ where: { id: trip.id }, data: { status: 'PENDING_ADMIN', approvalStatus: 'PENDING', adminFeedback: null } })
  await prisma.activityLog.create({ data: { userId: request.auth!.sub, action: 'TRIP_SUBMITTED_FOR_ADMIN_REVIEW', metadata: { tripId: trip.id } } })
  await notifyTrip(trip.id, 'TRIP_REVIEW_REQUESTED', 'Trip submitted for review', 'Your itinerary is waiting for admin approval before booking is unlocked.')
  publishEvent('trip-review-requested', { tripId: trip.id })
  return response.json({ trip: updated })
}))

app.get('/api/trips/:id/adjustments', requireAuth, asyncRoute(async (request, response) => {
  const trip = await findAccessibleTrip(request.params.id as string, request, response); if (!trip) return
  return response.json({ adjustments: await prisma.tripAdjustment.findMany({ where: { tripId: trip.id }, orderBy: { createdAt: 'desc' } }) })
}))

type TripRecordForCompose = Awaited<ReturnType<typeof prisma.trip.findUniqueOrThrow>>
type ComposeOutcome = { ok: true; payload: Record<string, unknown> } | { ok: false; status: number; error: string }
// Shared by POST /api/trips/:id/generate-itinerary (manual/empty-selection auto-generate) and
// POST /api/trips/:id/apply-template (predefined ready-made itinerary library): both paths
// resolve to the exact same verified-inventory + composition pipeline once a set of
// preferences (travelStyle/interests/pace) is decided - only *how* those preferences were
// decided differs between the two callers.
async function composeItineraryForTrip(trip: TripRecordForCompose, preferences: PreferenceProfile, discoverySummary: string | undefined, changeRequest?: string): Promise<ComposeOutcome> {
  let inventory = [] as Awaited<ReturnType<typeof getDestinationInventory>>
  try {
    const discovery = await discoverDestination({ destination: trip.destination, checkIn: trip.startDate.toISOString().slice(0,10), checkOut: trip.endDate.toISOString().slice(0,10), travelers: 1, budget: trip.budget, interests: Array.isArray(preferences.interests) ? preferences.interests : [], tripStyle: trip.travelStyle })
    const discoveredInventory = await syncDiscoveryInventory(prisma, discovery)
    if (discoveredInventory.length) inventory = discoveredInventory
  } catch (error) {
    console.warn('LIVE DISCOVERY unavailable; using destination-scoped verified inventory:', error instanceof Error ? error.message : error)
  }
  if (!inventory.length) inventory = await getDestinationInventory(prisma, { destination: trip.destination, preferences, budget: trip.budget })
  // generateWithGroq() already falls back to a deterministic curated itinerary internally whenever
  // Groq itself fails, so this only ever throws in a genuine edge case (e.g. the schema rejecting
  // a malformed response, or no inventory at all to build from). Surface that plainly instead of
  // letting it fall through to the generic 500 handler, so the app never gets stuck on
  // "Composing your itinerary…" with no explanation.
  let generated: Awaited<ReturnType<typeof generateWithGroq>>
  try {
    const requestedNames = [...(Array.isArray(trip.requestedPlaces) ? trip.requestedPlaces : []), ...(Array.isArray(trip.requestedActivities) ? trip.requestedActivities : [])].filter((value): value is string => typeof value === 'string')
    const requestedDays = trip.requestedActivityDays && typeof trip.requestedActivityDays === 'object' && !Array.isArray(trip.requestedActivityDays) ? trip.requestedActivityDays as Record<string, string> : {}
    generated = await generateWithGroq({ destination: trip.destination, startDate: trip.startDate, endDate: trip.endDate, budget: trip.budget, preferences: { ...preferences, travelStyle: trip.travelStyle }, inventory: inventory.map((item) => ({ id: item.id, title: item.title, type: item.type, location: item.location, price: item.price, tags: item.tags })), discoverySummary, changeRequest, requiredItems: requestedNames.map((title) => ({ title, day: requestedDays[title] })) })
  } catch (error) {
    console.error('❌ ITINERARY GENERATION FAILED:', error instanceof Error ? error.message : error)
    return { ok: false, status: 502, error: 'Itinerary generation failed. Please try again.' }
  }
  const selectedIds = generated.days.flatMap((day) => day.items.map((item) => item.itineraryItemId))
  if (new Set(selectedIds).size !== selectedIds.length || selectedIds.some((id) => !inventory.some((item) => item.id === id))) return { ok: false, status: 422, error: 'Generated itinerary could not be verified. Please try again.' }
  const selected = selectedIds.map((id) => inventory.find((item) => item.id === id)!)
  const plannedCost = selected.reduce((sum, item) => sum + item.price, 0)
  if (plannedCost > trip.budget) return { ok: false, status: 422, error: 'Generated itinerary exceeds the trip budget. Please adjust and try again.' }
  const matchScore = preferenceMatch({ ...preferences, travelStyle: trip.travelStyle }, selected)
  await prisma.itineraryItem.deleteMany({ where: { tripId: trip.id } })
  const saved: Array<Awaited<ReturnType<typeof prisma.itineraryItem.create>>> = []
  for (const day of generated.days) for (const suggestion of day.items) {
    const item = inventory.find((candidate) => candidate.id === suggestion.itineraryItemId)!
    saved.push(await prisma.itineraryItem.create({ data: { tripId: trip.id, inventoryItemId: item.id, type: item.type, title: item.title, startTime: new Date(suggestion.suggestedStartTime), endTime: new Date(suggestion.suggestedEndTime), location: item.location, cost: item.price, vendorId: item.vendorId, status: ItemStatus.PLANNED, reasoning: suggestion.reasoning, preferenceScore: matchScore } }))
  }
  await prisma.trip.update({ where: { id: trip.id }, data: { status: 'COMPOSED' } })
  await rebuildDependencies(trip.id)
  const payload = { days: generated.days.map((day) => ({ day: day.day, items: day.items.map((suggestion) => { const item = saved.find((record) => record.inventoryItemId === suggestion.itineraryItemId)!; const inventoryItem = inventory.find((candidate) => candidate.id === suggestion.itineraryItemId)!; const itemDetails = inventoryItem.details as { image?: string } | null; return { id: item.id, type: item.type, title: item.title, startTime: item.startTime, endTime: item.endTime, location: item.location, cost: item.cost, vendor: inventoryItem.vendor.name, reasoning: item.reasoning, preferenceScore: item.preferenceScore, image: itemDetails?.image } }) })), budget: { plannedCost, budget: trip.budget, remainingBudget: trip.budget - plannedCost, percentageUsed: Math.round((plannedCost / trip.budget) * 100) }, preferenceScore: matchScore }
  return { ok: true, payload }
}
app.post('/api/trips/:id/generate-itinerary', requireAuth, allowRoles(Role.TRAVELER), asyncRoute(async (request, response) => {
  const { discoverySummary, changeRequest } = generateItinerarySchema.parse(request.body || {})
  const trip = await prisma.trip.findUnique({ where: { id: (request.params.id as string) }, include: { user: true, items: { include: { booking: true } } } })
  if (!trip) return response.status(404).json({ error: 'Trip not found.' })
  if (trip.userId !== request.auth!.sub) return response.status(403).json({ error: 'Trip access denied.' })
  // Trip lifecycle statuses used across the app: DRAFT (created, see POST /api/trips) ->
  // COMPOSED (set below once an itinerary has been generated) -> BOOKED (set by
  // /api/trips/:id/checkout once payment is captured) -> COMPLETED (set once a post-trip
  // review is submitted). Regenerating wipes every ItineraryItem for the trip (see
  // deleteMany inside composeItineraryForTrip), which is safe before anything has been booked
  // but would silently destroy real, paid vendor bookings once the trip has gone live. Guard on
  // the trip's actual Booking records rather than the status label alone, so this also catches
  // trips recorded under a different "already committed" label (e.g. the seeded sample trip uses
  // 'CONFIRMED' instead of 'BOOKED' but already has PAID/CONFIRMED bookings) as well as
  // COMPLETED trips, which are always booked before they can be completed.
  const hasCommittedBooking = trip.items.some((item) => item.booking && (item.booking.paymentStatus === PaymentStatus.PAID || item.booking.confirmationStatus === BookingStatus.CONFIRMED))
  if (trip.status === 'BOOKED' || trip.status === 'COMPLETED' || hasCommittedBooking) {
    return response.status(409).json({ error: 'Booked trips cannot be regenerated.' })
  }
  const preferences = (trip.user.preferences || {}) as PreferenceProfile
  const result = await composeItineraryForTrip(trip, preferences, discoverySummary, changeRequest)
  if (!result.ok) return response.status(result.status).json({ error: result.error })
  return response.json(result.payload)
}))
// ---- Predefined ready-made itineraries: a fixed, browsable template library ----
// Distinct mechanism from the empty-selection auto-generate path above: instead of composing
// straight from whatever the traveler already typed/selected during onboarding, the traveler
// picks a named, curated preset here. Applying it seeds the trip/user profile with that
// preset's travelStyle/tripType/pace/interests and then runs it through the exact same
// verified-inventory + composition pipeline, so the result is still a real itinerary built
// from live/verified inventory for the trip's own destination and dates - never canned content.
app.get('/api/itinerary-templates', requireAuth, allowRoles(Role.TRAVELER), asyncRoute(async (_request, response) => {
  return response.json({ templates: ITINERARY_TEMPLATES })
}))
const applyTemplateSchema = z.object({ templateId: z.string().min(1) })
app.post('/api/trips/:id/apply-template', requireAuth, allowRoles(Role.TRAVELER), asyncRoute(async (request, response) => {
  const { templateId } = applyTemplateSchema.parse(request.body)
  const template = getTemplateById(templateId)
  if (!template) return response.status(404).json({ error: 'Unknown itinerary template.' })
  const trip = await prisma.trip.findUnique({ where: { id: (request.params.id as string) }, include: { user: true, items: { include: { booking: true } } } })
  if (!trip) return response.status(404).json({ error: 'Trip not found.' })
  if (trip.userId !== request.auth!.sub) return response.status(403).json({ error: 'Trip access denied.' })
  // Same regeneration guard as /generate-itinerary: a template can only be applied before
  // anything on this trip has actually been booked/paid for.
  const hasCommittedBooking = trip.items.some((item) => item.booking && (item.booking.paymentStatus === PaymentStatus.PAID || item.booking.confirmationStatus === BookingStatus.CONFIRMED))
  if (trip.status === 'BOOKED' || trip.status === 'COMPLETED' || hasCommittedBooking) {
    return response.status(409).json({ error: 'Booked trips cannot be regenerated.' })
  }
  const existingPreferences = profileFrom(trip.user.preferences)
  const mergedInterests = [...new Set([...(Array.isArray(existingPreferences.interests) ? existingPreferences.interests : []), ...template.interestTags])]
  const preferences: PreferenceProfile = { ...existingPreferences, travelStyle: template.travelStyle, interests: mergedInterests, pace: template.pace, travelPace: paceLabel(template.pace), onboardingComplete: true }
  const [, updatedTrip] = await prisma.$transaction([
    prisma.user.update({ where: { id: trip.userId }, data: { preferences } }),
    prisma.trip.update({ where: { id: trip.id }, data: { travelStyle: template.travelStyle, tripType: template.tripType } }),
  ])
  const result = await composeItineraryForTrip(updatedTrip, preferences, undefined)
  if (!result.ok) return response.status(result.status).json({ error: result.error })
  await prisma.activityLog.create({ data: { userId: request.auth!.sub, action: 'ITINERARY_TEMPLATE_APPLIED', metadata: { tripId: trip.id, templateId: template.id } } })
  return response.json({ ...result.payload, template: { id: template.id, name: template.name } })
}))
app.patch('/api/itinerary-items/:id', requireAuth, asyncRoute(async (request, response) => { const data = itemPayload.parse(request.body); const current = await prisma.itineraryItem.findUnique({ where: { id: (request.params.id as string) }, include: { trip: true } }); if (!current) return response.status(404).json({ error: 'Itinerary item not found.' }); if (request.auth!.role === Role.TRAVELER && current.trip.userId !== request.auth!.sub) return response.status(403).json({ error: 'Itinerary item access denied.' }); const startTime = data.startTime ? new Date(data.startTime) : current.startTime; const endTime = data.endTime ? new Date(data.endTime) : current.endTime; await validateItineraryChange(current.tripId, current.id, startTime, endTime, current.type); const item = await prisma.itineraryItem.update({ where: { id: current.id }, data: { ...data, startTime, endTime } }); if (current.trip.status !== 'BOOKED' && current.trip.approvalStatus === 'APPROVED') await prisma.trip.update({ where: { id: current.tripId }, data: { status: 'COMPOSED', approvalStatus: 'NOT_SUBMITTED', adminFeedback: 'The itinerary changed after approval. Please submit it for approval again.' } }); await rebuildDependencies(current.tripId); await prisma.activityLog.create({ data: { userId: request.auth!.sub, action: 'ITINERARY_EDITED', metadata: { tripId: current.tripId, itemId: current.id } } }); if (request.auth!.role === Role.OPERATOR) await notifyTripStakeholders(prisma, publishNotification, { tripId: current.tripId, type: 'ITINERARY_UPDATED', title: 'Tour schedule updated', message: 'An operator updated the schedule on your trip.' }); publishEvent('operator-schedule-updated', { tripId: current.tripId, itemId: current.id }); return response.json({ item, summary: await tripSummary(current.tripId) }) }))
app.post('/api/trips/:id/itinerary', requireAuth, allowRoles(Role.TRAVELER, Role.OPERATOR), asyncRoute(async (request, response) => { const data = z.object({ inventoryItemId: z.string(), startTime: z.string().datetime(), endTime: z.string().datetime() }).parse(request.body); const trip = await prisma.trip.findUnique({ where: { id: (request.params.id as string) } }); if (!trip) return response.status(404).json({ error: 'Trip not found.' }); const inventoryItem = await prisma.inventoryItem.findUnique({ where: { id: data.inventoryItemId } }); if (!inventoryItem) return response.status(404).json({ error: 'Inventory item not found.' }); const startTime = new Date(data.startTime); const endTime = new Date(data.endTime); await validateItineraryChange(trip.id, undefined, startTime, endTime, inventoryItem.type); const item = await prisma.itineraryItem.create({ data: { tripId: trip.id, inventoryItemId: inventoryItem.id, type: inventoryItem.type, title: inventoryItem.title, startTime, endTime, location: inventoryItem.location, cost: inventoryItem.price, vendorId: inventoryItem.vendorId, status: ItemStatus.PLANNED, reasoning: 'Added from verified inventory.' } }); if (trip.status !== 'BOOKED' && trip.approvalStatus === 'APPROVED') await prisma.trip.update({ where: { id: trip.id }, data: { status: 'COMPOSED', approvalStatus: 'NOT_SUBMITTED', adminFeedback: 'The itinerary changed after approval. Please submit it for approval again.' } }); await rebuildDependencies(trip.id); if (trip.status === 'BOOKED') { await prisma.tripAdjustment.create({ data: { tripId: trip.id, type: 'ADDITIONAL_CHARGE', amount: item.cost, reason: `Added ${item.title} during the active trip.` } }); await notifyTrip(trip.id, 'TRIP_ADJUSTMENT', 'Additional charge recorded', `₹${item.cost.toLocaleString()} additional charge for ${item.title}.`) } await prisma.activityLog.create({ data: { userId: request.auth!.sub, action: 'ITINERARY_ADDED', metadata: { tripId: trip.id, itemId: item.id, additionalCharge: trip.status === 'BOOKED' ? item.cost : 0 } } }); return response.status(201).json({ item, summary: await tripSummary(trip.id) }) }))
app.post('/api/trips/:id/itinerary/reorder', requireAuth, asyncRoute(async (request, response) => { const data = z.object({ items: z.array(z.object({ id: z.string(), startTime: z.string().datetime(), endTime: z.string().datetime() })) }).parse(request.body); const trip = await prisma.trip.findUnique({ where: { id: (request.params.id as string) } }); if (!trip) return response.status(404).json({ error: 'Trip not found.' }); const items = await prisma.itineraryItem.findMany({ where: { tripId: (request.params.id as string) } }); if (data.items.length !== items.length || data.items.some((entry) => !items.some((item) => item.id === entry.id))) return response.status(400).json({ error: 'Reorder payload does not match this itinerary.' }); const ordered = data.items.map((entry) => ({ ...entry, startTime: new Date(entry.startTime), endTime: new Date(entry.endTime) })); if (ordered.some((entry) => entry.startTime >= entry.endTime)) return response.status(422).json({ error: 'Every activity needs an end time after its start time.' }); if (ordered.some((entry) => entry.startTime < trip.startDate || entry.endTime > trip.endDate)) return response.status(422).json({ error: 'A reordered activity falls outside your trip dates.' }); if (ordered.some((entry, index) => ordered.some((other, otherIndex) => otherIndex !== index && entry.startTime < other.endTime && entry.endTime > other.startTime))) return response.status(422).json({ error: 'The reordered activities overlap.' }); await prisma.$transaction(ordered.map((entry) => prisma.itineraryItem.update({ where: { id: entry.id }, data: { startTime: entry.startTime, endTime: entry.endTime } }))); if (trip.status !== 'BOOKED' && trip.approvalStatus === 'APPROVED') await prisma.trip.update({ where: { id: trip.id }, data: { status: 'COMPOSED', approvalStatus: 'NOT_SUBMITTED', adminFeedback: 'The itinerary changed after approval. Please submit it for approval again.' } }); await rebuildDependencies(trip.id); await prisma.activityLog.create({ data: { userId: request.auth!.sub, action: 'ITINERARY_REORDERED', metadata: { tripId: trip.id, itemIds: ordered.map((entry) => entry.id) } } }); return response.json({ items: await prisma.itineraryItem.findMany({ where: { tripId: (request.params.id as string) }, include: { vendor: true }, orderBy: { startTime: 'asc' } }), summary: await tripSummary((request.params.id as string)) }) }))
app.delete('/api/itinerary-items/:id', requireAuth, asyncRoute(async (request, response) => { const item = await prisma.itineraryItem.findUnique({ where: { id: (request.params.id as string) }, include: { trip: true } }); if (!item) return response.status(404).json({ error: 'Itinerary item not found.' }); if (request.auth!.role === Role.TRAVELER && item.trip.userId !== request.auth!.sub) return response.status(403).json({ error: 'Itinerary item access denied.' }); const wasBooked = item.trip.status === 'BOOKED'; const refundAmount = item.cost; await prisma.itineraryItem.delete({ where: { id: item.id } }); if (!wasBooked && item.trip.approvalStatus === 'APPROVED') await prisma.trip.update({ where: { id: item.tripId }, data: { status: 'COMPOSED', approvalStatus: 'NOT_SUBMITTED', adminFeedback: 'The itinerary changed after approval. Please submit it for approval again.' } }); if (wasBooked) { await prisma.tripAdjustment.create({ data: { tripId: item.tripId, type: 'REFUND', amount: refundAmount, reason: `Removed ${item.title} during the active trip.` } }); await notifyTrip(item.tripId, 'TRIP_ADJUSTMENT', 'Refund recorded', `₹${refundAmount.toLocaleString()} refund recorded for removing ${item.title}.`) } await rebuildDependencies(item.tripId); await prisma.activityLog.create({ data: { userId: request.auth!.sub, action: 'ITINERARY_REMOVED', metadata: { tripId: item.tripId, itemId: item.id } } }); return response.json({ summary: await tripSummary(item.tripId) }) }))
app.post('/api/itinerary-items/:id/swap', requireAuth, asyncRoute(async (request, response) => { const data = z.object({ inventoryItemId: z.string() }).parse(request.body); const current = await prisma.itineraryItem.findUnique({ where: { id: (request.params.id as string) }, include: { trip: true } }); const inventoryItem = await prisma.inventoryItem.findUnique({ where: { id: data.inventoryItemId } }); if (!current || !inventoryItem) return response.status(404).json({ error: 'Item not found.' }); if (request.auth!.role === Role.TRAVELER && current.trip.userId !== request.auth!.sub) return response.status(403).json({ error: 'Itinerary item access denied.' }); const item = await prisma.itineraryItem.update({ where: { id: current.id }, data: { inventoryItemId: inventoryItem.id, type: inventoryItem.type, title: inventoryItem.title, location: inventoryItem.location, cost: inventoryItem.price, vendorId: inventoryItem.vendorId, reasoning: 'Swapped with verified inventory.' } }); if (current.trip.status !== 'BOOKED' && current.trip.approvalStatus === 'APPROVED') await prisma.trip.update({ where: { id: current.tripId }, data: { status: 'COMPOSED', approvalStatus: 'NOT_SUBMITTED', adminFeedback: 'The itinerary changed after approval. Please submit it for approval again.' } }); await rebuildDependencies(current.tripId); await prisma.activityLog.create({ data: { userId: request.auth!.sub, action: 'ITINERARY_SWAPPED', metadata: { tripId: current.tripId, itemId: current.id } } }); return response.json({ item, summary: await tripSummary(current.tripId) }) }))
app.get('/api/trips/:id/graph', requireAuth, asyncRoute(async (request, response) => { const trip = await findAccessibleTrip(request.params.id as string, request, response); if (!trip) return; const items = await prisma.itineraryItem.findMany({ where: { tripId: trip.id }, include: { dependenciesFrom: true } }); const affectedItemId = typeof request.query.affectedItemId === 'string' ? request.query.affectedItemId : undefined; const dependencies = items.flatMap((item) => item.dependenciesFrom.map((edge) => ({ predecessorId: edge.predecessorId, dependentId: edge.dependentId }))); return response.json(toReactFlowGraph(items.map((item) => ({ id: item.id, title: item.title, type: item.type, status: item.status })), dependencies, affectedItemId)) }))
app.post('/api/trips/:id/disrupt', requireAuth, asyncRoute(async (request, response) => {
  const data = z.object({ affectedItemId: z.string(), disruptionType: z.enum(['delay', 'cancellation', 'weather', 'availability']), details: z.string().min(3), decisionMode: z.enum(decisionModeValues).default('balanced') }).parse(request.body)
  const trip = await prisma.trip.findUnique({ where: { id: (request.params.id as string) }, include: { user: true } }); if (!trip) return response.status(404).json({ error: 'Trip not found.' }); if (request.auth!.role === Role.TRAVELER && trip.userId !== request.auth!.sub) return response.status(403).json({ error: 'Trip access denied.' })
  const items = await prisma.itineraryItem.findMany({ where: { tripId: trip.id }, include: { dependenciesFrom: true, booking: true } }); const affected = items.find((item) => item.id === data.affectedItemId); if (!affected) return response.status(404).json({ error: 'Affected item is not part of this trip.' })
  const dependencies = items.flatMap((item) => item.dependenciesFrom.map((edge) => ({ predecessorId: edge.predecessorId, dependentId: edge.dependentId }))); const impact = analyzeImpact(affected, items, dependencies, data.disruptionType, data.details); const impacted = items.filter((item) => impact.ids.includes(item.id))
  const recoveryTarget = impacted.find((item) => item.type === ItemType.ACTIVITY) || impacted[impacted.length - 1]
  const alternatives = (await getDestinationInventory(prisma, { destination: trip.destination, preferences: trip.user.preferences, budget: trip.budget })).filter((item) => item.type === recoveryTarget.type && item.bookable)
  const usable = alternatives.filter((item) => item.id !== recoveryTarget.inventoryItemId)
  if (usable.length < 3) return response.status(422).json({ error: 'Not enough verified inventory alternatives are available.' })
  const proposals = buildProposals(impacted, usable, { ...((trip.user.preferences || {}) as PreferenceProfile), travelStyle: trip.travelStyle }, data.decisionMode); const narratives = await generateRecoveryNarratives({ disruption: `${data.disruptionType}: ${data.details}`, alternatives: proposals.map((proposal) => ({ id: proposal.changedItems[0].replacementInventoryItemId, title: usable.find((item) => item.id === proposal.changedItems[0].replacementInventoryItemId)!.title, vendor: usable.find((item) => item.id === proposal.changedItems[0].replacementInventoryItemId)!.vendor.name })) }); proposals.forEach((proposal, index) => { proposal.explanation = narratives[index] || proposal.explanation })
  const disruption = await prisma.disruption.create({ data: { tripId: trip.id, affectedItemId: affected.id, type: data.disruptionType.toUpperCase(), severity: impact.severity, status: 'PROPOSED', details: `${data.details} ${impact.explanation}` } }); const plans = await Promise.all(proposals.map((proposal) => prisma.recoveryPlan.create({ data: { disruptionId: disruption.id, changedItems: proposal.changedItems, extraCost: proposal.extraCost, timeDelta: proposal.timeDeltaMinutes, preferenceScore: proposal.preferenceMatchScore, vendorReliability: proposal.vendorReliability, finalScore: proposal.finalScore, explanation: proposal.explanation, status: 'PROPOSED' } })))
  await notifyTrip(trip.id, 'DISRUPTION', 'Trip disruption detected', `${data.disruptionType} may affect your ${trip.destination} itinerary. Recovery options are ready to review.`); publishEvent('disruption-created', { tripId: trip.id, disruptionId: disruption.id }); return response.status(201).json({ disruption: { id: disruption.id, affectedItemId: affected.id, severity: disruption.severity, explanation: impact.explanation, decisionMode: data.decisionMode, affectedItems: impacted.map((item) => ({ id: item.id, title: item.title, type: item.type, status: item.status })), plans } })
}))
app.post('/api/trips/:id/copilot-message', requireAuth, asyncRoute(async (request, response) => {
  const data = z.object({ message: z.string().min(1).max(2000), language: z.string().regex(/^[a-zA-Z]{2}(?:-[a-zA-Z]{2})?$/).default('en'), conversationHistory: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(2000) })).max(30).default([]) }).parse(request.body)
  const trip = await prisma.trip.findUnique({ where: { id: (request.params.id as string) }, include: { user: true } })
  if (!trip) return response.status(404).json({ error: 'Trip not found.' })
  if (request.auth!.role === Role.TRAVELER && trip.userId !== request.auth!.sub) return response.status(403).json({ error: 'Trip access denied.' })
  const items = await prisma.itineraryItem.findMany({ where: { tripId: trip.id }, include: { dependenciesFrom: true, booking: true }, orderBy: { startTime: 'asc' } })
  const inventory = await prisma.inventoryItem.findMany({ where: { availability: { not: 'Unavailable' } }, include: { vendor: true } })
  const disruptions = await prisma.disruption.findMany({ where: { tripId: trip.id, status: { notIn: ['RESOLVED', 'REVERTED'] } }, orderBy: { timestamp: 'desc' }, take: 10 })
  const context: CopilotContext = { trip, items, inventory }
  const message = data.message.toLowerCase()
  const aiIntent = await classifyCopilotIntent(data.message, { destination: trip.destination, budget: trip.budget, itinerary: items.map((item) => ({ id: item.id, title: item.title, type: item.type, startTime: item.startTime, endTime: item.endTime, location: item.location, cost: item.cost, booked: Boolean(item.booking) })), preferences: trip.user.preferences, currentDisruptions: disruptions.map((disruption) => ({ type: disruption.type, severity: disruption.severity, status: disruption.status })), inventory: inventory.map((item) => ({ id: item.id, type: item.type, title: item.title, location: item.location, price: item.price, vendor: item.vendor.name, reliability: item.vendor.reliabilityScore })), conversationHistory: data.conversationHistory })
  const cancellation = /cancel(?:led|ed|lation)?|unavailable|rain|weather/.test(message)
  const wantsHotel = /hotel|stay|room|accommodation/.test(message)
  const wantsBudget = /budget|increase|lower|cheaper|more spend/.test(message)
  const wantsToday = /today|plan|schedule|itinerary/.test(message)
  if (aiIntent === 'disruption' || cancellation) {
    const affected = items.find((item) => (wantsHotel ? item.type === ItemType.HOTEL : /activity|rain|weather/.test(message) ? item.type === ItemType.ACTIVITY : true)) || items[0]
    if (!affected) return response.status(422).json({ error: 'There is no itinerary item to analyse.' })
    const disruption = await triggerDisruptionAnalysis(prisma, context, affected, /rain|weather/.test(message) ? 'weather' : wantsHotel ? 'availability' : 'cancellation', data.message)
    await notifyTrip(trip.id, 'DISRUPTION', 'Trip disruption detected', `A ${/rain|weather/.test(message) ? 'weather' : 'travel'} disruption may affect your ${trip.destination} itinerary. Recovery options are ready to review.`); publishEvent('disruption-created', { tripId: trip.id, disruptionId: disruption.id }); const copilotMessage = await localizeCopilotMessage(`I identified ${disruption.affectedItems.length} connected item${disruption.affectedItems.length === 1 ? '' : 's'} and prepared three verified recovery options. Nothing has changed yet—choose Apply to confirm one.`, data.language); return response.json({ message: copilotMessage, action: 'recovery_options', structuredData: { recovery: disruption } })
  }
  if (aiIntent === 'hotel_alternatives' || wantsHotel && /change|cheaper|switch|replace/.test(message)) {
    const hotel = items.find((item) => item.type === ItemType.HOTEL)
    if (!hotel) return response.status(422).json({ error: 'No hotel is in this itinerary.' })
    const alternatives = getAvailableAlternatives(context, hotel, /cheaper|lower/.test(message))
    const copilotMessage = await localizeCopilotMessage(alternatives.length ? 'Here are verified hotel alternatives. Selecting one only proposes a change; it will not alter your booking until you confirm.' : 'I could not find a verified hotel alternative that meets that constraint.', data.language); return response.json({ message: copilotMessage, action: 'alternatives', structuredData: { itemId: hotel.id, alternatives: alternatives.map((item) => ({ id: item.id, title: item.title, location: item.location, cost: item.price, vendor: item.vendor.name, reliability: item.vendor.reliabilityScore })) } })
  }
  if (aiIntent === 'budget_simulation' || wantsBudget) {
    const amount = Number(data.message.replace(/,/g, '').match(/(?:₹|inr|rs\.?\s*)\s*(\d+)/i)?.[1] || data.message.match(/\b(\d{3,6})\b/)?.[1] || 0)
    const increasing = /increase|more|raise|add/.test(message)
    const simulation = simulateBudgetChange(trip, items, increasing ? amount : -amount)
    const copilotMessage = await localizeCopilotMessage(amount ? `With a ${increasing ? 'higher' : 'lower'} ₹${amount.toLocaleString()} budget, your plan would be ${simulation.percentageUsed}% allocated with ₹${simulation.remaining.toLocaleString()} remaining against committed bookings.` : `Your current plan has ₹${simulation.remaining.toLocaleString()} remaining against committed bookings. Tell me the amount you want to change.`, data.language); return response.json({ message: copilotMessage, action: 'budget_simulation', structuredData: simulation })
  }
  if (aiIntent === 'itinerary_summary' || wantsToday) {
    const summary = getItinerarySummary(items)
    const copilotMessage = await localizeCopilotMessage(summary.nextItems.length ? `Your next scheduled stop is ${summary.nextItems[0].title}. I’ve included the upcoming itinerary below.` : 'Your itinerary is currently empty.', data.language); return response.json({ message: copilotMessage, action: 'itinerary_summary', structuredData: summary })
  }
  const summary = getItinerarySummary(items); const budget = getBudgetSummary(trip, items)
  const copilotMessage = await localizeCopilotMessage(`I have your ${trip.destination} trip in context: ${summary.count} itinerary items and ₹${budget.remaining.toLocaleString()} remaining against committed bookings. I can check weather disruptions, compare verified alternatives, or simulate budget changes.`, data.language); return response.json({ message: copilotMessage, action: 'trip_summary', structuredData: { itinerary: summary, budget } })
}))
app.post('/api/recovery-plans/:id/reject', requireAuth, asyncRoute(async (request, response) => {
  const planId = request.params.id as string
  const plan = await prisma.recoveryPlan.findUnique({ where: { id: planId }, include: { disruption: { include: { trip: true } } } }); if (!plan) return response.status(404).json({ error: 'Recovery plan not found.' })
  if (request.auth!.role === Role.TRAVELER && plan.disruption.trip.userId !== request.auth!.sub) return response.status(403).json({ error: 'Recovery plan access denied.' })
  const claimed = await prisma.recoveryPlan.updateMany({ where: { id: planId, status: { in: ['PROPOSED', 'TRAVELER_APPROVED'] } }, data: { status: 'REJECTED' } })
  if (claimed.count === 0) {
    const current = await prisma.recoveryPlan.findUnique({ where: { id: planId }, select: { status: true } })
    const message = current?.status === 'APPROVED' ? 'This recovery plan has already been approved and cannot be rejected; revert it instead.' : current?.status === 'REJECTED' ? 'This recovery plan has already been rejected.' : 'This recovery plan has already been decided.'
    return response.status(409).json({ error: message })
  }
  await prisma.activityLog.create({ data: { action: 'RECOVERY_REJECTED', metadata: { planId: plan.id, tripId: plan.disruption.tripId } } }); await notifyTrip(plan.disruption.tripId, 'RECOVERY_REJECTED', 'Recovery option declined', 'A recovery option was declined. Other options may still be available.'); publishEvent('recovery-rejected', { tripId: plan.disruption.tripId, planId: plan.id })
  return response.json({ plan: { id: plan.id, status: 'REJECTED' } })
}))
app.patch('/api/recovery-plans/:id', requireAuth, allowRoles(Role.OPERATOR), asyncRoute(async (request, response) => {
  const data = z.object({ explanation: z.string().min(8).max(2000) }).parse(request.body)
  const plan = await prisma.recoveryPlan.findUnique({ where: { id: (request.params.id as string) }, include: { disruption: true } }); if (!plan) return response.status(404).json({ error: 'Recovery plan not found.' })
  if (plan.status !== 'PROPOSED') return response.status(409).json({ error: 'Only proposed recovery plans can be edited.' })
  const updated = await prisma.recoveryPlan.update({ where: { id: plan.id }, data: { explanation: data.explanation } }); await prisma.activityLog.create({ data: { action: 'RECOVERY_PLAN_EDITED', metadata: { planId: plan.id, tripId: plan.disruption.tripId } } }); publishEvent('recovery-edited', { tripId: plan.disruption.tripId, planId: plan.id })
  return response.json({ plan: updated })
}))
app.post('/api/recovery-plans/:id/approve', requireAuth, asyncRoute(async (request, response) => {
  const planId = request.params.id as string
  const plan = await prisma.recoveryPlan.findUnique({ where: { id: planId }, include: { disruption: { include: { trip: true } } } }); if (!plan) return response.status(404).json({ error: 'Recovery plan not found.' }); const tripId = plan.disruption.tripId
  if (request.auth!.role === Role.TRAVELER && plan.disruption.trip.userId !== request.auth!.sub) return response.status(403).json({ error: 'Recovery plan access denied.' })
  if (request.auth!.role === Role.VENDOR) return response.status(403).json({ error: 'Vendors cannot decide recovery plans.' })
  // Traveler approval only selects the plan and hands it to the operator; it never applies the
  // booking/itinerary changes itself. The operator's approval below is what actually commits them.
  if (request.auth!.role === Role.TRAVELER) {
    const claimed = await prisma.recoveryPlan.updateMany({ where: { id: planId, status: 'PROPOSED' }, data: { status: 'TRAVELER_APPROVED' } })
    if (claimed.count === 0) {
      const current = await prisma.recoveryPlan.findUnique({ where: { id: planId }, select: { status: true } })
      const message = current?.status === 'TRAVELER_APPROVED' ? 'This recovery plan is already awaiting operator approval.' : current?.status === 'APPROVED' ? 'This recovery plan has already been approved.' : current?.status === 'REJECTED' ? 'This recovery plan was already rejected and cannot be approved.' : 'This recovery plan has already been decided.'
      return response.status(409).json({ error: message })
    }
    await prisma.activityLog.create({ data: { userId: request.auth!.sub, action: 'RECOVERY_TRAVELER_APPROVED', metadata: { planId: plan.id, tripId } } })
    await notifyTrip(tripId, 'RECOVERY_PENDING', 'Recovery approval requested', 'The traveler selected a recovery option. An operator must approve it before itinerary changes are applied.'); publishEvent('recovery-traveler-approved', { tripId, planId: plan.id })
    return response.json({ plan: { id: plan.id, status: 'TRAVELER_APPROVED' } })
  }
  const approved = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const claimed = await tx.recoveryPlan.updateMany({ where: { id: planId, status: 'TRAVELER_APPROVED' }, data: { status: 'APPROVED' } })
    if (claimed.count === 0) return false
    const currentItems = await tx.itineraryItem.findMany({ where: { tripId }, include: { booking: true } }); await tx.itinerarySnapshot.upsert({ where: { disruptionId: plan.disruptionId }, create: { disruptionId: plan.disruptionId, itinerary: currentItems.map((item) => ({ id: item.id, inventoryItemId: item.inventoryItemId, type: item.type, title: item.title, startTime: item.startTime, endTime: item.endTime, location: item.location, cost: item.cost, vendorId: item.vendorId, status: item.status })), bookings: currentItems.flatMap((item) => item.booking ? [{ id: item.booking.id, vendorId: item.booking.vendorId, confirmationStatus: item.booking.confirmationStatus, paymentStatus: item.booking.paymentStatus, amount: item.booking.amount }] : []) }, update: {} })
    const changes = plan.changedItems as unknown as Array<{ itineraryItemId: string; replacementInventoryItemId: string; startTime: string; endTime: string }>
    // Defensive de-dupe: a recovery plan is only ever expected to touch a given itinerary
    // item once, but if a malformed/duplicated plan ever listed the same itineraryItemId
    // twice, processing it twice would run the refund/audit logic twice for one slot. The
    // Booking upsert below is already keyed on the unique itineraryItemId (so it can never
    // create two Booking rows for the same item), but de-duplicating here also stops the
    // redundant refund-audit writes that would otherwise happen for the second pass.
    const uniqueChanges = [...new Map(changes.map((change) => [change.itineraryItemId, change] as const)).values()]
    for (const change of uniqueChanges) {
      const inventory = await tx.inventoryItem.findUnique({ where: { id: change.replacementInventoryItemId } })
      if (!inventory) continue
      const existingBooking = await tx.booking.findUnique({ where: { itineraryItemId: change.itineraryItemId } })
      // Both the itinerary item and its replacement booking are derived from this one call so
      // they can never disagree (previously the booking's confirmationStatus was re-derived
      // from the itinerary item's just-written status, which was always true and made the
      // pairing look conditional when it never actually could branch).
      const { itemStatus, bookingStatus } = resolveReplacementStatus()
      await tx.itineraryItem.update({ where: { id: change.itineraryItemId }, data: { inventoryItemId: inventory.id, type: inventory.type, title: inventory.title, location: inventory.location, cost: inventory.price, vendorId: inventory.vendorId, startTime: new Date(change.startTime), endTime: new Date(change.endTime), status: itemStatus } })
      if (existingBooking) {
        if (existingBooking.paymentStatus === PaymentStatus.PAID) {
          await tx.booking.update({ where: { id: existingBooking.id }, data: { confirmationStatus: BookingStatus.CANCELLED, paymentStatus: PaymentStatus.REFUNDED } })
          await tx.paymentAudit.create({ data: { bookingId: existingBooking.id, event: 'RECOVERY_REFUND_REQUESTED', amount: existingBooking.amount, vendorId: existingBooking.vendorId, details: `Recovery plan ${plan.id} cancelled a paid booking.` } })
        } else {
          await tx.booking.update({ where: { id: existingBooking.id }, data: { confirmationStatus: BookingStatus.CANCELLED } })
        }
      }
      // itineraryItemId is @unique on Booking, so this upsert can only ever touch (or create)
      // a single row for this itinerary item -- it is not possible for a replacement to end up
      // with two Booking records.
      await tx.booking.upsert({ where: { itineraryItemId: change.itineraryItemId }, create: { itineraryItemId: change.itineraryItemId, vendorId: inventory.vendorId, amount: inventory.price, confirmationStatus: bookingStatus, paymentStatus: PaymentStatus.PENDING }, update: { vendorId: inventory.vendorId, amount: inventory.price, confirmationStatus: bookingStatus, paymentStatus: PaymentStatus.PENDING } })
    }
    await rebuildDependencies(tripId, tx); await tx.recoveryPlan.updateMany({ where: { disruptionId: plan.disruptionId, id: { not: plan.id } }, data: { status: 'REJECTED' } }); await tx.disruption.update({ where: { id: plan.disruptionId }, data: { status: 'RESOLVED' } }); await tx.activityLog.create({ data: { action: 'RECOVERY_APPROVED', metadata: { planId: plan.id, tripId } } })
    return true
  })
  if (!approved) {
    const current = await prisma.recoveryPlan.findUnique({ where: { id: planId }, select: { status: true } })
    const message = current?.status === 'PROPOSED' ? 'This recovery plan is awaiting the traveler’s approval before it can be confirmed.' : current?.status === 'APPROVED' ? 'This recovery plan has already been approved.' : current?.status === 'REJECTED' ? 'This recovery plan was already rejected and cannot be approved.' : 'This recovery plan has already been decided.'
    return response.status(409).json({ error: message })
  }
  await notifyTrip(tripId, 'RECOVERY_APPROVED', 'Recovery plan applied', 'A recovery plan has been approved and the affected itinerary has been updated.'); publishEvent('recovery-approved', { tripId, planId: plan.id }); return response.json({ plan: { id: plan.id, status: 'APPROVED' }, wallet: await tripSummary(tripId) })
}))
app.post('/api/recovery-plans/:id/revert', requireAuth, asyncRoute(async (request, response) => {
  const planId = request.params.id as string
  const plan = await prisma.recoveryPlan.findUnique({ where: { id: planId }, include: { disruption: { include: { snapshot: true, trip: true } } } }); if (!plan?.disruption.snapshot) return response.status(404).json({ error: 'No recovery snapshot is available to restore.' }); if (request.auth!.role === Role.TRAVELER && plan.disruption.trip.userId !== request.auth!.sub) return response.status(403).json({ error: 'Recovery plan access denied.' }); const tripId = plan.disruption.tripId; const items = plan.disruption.snapshot.itinerary as unknown as Array<{ id: string; inventoryItemId: string | null; type: ItemType; title: string; startTime: string; endTime: string; location: string; cost: number; vendorId: string | null; status: ItemStatus }>; const bookings = plan.disruption.snapshot.bookings as unknown as Array<{ id: string; vendorId: string; confirmationStatus: BookingStatus; paymentStatus: PaymentStatus; amount: number }>
  const reverted = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const claimed = await tx.recoveryPlan.updateMany({ where: { id: planId, status: 'APPROVED' }, data: { status: 'REJECTED' } })
    if (claimed.count === 0) return false
    for (const item of items) await tx.itineraryItem.update({ where: { id: item.id }, data: { inventoryItemId: item.inventoryItemId, type: item.type, title: item.title, startTime: new Date(item.startTime), endTime: new Date(item.endTime), location: item.location, cost: item.cost, vendorId: item.vendorId, status: item.status } }); for (const booking of bookings) await tx.booking.update({ where: { id: booking.id }, data: { vendorId: booking.vendorId, confirmationStatus: booking.confirmationStatus, paymentStatus: booking.paymentStatus, amount: booking.amount } })
    await rebuildDependencies(tripId, tx); await tx.disruption.update({ where: { id: plan.disruptionId }, data: { status: 'REVERTED' } }); await tx.activityLog.create({ data: { action: 'RECOVERY_REVERTED', metadata: { planId: plan.id, tripId } } })
    return true
  })
  if (!reverted) return response.status(409).json({ error: 'Only an approved recovery plan can be reverted.' })
  await notifyTrip(tripId, 'RECOVERY_REVERTED', 'Recovery plan reverted', 'The approved recovery plan was reverted and the prior itinerary was restored.'); publishEvent('recovery-reverted', { tripId, planId: plan.id }); return response.json({ plan: { id: plan.id, status: 'REVERTED' }, wallet: await tripSummary(tripId) })
}))

const marketplaceCategory = z.nativeEnum(ItemType)
const normalizedVendorCategory = (category: string) => category.trim().toLowerCase().replace(/[^a-z]/g, '')
const vendorMatchesCategory = (vendorCategory: string, itemType: ItemType) => {
  const value = normalizedVendorCategory(vendorCategory)
  const aliases: Record<ItemType, string[]> = {
    FLIGHT: ['flight', 'flights', 'air', 'airline', 'airtravel'],
    HOTEL: ['hotel', 'hotels', 'stay', 'accommodation', 'lodging'],
    ACTIVITY: ['activity', 'activities', 'experience', 'experiences', 'tour', 'tours'],
    TRANSFER: ['transfer', 'transfers', 'transport', 'transportation', 'pickup', 'groundtransport'],
  }
  return aliases[itemType].some((alias) => value === normalizedVendorCategory(alias)) || value.includes(normalizedVendorCategory(itemType))
}

app.post('/api/operator/slot-requests', requireAuth, allowRoles(Role.OPERATOR), asyncRoute(async (request, response) => {
  const data = z.object({ tripId: z.string().optional().nullable(), destination: z.string().trim().min(2), category: marketplaceCategory, dateNeeded: z.string().datetime(), budgetCap: z.number().positive() }).parse(request.body)
  if (data.tripId) {
    const trip = await prisma.trip.findUnique({ where: { id: data.tripId } })
    if (!trip) return response.status(404).json({ error: 'Trip not found.' })
  }
  const requestRecord = await prisma.openSlotRequest.create({ data: { operatorId: request.auth!.sub, tripId: data.tripId || null, destination: data.destination, category: data.category, dateNeeded: new Date(data.dateNeeded), budgetCap: data.budgetCap }, include: { bids: { include: { vendor: true }, orderBy: { createdAt: 'desc' } }, trip: true } })
  return response.status(201).json({ request: requestRecord })
}))

app.get('/api/operator/slot-requests', requireAuth, allowRoles(Role.OPERATOR), asyncRoute(async (request, response) => {
  const requests = await prisma.openSlotRequest.findMany({ where: { operatorId: request.auth!.sub }, include: { trip: true, bids: { include: { vendor: true }, orderBy: { createdAt: 'desc' } } }, orderBy: { createdAt: 'desc' } })
  return response.json({ requests })
}))

app.post('/api/operator/slot-requests/:id/award', requireAuth, allowRoles(Role.OPERATOR), asyncRoute(async (request, response) => {
  const data = z.object({ bidId: z.string() }).parse(request.body)
  const slot = await prisma.openSlotRequest.findUnique({ where: { id: request.params.id as string }, include: { bids: true } })
  if (!slot) return response.status(404).json({ error: 'Slot request not found.' })
  if (slot.operatorId !== request.auth!.sub) return response.status(403).json({ error: 'You can only award your own slot requests.' })
  if (slot.status !== 'OPEN') return response.status(409).json({ error: 'This slot request is no longer open.' })
  const bid = slot.bids.find((candidate) => candidate.id === data.bidId)
  if (!bid) return response.status(404).json({ error: 'Bid not found for this slot request.' })
  const result = await prisma.$transaction(async (tx) => {
    await tx.vendorBid.updateMany({ where: { slotRequestId: slot.id, id: { not: bid.id } }, data: { status: 'REJECTED' } })
    const accepted = await tx.vendorBid.update({ where: { id: bid.id }, data: { status: 'ACCEPTED' }, include: { vendor: true } })
    const inventory = await tx.inventoryItem.create({ data: { vendorId: accepted.vendorId, type: slot.category, title: `${slot.destination} · ${accepted.vendor.name} · ${slot.category[0] + slot.category.slice(1).toLowerCase()}`, location: slot.destination, price: accepted.price, availability: 'Awarded marketplace bid', tags: ['marketplace', 'vendor-bid', `slot-request:${slot.id}`, `date:${slot.dateNeeded.toISOString().slice(0,10)}`, `destination:${slot.destination.toLowerCase()}`], source: 'vendor-bid', bookable: true } })
    const updatedRequest = await tx.openSlotRequest.update({ where: { id: slot.id }, data: { status: 'AWARDED' }, include: { bids: { include: { vendor: true }, orderBy: { createdAt: 'desc' } }, trip: true } })
    return { accepted, inventory, request: updatedRequest }
  })
  return response.json(result)
}))

app.get('/api/vendor/slot-requests', requireAuth, allowRoles(Role.VENDOR), asyncRoute(async (request, response) => {
  const account = await prisma.user.findUnique({ where: { id: request.auth!.sub }, include: { vendor: true } })
  if (!account?.vendorId || !account.vendor) return response.status(422).json({ error: 'Your vendor account is not linked to a vendor profile.' })
  const openRequests = await prisma.openSlotRequest.findMany({ where: { status: 'OPEN' }, include: { trip: true, bids: { where: { vendorId: account.vendorId }, orderBy: { createdAt: 'desc' } } }, orderBy: { createdAt: 'desc' } })
  const requests = openRequests.filter((slot) => vendorMatchesCategory(account.vendor!.category, slot.category)).map((slot) => ({ ...slot, myBid: slot.bids[0] || null, bids: undefined }))
  return response.json({ requests })
}))

app.post('/api/vendor/slot-requests/:id/bid', requireAuth, allowRoles(Role.VENDOR), asyncRoute(async (request, response) => {
  const data = z.object({ price: z.number().positive(), notes: z.string().trim().max(1000).optional() }).parse(request.body)
  const account = await prisma.user.findUnique({ where: { id: request.auth!.sub }, include: { vendor: true } })
  if (!account?.vendorId || !account.vendor) return response.status(422).json({ error: 'Your vendor account is not linked to a vendor profile.' })
  const slot = await prisma.openSlotRequest.findUnique({ where: { id: request.params.id as string } })
  if (!slot) return response.status(404).json({ error: 'Slot request not found.' })
  if (slot.status !== 'OPEN') return response.status(409).json({ error: 'This slot request is no longer open.' })
  if (!vendorMatchesCategory(account.vendor.category, slot.category)) return response.status(403).json({ error: 'This request does not match your vendor category.' })
  const existing = await prisma.vendorBid.findFirst({ where: { slotRequestId: slot.id, vendorId: account.vendorId } })
  const bid = existing ? await prisma.vendorBid.update({ where: { id: existing.id }, data: { price: data.price, notes: data.notes, status: 'PENDING' }, include: { vendor: true } }) : await prisma.vendorBid.create({ data: { slotRequestId: slot.id, vendorId: account.vendorId, price: data.price, notes: data.notes }, include: { vendor: true } })
  return response.status(existing ? 200 : 201).json({ bid })
}))

app.get('/api/vendors', requireAuth, asyncRoute(async (_request, response) => response.json({ vendors: await prisma.vendor.findMany({ include: { user: { select: { name: true, email: true, phone: true } } }, orderBy: { reliabilityScore: 'desc' } }) })))
app.get('/api/inventory', requireAuth, asyncRoute(async (request, response) => { const tripId = typeof request.query.tripId === 'string' ? request.query.tripId : undefined; const trip = tripId ? await findAccessibleTrip(tripId, request, response) : null; if (tripId && !trip) return; if (trip) { const inventory = await getDestinationInventory(prisma, { destination: trip.destination }); return response.json({ inventory }) } const inventory = await prisma.inventoryItem.findMany({ where: { availability: { not: 'Unavailable' } }, include: { vendor: true }, orderBy: { price: 'asc' } }); return response.json({ inventory }) }))
app.post('/api/vendors', requireAuth, allowRoles(Role.OPERATOR, Role.ADMIN), asyncRoute(async (request, response) => { const data = z.object({ name: z.string().min(2), category: z.string().min(2), availability: z.string().min(2), priceRange: z.string().min(2), reliabilityScore: z.number().min(0).max(100), confirmationRate: z.number().min(0).max(100), cancellationRate: z.number().min(0).max(100), responseTime: z.number().int().nonnegative() }).parse(request.body); const vendor = await prisma.vendor.create({ data }); return response.status(201).json({ vendor }) }))
app.patch('/api/vendors/:id', requireAuth, allowRoles(Role.OPERATOR, Role.VENDOR, Role.ADMIN), asyncRoute(async (request, response) => { const data = z.object({ availability: z.string().min(2).optional(), priceRange: z.string().min(2).optional(), reliabilityScore: z.number().min(0).max(100).optional(), confirmationRate: z.number().min(0).max(100).optional(), cancellationRate: z.number().min(0).max(100).optional(), responseTime: z.number().int().nonnegative().optional() }).parse(request.body); const vendorId = request.params.id as string; if (request.auth!.role === Role.VENDOR) { const account = await prisma.user.findUnique({ where: { id: request.auth!.sub } }); if (account?.vendorId !== vendorId) return response.status(403).json({ error: 'You can only modify your own vendor record.' }) } const vendor = await prisma.vendor.update({ where: { id: vendorId }, data }); return response.json({ vendor }) }))
app.get('/api/bookings', requireAuth, asyncRoute(async (request, response) => { const where = request.auth!.role === Role.TRAVELER ? { itineraryItem: { trip: { userId: request.auth!.sub } } } : {}; return response.json({ bookings: await prisma.booking.findMany({ where, include: { vendor: true, itineraryItem: { include: { trip: true } } }, orderBy: { createdAt: 'desc' } }) }) }))
app.get('/api/trips/:id/wallet', requireAuth, asyncRoute(async (request, response) => { const trip = await findAccessibleTrip(request.params.id as string, request, response); if (!trip) return; return response.json({ wallet: await tripSummary(trip.id) }) }))
app.get('/api/trips/:id/currency-summary', requireAuth, asyncRoute(async (request, response) => {
  const trip = await findAccessibleTrip(request.params.id as string, request, response); if (!trip) return
  const user = await prisma.user.findUnique({ where: { id: trip.userId }, select: { preferences: true } })
  const preferred = user?.preferences && typeof user.preferences === 'object' && !Array.isArray(user.preferences) ? (user.preferences as Record<string, unknown>).homeCurrency : undefined
  const homeCurrency = typeof preferred === 'string' && /^[A-Za-z]{3}$/.test(preferred) ? preferred.toUpperCase() : (process.env.HOME_CURRENCY || 'INR').toUpperCase()
  const items = await prisma.itineraryItem.findMany({ where: { tripId: trip.id }, include: { inventoryItem: { select: { tags: true } } }, orderBy: { startTime: 'asc' } })
  const converted = await Promise.all(items.map(async (item) => {
    const currency = currencyFromTags(item.inventoryItem?.tags, homeCurrency)
    try { const fx = await getDailyFxRate(prisma, currency, homeCurrency); return { itineraryItemId: item.id, nativeAmount: item.cost, currency, convertedAmount: Number((item.cost * fx.rate).toFixed(2)), rate: fx.rate, rateDate: fx.asOf, rateCached: fx.cached } }
    catch { return { itineraryItemId: item.id, nativeAmount: item.cost, currency, convertedAmount: null, rate: null, rateDate: null, rateCached: false } }
  }))
  return response.json({ homeCurrency, subtotal: Number(converted.reduce((sum, item) => sum + (item.convertedAmount || 0), 0).toFixed(2)), unavailableConversions: converted.filter((item) => item.convertedAmount === null).length, items: converted })
}))
// Marks the given itinerary items/bookings as paid+confirmed and finalizes the trip. Shared by the
// synchronous success path (Simulated/Stripe) and the async verify path (Razorpay), so both end up
// building the exact same confirmation response.
async function finalizeCheckout(trip: { id: string; userId: string; user: { name: string; email: string }; destination: string; startDate: Date; endDate: Date }, bookable: Array<{ id: string; title: string; cost: number; startTime: Date; vendorId: string | null; vendor: { name: string } | null; booking: { id: string } | null }>, providerName: string, providerRef: string) {
  const bookings = await prisma.$transaction(bookable.map((item) => item.booking ? prisma.booking.update({ where: { id: item.booking.id }, data: { vendorId: item.vendorId!, amount: item.cost, confirmationStatus: BookingStatus.CONFIRMED, paymentStatus: PaymentStatus.PAID } }) : prisma.booking.create({ data: { itineraryItemId: item.id, vendorId: item.vendorId!, amount: item.cost, confirmationStatus: BookingStatus.CONFIRMED, paymentStatus: PaymentStatus.PAID } })))
  await Promise.all(bookings.map((booking) => prisma.paymentAudit.create({ data: { bookingId: booking.id, event: 'CHECKOUT_PAID', amount: booking.amount, vendorId: booking.vendorId, details: JSON.stringify({ provider: providerName, providerRef }) } })))
  await prisma.itineraryItem.updateMany({ where: { id: { in: bookable.map((item) => item.id) } }, data: { status: ItemStatus.CONFIRMED } }); await prisma.trip.update({ where: { id: trip.id }, data: { status: 'BOOKED' } }); await prisma.activityLog.create({ data: { userId: trip.userId, action: 'TRIP_CHECKOUT_PAID', metadata: { tripId: trip.id, bookingIds: bookings.map((booking) => booking.id), provider: providerName } } }); publishEvent('checkout-completed', { tripId: trip.id })
  return { confirmation: { traveler: { name: trip.user.name, email: trip.user.email }, destination: trip.destination, startDate: trip.startDate, endDate: trip.endDate, itinerary: bookable.map((item) => ({ id: item.id, title: item.title, vendor: item.vendor?.name || 'Verified vendor', amount: item.cost, startTime: item.startTime })), bookings: bookings.map((booking) => ({ id: booking.id, itineraryItemId: booking.itineraryItemId, vendorId: booking.vendorId, amount: booking.amount, confirmationStatus: booking.confirmationStatus, paymentStatus: booking.paymentStatus })), totalCost: bookable.reduce((sum, item) => sum + item.cost, 0), wallet: await tripSummary(trip.id) } }
}

app.post('/api/trips/:id/checkout', requireAuth, allowRoles(Role.TRAVELER), asyncRoute(async (request, response) => {
  const trip = await prisma.trip.findUnique({ where: { id: (request.params.id as string) }, include: { user: true, items: { include: { vendor: true, booking: true, inventoryItem: true }, orderBy: { startTime: 'asc' } } } })
  if (!trip) return response.status(404).json({ error: 'Trip not found.' })
  if (trip.userId !== request.auth!.sub) return response.status(403).json({ error: 'Trip access denied.' })
  if (trip.approvalStatus !== 'APPROVED') return response.status(409).json({ error: 'Payment is locked until an admin approves the finalized trip.' })
  const eligible = trip.items.filter((item) => item.vendorId && item.status !== ItemStatus.CANCELLED && item.inventoryItem?.bookable !== false)
  if (!eligible.length) return response.status(422).json({ error: 'There are no bookable itinerary items.' })
  // Only charge/record items that are not already fully paid, so re-running checkout after adding a new
  // itinerary item (or refreshing the confirmation page) never re-books or re-audits work that already happened.
  const bookable = eligible.filter((item) => item.booking?.paymentStatus !== PaymentStatus.PAID)
  if (!bookable.length) return response.status(409).json({ error: 'This trip has already been checked out.' })
  const totalCost = bookable.reduce((sum, item) => sum + item.cost, 0)
  const provider = getActivePaymentProvider()
  const charge = await provider.charge({ amount: totalCost, currency: 'INR', receipt: trip.id, notes: { tripId: trip.id, userId: trip.userId } })

  if (charge.status === 'FAILED') {
    return response.status(402).json({ error: `Payment via ${provider.name} was not successful: ${charge.reason}`, provider: provider.name })
  }

  if (charge.status === 'PENDING_VERIFICATION') {
    // Razorpay: create/refresh the bookings as PENDING and record the order, but do NOT confirm the
    // trip yet - that only happens once the client completes Razorpay Checkout and we verify the
    // payment signature via POST /api/trips/:id/checkout/verify.
    const bookings = await prisma.$transaction(bookable.map((item) => item.booking ? prisma.booking.update({ where: { id: item.booking.id }, data: { vendorId: item.vendorId!, amount: item.cost, confirmationStatus: BookingStatus.PENDING, paymentStatus: PaymentStatus.PENDING } }) : prisma.booking.create({ data: { itineraryItemId: item.id, vendorId: item.vendorId!, amount: item.cost, confirmationStatus: BookingStatus.PENDING, paymentStatus: PaymentStatus.PENDING } })))
    await Promise.all(bookings.map((booking) => prisma.paymentAudit.create({ data: { bookingId: booking.id, event: 'ORDER_CREATED', amount: booking.amount, vendorId: booking.vendorId, details: JSON.stringify({ provider: provider.name, orderId: charge.checkout.orderId }) } })))
    return response.status(202).json({ requiresPaymentVerification: true, provider: provider.name, checkout: charge.checkout, tripId: trip.id, totalCost })
  }

  const result = await finalizeCheckout(trip, bookable, provider.name, charge.providerRef)
  return response.json(result)
}))

app.post('/api/trips/:id/checkout/verify', requireAuth, allowRoles(Role.TRAVELER), asyncRoute(async (request, response) => {
  const data = z.object({ orderId: z.string().min(1), paymentId: z.string().min(1), signature: z.string().min(1) }).parse(request.body)
  const trip = await prisma.trip.findUnique({ where: { id: (request.params.id as string) }, include: { user: true, items: { include: { vendor: true, booking: true, inventoryItem: true }, orderBy: { startTime: 'asc' } } } })
  if (!trip) return response.status(404).json({ error: 'Trip not found.' })
  if (trip.userId !== request.auth!.sub) return response.status(403).json({ error: 'Trip access denied.' })
  if (!verifyRazorpaySignature(data.orderId, data.paymentId, data.signature)) return response.status(400).json({ error: 'Payment signature verification failed.' })

  // Only the items whose ORDER_CREATED audit matches this exact order should be confirmed - this
  // keeps a stale/replayed verify call from confirming a different checkout attempt.
  const bookable = trip.items.filter((item) => item.booking?.confirmationStatus === BookingStatus.PENDING && item.booking?.paymentStatus === PaymentStatus.PENDING)
  const pending = await prisma.paymentAudit.findMany({ where: { bookingId: { in: bookable.flatMap((item) => item.booking ? [item.booking.id] : []) }, event: 'ORDER_CREATED' } })
  const matchesOrder = new Set(pending.filter((audit) => { try { return JSON.parse(audit.details || '{}').orderId === data.orderId } catch { return false } }).map((audit) => audit.bookingId))
  const matched = bookable.filter((item) => item.booking && matchesOrder.has(item.booking.id))
  if (!matched.length) return response.status(409).json({ error: 'No pending checkout matches this order.' })

  const result = await finalizeCheckout(trip, matched, 'Razorpay', data.paymentId)
  return response.json(result)
}))
app.post('/api/bookings', requireAuth, asyncRoute(async (request, response) => { const data = z.object({ itineraryItemId: z.string(), vendorId: z.string(), confirmationStatus: z.nativeEnum(BookingStatus).default('PENDING'), paymentStatus: z.nativeEnum(PaymentStatus).default('PENDING'), amount: z.number().positive() }).parse(request.body); const itineraryItem = await prisma.itineraryItem.findUnique({ where: { id: data.itineraryItemId }, include: { trip: true, inventoryItem: true } }); if (!itineraryItem) return response.status(404).json({ error: 'Itinerary item not found.' }); if (request.auth!.role === Role.TRAVELER && itineraryItem.trip.userId !== request.auth!.sub) return response.status(403).json({ error: 'You cannot create a booking for another traveler\'s itinerary item.' }); if (itineraryItem.inventoryItem?.bookable === false) return response.status(422).json({ error: 'Discovered places are recommendations and cannot be booked.' }); const booking = await prisma.booking.create({ data }); return response.status(201).json({ booking }) }))
// ---- In-trip safety / Assist layer ----
app.post('/api/trips/:id/sos', requireAuth, allowRoles(Role.TRAVELER), asyncRoute(async (request, response) => {
  const input = z.object({ itineraryItemId: z.string().optional(), lat: z.number().min(-90).max(90).nullable().optional(), lng: z.number().min(-180).max(180).nullable().optional(), message: z.string().max(500).nullable().optional() }).parse(request.body)
  const trip = await prisma.trip.findUnique({ where: { id: request.params.id as string }, include: { items: true } })
  if (!trip) return response.status(404).json({ error: 'Trip not found.' })
  if (trip.userId !== request.auth!.sub) return response.status(403).json({ error: 'Trip access denied.' })
  if (input.itineraryItemId && !trip.items.some((item) => item.id === input.itineraryItemId)) return response.status(400).json({ error: 'Itinerary item does not belong to this trip.' })
  const alert = await prisma.sosAlert.create({ data: { tripId: trip.id, userId: request.auth!.sub, itineraryItemId: input.itineraryItemId, lat: input.lat ?? null, lng: input.lng ?? null, message: input.message ?? null } })
  await notifySosStakeholders(prisma, publishNotification, trip.id, 'SOS alert', `${trip.destination}: a traveler requested urgent assistance.`)
  publishEvent('sos-created', { tripId: trip.id, alertId: alert.id, status: alert.status })
  return response.status(201).json({ alert })
}))

app.get('/api/trips/:id/sos', requireAuth, allowRoles(Role.TRAVELER), asyncRoute(async (request, response) => {
  const trip = await findAccessibleTrip(request.params.id as string, request, response); if (!trip) return
  const alert = await prisma.sosAlert.findFirst({ where: { tripId: trip.id, userId: request.auth!.sub }, orderBy: { createdAt: 'desc' } })
  return response.json({ alert })
}))

app.patch('/api/trips/:id/sos/:alertId', requireAuth, allowRoles(Role.OPERATOR, Role.COORDINATOR), asyncRoute(async (request, response) => {
  const input = z.object({ status: z.enum(['ACKNOWLEDGED', 'RESOLVED']) }).parse(request.body)
  const alert = await prisma.sosAlert.findUnique({ where: { id: request.params.alertId as string }, include: { trip: true } })
  if (!alert || alert.tripId !== request.params.id) return response.status(404).json({ error: 'SOS alert not found.' })
  if (request.auth!.role === Role.COORDINATOR && alert.trip.coordinatorId !== request.auth!.sub) return response.status(403).json({ error: 'Only the assigned coordinator can manage this alert.' })
  const updated = await prisma.sosAlert.update({ where: { id: alert.id }, data: { status: input.status, resolvedAt: input.status === 'RESOLVED' ? new Date() : null } })
  publishEvent('sos-updated', { tripId: alert.tripId, alertId: alert.id, status: updated.status })
  return response.json({ alert: updated })
}))

app.get('/api/trips/:id/nearby-help', requireAuth, asyncRoute(async (request, response) => {
  const trip = await findAccessibleTrip(request.params.id as string, request, response); if (!trip) return
  const latest = await prisma.sosAlert.findFirst({ where: { tripId: trip.id, lat: { not: null }, lng: { not: null } }, orderBy: { createdAt: 'desc' }, select: { lat: true, lng: true } })
  try {
    const results = await resolveTripHelp({ lat: latest?.lat, lng: latest?.lng }, trip.destination)
    return response.json({ results })
  } catch (error) {
    return response.status(503).json({ error: error instanceof Error ? error.message : 'Nearby help is temporarily unavailable.', results: [] })
  }
}))

app.get('/api/operator/sos-alerts', requireAuth, allowRoles(Role.OPERATOR), asyncRoute(async (_request, response) => {
  const alerts = await prisma.sosAlert.findMany({ include: { user: true, trip: { select: { id: true, destination: true, user: { select: { name: true } } } }, itineraryItem: { select: { id: true, title: true } } }, orderBy: { createdAt: 'desc' }, take: 100 })
  return response.json({ alerts })
}))

// ---- Traveler group collaboration + activity voting ----
async function findTripGroup(tripId: string, request: Request, response: Response) {
  const trip = await prisma.trip.findUnique({ where: { id: tripId } })
  if (!trip) { response.status(404).json({ error: 'Trip not found.' }); return null }
  const group = await prisma.tourGroup.findFirst({ where: { tripId }, include: { participants: { include: { user: true } } }, orderBy: { createdAt: 'asc' } })
  if (!group) { response.status(404).json({ error: 'No group has been created for this trip yet.' }); return null }
  const isOwner = trip.userId === request.auth!.sub
  const isParticipant = group.participants.some((participant) => participant.userId === request.auth!.sub)
  if (!isOwner && !isParticipant && request.auth!.role === Role.TRAVELER) { response.status(403).json({ error: 'You are not a participant in this trip group.' }); return null }
  return { trip, group }
}
app.post('/api/trips/:id/group/invite', requireAuth, allowRoles(Role.TRAVELER, Role.OPERATOR, Role.COORDINATOR), asyncRoute(async (request, response) => {
  const input = z.object({ email: z.string().email() }).parse(request.body)
  const found = await findTripGroup(request.params.id as string, request, response); if (!found) return
  if (request.auth!.role === Role.TRAVELER && found.trip.userId !== request.auth!.sub) return response.status(403).json({ error: 'Only the trip owner can invite travelers.' })
  const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } })
  if (!user || user.role !== Role.TRAVELER) return response.status(404).json({ error: 'No traveler account was found for that email.' })
  const participant = await prisma.groupParticipant.upsert({ where: { tourGroupId_userId: { tourGroupId: found.group.id, userId: user.id } }, create: { tourGroupId: found.group.id, userId: user.id, status: GroupParticipantStatus.INVITED }, update: { status: GroupParticipantStatus.INVITED }, include: { user: true } })
  const notification = await prisma.notification.create({ data: { userId: user.id, type: 'GROUP_INVITE', title: `Invitation to ${found.group.name}`, message: `You have been invited to join the ${found.group.name} trip group for ${found.trip.destination}.`, tripId: found.trip.id } })
  publishNotification(user.id, notification); publishEvent('group-updated', { tripId: found.trip.id, groupId: found.group.id })
  return response.status(201).json({ participant: { id: participant.id, status: participant.status, user: { id: participant.user.id, name: participant.user.name, email: participant.user.email } } })
}))
app.post('/api/trips/:id/group/respond', requireAuth, allowRoles(Role.TRAVELER), asyncRoute(async (request, response) => {
  const input = z.object({ response: z.enum(['accept', 'decline']) }).parse(request.body)
  const found = await findTripGroup(request.params.id as string, request, response); if (!found) return
  const participant = found.group.participants.find((entry) => entry.userId === request.auth!.sub)
  if (!participant) return response.status(403).json({ error: 'You do not have a pending group invitation.' })
  const status = input.response === 'accept' ? GroupParticipantStatus.CONFIRMED : GroupParticipantStatus.DECLINED
  const updated = await prisma.groupParticipant.update({ where: { id: participant.id }, data: { status }, include: { user: true } })
  publishEvent('group-updated', { tripId: found.trip.id, groupId: found.group.id, participantId: updated.id, status })
  return response.json({ participant: { id: updated.id, status: updated.status, user: { id: updated.user.id, name: updated.user.name, email: updated.user.email } } })
}))
app.get('/api/trips/:id/group', requireAuth, allowRoles(Role.TRAVELER, Role.OPERATOR, Role.COORDINATOR), asyncRoute(async (request, response) => {
  const found = await findTripGroup(request.params.id as string, request, response); if (!found) return
  return response.json({ group: { id: found.group.id, name: found.group.name, participants: found.group.participants.map((participant) => ({ id: participant.id, status: participant.status, shareWeight: participant.shareWeight, user: { id: participant.user.id, name: participant.user.name, email: participant.user.email } })) } })
}))
async function assertGroupParticipantForTrip(tripId: string, userId: string) {
  const group = await prisma.tourGroup.findFirst({ where: { tripId }, include: { participants: true } })
  return group && group.participants.some((participant) => participant.userId === userId && participant.status === GroupParticipantStatus.CONFIRMED) ? group : null
}
app.post('/api/trips/:id/items/:itemId/vote', requireAuth, allowRoles(Role.TRAVELER), asyncRoute(async (request, response) => {
  const tripId = request.params.id as string, itemId = request.params.itemId as string
  const input = z.object({ candidateInventoryId: z.string(), vote: z.enum(['YES', 'NO']) }).parse(request.body)
  const trip = await prisma.trip.findUnique({ where: { id: tripId } }); if (!trip) return response.status(404).json({ error: 'Trip not found.' })
  const item = await prisma.itineraryItem.findFirst({ where: { id: itemId, tripId } }); if (!item) return response.status(404).json({ error: 'Itinerary item not found.' })
  if (!(await assertGroupParticipantForTrip(tripId, request.auth!.sub))) return response.status(403).json({ error: 'Only confirmed group participants can vote.' })
  const candidate = await prisma.inventoryItem.findUnique({ where: { id: input.candidateInventoryId } }); if (!candidate) return response.status(404).json({ error: 'Candidate inventory not found.' })
  if (candidate.type !== item.type || candidate.id === item.inventoryItemId) return response.status(422).json({ error: 'Candidate is not a valid alternative for this itinerary item.' })
  const existing = await prisma.activityVote.findFirst({ where: { tripId, itineraryItemId: itemId, candidateInventoryId: candidate.id, userId: request.auth!.sub } })
  const vote = existing ? await prisma.activityVote.update({ where: { id: existing.id }, data: { vote: input.vote } }) : await prisma.activityVote.create({ data: { tripId, itineraryItemId: itemId, candidateInventoryId: candidate.id, userId: request.auth!.sub, vote: input.vote } })
  publishEvent('group-vote-updated', { tripId, itemId }); return response.status(existing ? 200 : 201).json({ vote })
}))
app.get('/api/trips/:id/items/:itemId/votes', requireAuth, allowRoles(Role.TRAVELER, Role.OPERATOR, Role.COORDINATOR), asyncRoute(async (request, response) => {
  const tripId = request.params.id as string, itemId = request.params.itemId as string
  const found = await findTripGroup(tripId, request, response); if (!found) return
  const item = await prisma.itineraryItem.findFirst({ where: { id: itemId, tripId } }); if (!item) return response.status(404).json({ error: 'Itinerary item not found.' })
  const votes = await prisma.activityVote.findMany({ where: { tripId, itineraryItemId: itemId }, include: { candidateInventory: true }, orderBy: { createdAt: 'asc' } })
  const tally = Object.values(votes.reduce<Record<string, { candidateInventoryId: string; title: string; yes: number; no: number }>>((all, vote) => { if (!vote.candidateInventoryId) return all; const key = vote.candidateInventoryId; const row = all[key] || { candidateInventoryId: key, title: vote.candidateInventory?.title || 'Candidate', yes: 0, no: 0 }; if (vote.vote === 'YES') row.yes += 1; else row.no += 1; all[key] = row; return all }, {}))
  return response.json({ tally, suggestion: tally.slice().sort((a, b) => (b.yes - b.no) - (a.yes - a.no))[0] || null })
}))
// ---- Prepare stage: checklist (documents / packing / reminders) ----
app.get('/api/trips/:id/checklist', requireAuth, asyncRoute(async (request, response) => {
  const trip = await findAccessibleTrip(request.params.id as string, request, response); if (!trip) return
  const existing = await prisma.tripChecklistItem.findMany({ where: { tripId: trip.id }, orderBy: [{ category: 'asc' }, { createdAt: 'asc' }] })
  if (existing.length) return response.json({ items: existing })
  const [tripWithUser, itineraryItems, weatherDisruptions] = await Promise.all([
    prisma.trip.findUniqueOrThrow({ where: { id: trip.id }, include: { user: { select: { preferences: true } } } }),
    prisma.itineraryItem.findMany({ where: { tripId: trip.id }, select: { type: true, title: true } }),
    prisma.disruption.findMany({ where: { tripId: trip.id, type: 'WEATHER' }, select: { details: true, timestamp: true } }),
  ])
  const weatherForecast: ChecklistWeatherSignal[] = weatherDisruptions.map((disruption) => ({ date: disruption.timestamp.toISOString().slice(0, 10), reasons: [disruption.details] }))
  const generated = generateChecklist(tripWithUser, weatherForecast, itineraryItems)
  if (!generated.length) return response.json({ items: [] })
  await prisma.tripChecklistItem.createMany({ data: generated.map((item) => ({ tripId: trip.id, category: item.category, label: item.label, source: 'AUTO' })) })
  const items = await prisma.tripChecklistItem.findMany({ where: { tripId: trip.id }, orderBy: [{ category: 'asc' }, { createdAt: 'asc' }] })
  return response.json({ items })
}))

app.patch('/api/trips/:id/checklist/:itemId', requireAuth, asyncRoute(async (request, response) => {
  const input = z.object({ isDone: z.boolean() }).parse(request.body)
  const trip = await findAccessibleTrip(request.params.id as string, request, response); if (!trip) return
  const item = await prisma.tripChecklistItem.findFirst({ where: { id: request.params.itemId as string, tripId: trip.id } })
  if (!item) return response.status(404).json({ error: 'Checklist item not found.' })
  const updated = await prisma.tripChecklistItem.update({ where: { id: item.id }, data: { isDone: input.isDone } })
  return response.json({ item: updated })
}))

app.post('/api/trips/:id/checklist', requireAuth, asyncRoute(async (request, response) => {
  const input = z.object({ category: z.enum(['DOCUMENT', 'PACKING', 'REMINDER']), label: z.string().min(1).max(200) }).parse(request.body)
  const trip = await findAccessibleTrip(request.params.id as string, request, response); if (!trip) return
  const item = await prisma.tripChecklistItem.create({ data: { tripId: trip.id, category: input.category, label: input.label, source: 'MANUAL' } })
  return response.status(201).json({ item })
}))

app.get('/api/operator/payments', requireAuth, allowRoles(Role.OPERATOR), asyncRoute(async (_request, response) => {
  const bookings = await prisma.booking.findMany({ include: { vendor: true, itineraryItem: { include: { trip: true } }, paymentAudits: { orderBy: { createdAt: 'desc' } } }, orderBy: { createdAt: 'desc' } })
  const paid = bookings.filter((booking) => booking.paymentStatus === PaymentStatus.PAID).reduce((sum, booking) => sum + booking.amount, 0); const pending = bookings.filter((booking) => booking.paymentStatus === PaymentStatus.PENDING).reduce((sum, booking) => sum + booking.amount, 0); const refunds = bookings.filter((booking) => booking.paymentStatus === PaymentStatus.REFUNDED).reduce((sum, booking) => sum + booking.amount, 0)
  const settlements = Object.values(bookings.reduce<Record<string, { vendor: string; paid: number; pending: number; refunded: number }>>((all, booking) => { const key = booking.vendorId; const settlement = all[key] || { vendor: booking.vendor.name, paid: 0, pending: 0, refunded: 0 }; if (booking.paymentStatus === PaymentStatus.PAID) settlement.paid += booking.amount; if (booking.paymentStatus === PaymentStatus.PENDING) settlement.pending += booking.amount; if (booking.paymentStatus === PaymentStatus.REFUNDED) settlement.refunded += booking.amount; all[key] = settlement; return all }, {}))
  return response.json({ kpis: { totalPaid: paid, totalPending: pending, refundsInProgress: refunds }, bookings: bookings.map((booking) => ({ id: booking.id, vendor: booking.vendor.name, tourReference: booking.itineraryItem.tripId, amount: booking.amount, confirmationStatus: booking.confirmationStatus, paymentStatus: booking.paymentStatus, date: booking.createdAt, auditEvents: booking.paymentAudits })), settlements })
}))

// ---- Tour Groups: shared, operator-owned itineraries for multi-traveler tours ----
// Additive surface built on the TourGroup/GroupParticipant models. A COORDINATOR only ever sees
// groups explicitly assigned to them (mirrors the Trip.coordinatorId guard above); an OPERATOR has
// full access, matching every other operator-scoped route in this file.
function serializeGroup(group: Prisma.TourGroupGetPayload<{ include: { trip: true; operator: true; coordinator: true; participants: { include: { user: true } } } }>) {
  return {
    id: group.id,
    name: group.name,
    trip: { id: group.trip.id, destination: group.trip.destination, startDate: group.trip.startDate, endDate: group.trip.endDate, status: group.trip.status },
    operator: { id: group.operator.id, name: group.operator.name, email: group.operator.email },
    coordinator: group.coordinator ? { id: group.coordinator.id, name: group.coordinator.name, email: group.coordinator.email } : null,
    // "itinerary status" per participant: where each traveler stands relative to the group's shared
    // itinerary (still invited, confirmed onto it, or declined it).
    participants: group.participants.map((participant) => ({ id: participant.id, status: participant.status, itineraryStatus: participant.status, user: { id: participant.user.id, name: participant.user.name, email: participant.user.email } })),
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  }
}
const groupInclude = { trip: true, operator: true, coordinator: true, participants: { include: { user: true } } } satisfies Prisma.TourGroupInclude
async function findAccessibleGroup(groupId: string, request: Request, response: Response) {
  const group = await prisma.tourGroup.findUnique({ where: { id: groupId }, include: groupInclude })
  if (!group) { response.status(404).json({ error: 'Group not found.' }); return null }
  if (request.auth!.role === Role.COORDINATOR && group.coordinatorId !== request.auth!.sub) { response.status(403).json({ error: 'Group access denied.' }); return null }
  return group
}
async function assertCoordinator(coordinatorId: string) {
  const coordinator = await prisma.user.findUnique({ where: { id: coordinatorId } })
  return coordinator && coordinator.role === Role.COORDINATOR
}
app.post('/api/groups', requireAuth, allowRoles(Role.OPERATOR), asyncRoute(async (request, response) => {
  const data = z.object({ tripId: z.string(), name: z.string().trim().min(2), coordinatorId: z.string().nullable().optional() }).parse(request.body)
  const trip = await prisma.trip.findUnique({ where: { id: data.tripId } })
  if (!trip) return response.status(404).json({ error: 'Trip not found.' })
  if (data.coordinatorId && !(await assertCoordinator(data.coordinatorId))) return response.status(422).json({ error: 'coordinatorId must reference a user with the COORDINATOR role.' })
  const group = await prisma.tourGroup.create({ data: { tripId: data.tripId, name: data.name, operatorId: request.auth!.sub, coordinatorId: data.coordinatorId ?? null }, include: groupInclude })
  return response.status(201).json({ group: serializeGroup(group) })
}))
app.get('/api/groups', requireAuth, allowRoles(Role.OPERATOR, Role.COORDINATOR), asyncRoute(async (request, response) => {
  const where = request.auth!.role === Role.COORDINATOR ? { coordinatorId: request.auth!.sub } : {}
  const groups = await prisma.tourGroup.findMany({ where, include: groupInclude, orderBy: { updatedAt: 'desc' } })
  return response.json({ groups: groups.map(serializeGroup) })
}))
app.get('/api/groups/:id', requireAuth, allowRoles(Role.OPERATOR, Role.COORDINATOR), asyncRoute(async (request, response) => {
  const group = await findAccessibleGroup(request.params.id as string, request, response); if (!group) return
  return response.json({ group: serializeGroup(group) })
}))
app.patch('/api/groups/:id/coordinator', requireAuth, allowRoles(Role.OPERATOR), asyncRoute(async (request, response) => {
  const data = z.object({ coordinatorId: z.string().nullable() }).parse(request.body)
  const group = await prisma.tourGroup.findUnique({ where: { id: request.params.id as string } })
  if (!group) return response.status(404).json({ error: 'Group not found.' })
  if (data.coordinatorId && !(await assertCoordinator(data.coordinatorId))) return response.status(422).json({ error: 'coordinatorId must reference a user with the COORDINATOR role.' })
  const updated = await prisma.tourGroup.update({ where: { id: group.id }, data: { coordinatorId: data.coordinatorId }, include: groupInclude })
  return response.json({ group: serializeGroup(updated) })
}))
app.post('/api/groups/:id/participants', requireAuth, allowRoles(Role.OPERATOR, Role.COORDINATOR), asyncRoute(async (request, response) => {
  const data = z.object({ userId: z.string(), status: z.nativeEnum(GroupParticipantStatus).optional() }).parse(request.body)
  const group = await findAccessibleGroup(request.params.id as string, request, response); if (!group) return
  const traveler = await prisma.user.findUnique({ where: { id: data.userId } })
  if (!traveler || traveler.role !== Role.TRAVELER) return response.status(422).json({ error: 'userId must reference a user with the TRAVELER role.' })
  const participant = await prisma.groupParticipant.upsert({ where: { tourGroupId_userId: { tourGroupId: group.id, userId: data.userId } }, create: { tourGroupId: group.id, userId: data.userId, status: data.status ?? GroupParticipantStatus.INVITED }, update: { status: data.status ?? GroupParticipantStatus.INVITED }, include: { user: true } })
  return response.status(201).json({ participant: { id: participant.id, status: participant.status, itineraryStatus: participant.status, user: { id: participant.user.id, name: participant.user.name, email: participant.user.email } } })
}))
// Minimal directory lookup so an operator can populate a coordinator picker without a full user-admin
// surface; scoped to OPERATOR and to a single role filter to avoid leaking the whole user table.
app.get('/api/users', requireAuth, allowRoles(Role.OPERATOR), asyncRoute(async (request, response) => {
  const roleFilter = typeof request.query.role === 'string' ? request.query.role.toUpperCase() : undefined
  if (roleFilter && !(Object.values(Role) as string[]).includes(roleFilter)) return response.status(400).json({ error: 'Unknown role filter.' })
  const users = await prisma.user.findMany({ where: roleFilter ? { role: roleFilter as Role } : {}, select: { id: true, name: true, email: true, role: true }, orderBy: { name: 'asc' } })
  return response.json({ users })
}))

// Automated traveler safety heatmap. The server aggregates reports into ~150m cells;
// Groq is the decision-maker for SAFE/CAUTION/UNSAFE. Admin can observe the output but cannot override it.
const SAFETY_CELL_SIZE = 0.00135
const safetyCell = (lat: number, lng: number) => {
  const latCell = Math.floor(lat / SAFETY_CELL_SIZE)
  const lngCell = Math.floor(lng / SAFETY_CELL_SIZE)
  return { key: `${latCell}:${lngCell}`, centerLat: (latCell + 0.5) * SAFETY_CELL_SIZE, centerLng: (lngCell + 0.5) * SAFETY_CELL_SIZE }
}
const safetyReportSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  tripId: z.string().min(1).optional(),
  category: z.string().trim().min(2).max(60).optional(),
  message: z.string().trim().max(500).optional(),
})

app.get('/api/safety/zones', requireAuth, allowRoles(Role.TRAVELER), asyncRoute(async (_request, response) => {
  const zones = await prisma.safetyZone.findMany({ where: { reportCount: { gt: 0 } }, orderBy: { reportCount: 'desc' }, take: 1000 })
  return response.json({ zones: zones.map((zone) => ({ id: zone.id, latitude: zone.centerLat, longitude: zone.centerLng, reportCount: zone.reportCount, status: zone.aiStatus, reason: zone.aiReason, confidence: zone.aiConfidence, updatedAt: zone.updatedAt })) })
}))

app.post('/api/safety/interactions', requireAuth, allowRoles(Role.TRAVELER), asyncRoute(async (request, response) => {
  const input = z.object({ lat: z.number().finite().min(-90).max(90), lng: z.number().finite().min(-180).max(180) }).parse(request.body)
  const cell = safetyCell(input.lat, input.lng)
  await prisma.activityLog.create({ data: { userId: request.auth!.sub, action: 'SAFETY_MAP_CLICKED', metadata: { zoneKey: cell.key, latitude: input.lat, longitude: input.lng } } })
  return response.json({ ok: true })
}))

app.post('/api/safety/reports', requireAuth, allowRoles(Role.TRAVELER), asyncRoute(async (request, response) => {
  const input = safetyReportSchema.parse(request.body)
  if (input.tripId) {
    const trip = await prisma.trip.findFirst({ where: { id: input.tripId, userId: request.auth!.sub } })
    if (!trip) return response.status(404).json({ error: 'Trip not found.' })
  }
  const cell = safetyCell(input.lat, input.lng)
  const zone = await prisma.safetyZone.upsert({
    where: { zoneKey: cell.key },
    create: { zoneKey: cell.key, centerLat: cell.centerLat, centerLng: cell.centerLng, reportCount: 0 },
    update: {},
  })
  const report = await prisma.safetyReport.create({ data: { userId: request.auth!.sub, tripId: input.tripId || null, zoneId: zone.id, lat: input.lat, lng: input.lng, category: input.category || 'SAFETY_CONCERN', message: input.message || null } })
  const reportCount = await prisma.safetyReport.count({ where: { zoneId: zone.id } })
  const recentReports = await prisma.safetyReport.count({ where: { zoneId: zone.id, createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } } })
  const categories = await prisma.safetyReport.findMany({ where: { zoneId: zone.id }, select: { category: true }, distinct: ['category'], take: 20 })
  const decision = await decideSafetyZone({ reportCount, recentReports, categories: categories.map((item) => item.category), location: { latitude: cell.centerLat, longitude: cell.centerLng } })
  const updatedZone = await prisma.safetyZone.update({ where: { id: zone.id }, data: { reportCount, aiStatus: decision.status, aiReason: decision.reason, aiConfidence: decision.confidence } })
  await prisma.activityLog.create({ data: { userId: request.auth!.sub, action: 'SAFETY_REPORT_CREATED', metadata: { reportId: report.id, zoneId: zone.id, zoneKey: cell.key, latitude: input.lat, longitude: input.lng, category: report.category, reportCount, aiStatus: decision.status, aiConfidence: decision.confidence } } })
  publishEvent('safety-zone-updated', { zoneId: zone.id, status: decision.status, reportCount })
  return response.status(201).json({ report: { id: report.id, createdAt: report.createdAt }, zone: { id: updatedZone.id, latitude: updatedZone.centerLat, longitude: updatedZone.centerLng, reportCount: updatedZone.reportCount, status: updatedZone.aiStatus, reason: updatedZone.aiReason, confidence: updatedZone.aiConfidence, updatedAt: updatedZone.updatedAt } })
}))

// Admin console: platform-wide oversight (users, providers, audit trail, settings). Every route
// below is additive and gated to ADMIN only - it reads/updates existing tables plus the new
// single-row PlatformSettings, and never touches traveler/operator/vendor/coordinator behaviour.
app.get('/api/admin/safety-map', requireAuth, allowRoles(Role.ADMIN, Role.OPERATOR), asyncRoute(async (_request, response) => {
  const [zones, reports, clicks] = await Promise.all([
    prisma.safetyZone.findMany({ where: { reportCount: { gt: 0 } }, orderBy: { reportCount: 'desc' }, take: 1000 }),
    prisma.safetyReport.findMany({ include: { user: { select: { id: true, name: true, email: true } }, trip: { select: { id: true, destination: true } }, zone: { select: { id: true, reportCount: true, aiStatus: true, aiReason: true } } }, orderBy: { createdAt: 'desc' }, take: 500 }),
    prisma.activityLog.findMany({ where: { action: 'SAFETY_MAP_CLICKED' }, orderBy: { createdAt: 'desc' }, take: 1000 }),
  ])
  const clicksByZone = new Map<string, number>()
  clicks.forEach((click) => { const key = typeof click.metadata === 'object' && click.metadata && 'zoneKey' in click.metadata ? String(click.metadata.zoneKey) : ''; if (key) clicksByZone.set(key, (clicksByZone.get(key) || 0) + 1) })
  return response.json({
    zones: zones.map((zone) => ({ id: zone.id, latitude: zone.centerLat, longitude: zone.centerLng, reportCount: zone.reportCount, status: zone.aiStatus, reason: zone.aiReason, confidence: zone.aiConfidence, updatedAt: zone.updatedAt })),
    reports: reports.map((report) => ({ id: report.id, latitude: report.lat, longitude: report.lng, category: report.category, message: report.message, createdAt: report.createdAt, user: report.user, trip: report.trip, zone: report.zone })),
    clicks: clicks.map((click) => ({ id: click.id, createdAt: click.createdAt, metadata: click.metadata, userId: click.userId })),
    clicksByZone: Object.fromEntries(clicksByZone),
    summary: { totalReports: reports.length, totalZones: zones.length, unsafeZones: zones.filter((zone) => zone.aiStatus === 'UNSAFE').length, cautionZones: zones.filter((zone) => zone.aiStatus === 'CAUTION').length, totalClicks: clicks.length },
  })
}))

app.get('/api/admin/trips/pending', requireAuth, allowRoles(Role.ADMIN), asyncRoute(async (_request, response) => {
  const trips = await prisma.trip.findMany({ where: { approvalStatus: 'PENDING' }, include: { user: { select: { id: true, name: true, email: true } }, items: { include: { vendor: true }, orderBy: { startTime: 'asc' } }, adjustments: true }, orderBy: { updatedAt: 'desc' }, take: 200 })
  return response.json({ trips })
}))
app.post('/api/admin/trips/:id/review', requireAuth, allowRoles(Role.ADMIN), asyncRoute(async (request, response) => {
  const data = z.object({ decision: z.enum(['APPROVE', 'REQUEST_CHANGES']), feedback: z.string().trim().max(2000).optional() }).parse(request.body)
  const trip = await prisma.trip.findUnique({ where: { id: request.params.id as string }, include: { user: true, items: true } })
  if (!trip) return response.status(404).json({ error: 'Trip not found.' })
  if (trip.approvalStatus !== 'PENDING') return response.status(409).json({ error: 'This trip is not awaiting admin review.' })
  const approved = data.decision === 'APPROVE'
  const updated = await prisma.trip.update({ where: { id: trip.id }, data: { approvalStatus: approved ? 'APPROVED' : 'CHANGES_REQUESTED', status: approved ? 'APPROVED' : 'CHANGES_REQUESTED', adminFeedback: data.feedback || (approved ? 'Trip approved. Payment is now unlocked.' : 'Please review the requested changes.'), reviewedAt: new Date(), reviewedById: request.auth!.sub } })
  await prisma.activityLog.create({ data: { userId: request.auth!.sub, action: approved ? 'TRIP_ADMIN_APPROVED' : 'TRIP_CHANGES_REQUESTED', metadata: { tripId: trip.id, feedback: data.feedback || null } } })
  await notifyTrip(trip.id, approved ? 'TRIP_APPROVED' : 'TRIP_CHANGES_REQUESTED', approved ? 'Trip approved' : 'Changes requested', updated.adminFeedback || '')
  publishEvent(approved ? 'trip-approved' : 'trip-changes-requested', { tripId: trip.id })
  return response.json({ trip: updated })
}))

app.get('/api/admin/overview', requireAuth, allowRoles(Role.ADMIN), asyncRoute(async (_request, response) => {
  const [usersByRole, tripsByStatus, vendorCount, paidBookings, openDisruptions, pendingApprovals, recentActivity] = await Promise.all([
    prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
    prisma.trip.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.vendor.count(),
    prisma.booking.aggregate({ _sum: { amount: true }, where: { paymentStatus: PaymentStatus.PAID } }),
    prisma.disruption.count({ where: { status: 'OPEN' } }),
    prisma.recoveryPlan.count({ where: { status: 'PROPOSED' } }),
    prisma.activityLog.findMany({ orderBy: { createdAt: 'desc' }, take: 12 }),
  ])
  const actorIds = [...new Set(recentActivity.map((entry) => entry.userId).filter((id): id is string => Boolean(id)))]
  const actors = actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, role: true } }) : []
  const actorById = new Map(actors.map((actor) => [actor.id, actor]))
  return response.json({
    usersByRole: usersByRole.map((entry) => ({ role: entry.role, count: entry._count._all })),
    tripsByStatus: tripsByStatus.map((entry) => ({ status: entry.status, count: entry._count._all })),
    vendorCount,
    totalRevenue: paidBookings._sum.amount || 0,
    openDisruptions,
    pendingApprovals,
    recentActivity: recentActivity.map((entry) => ({ id: entry.id, action: entry.action, createdAt: entry.createdAt, metadata: entry.metadata, actor: entry.userId ? actorById.get(entry.userId) ?? null : null })),
  })
}))
app.get('/api/admin/users', requireAuth, allowRoles(Role.ADMIN), asyncRoute(async (request, response) => {
  const roleFilter = typeof request.query.role === 'string' ? request.query.role.toUpperCase() : undefined
  if (roleFilter && !(Object.values(Role) as string[]).includes(roleFilter)) return response.status(400).json({ error: 'Unknown role filter.' })
  const search = typeof request.query.search === 'string' ? request.query.search.trim() : ''
  const users = await prisma.user.findMany({
    where: { ...(roleFilter ? { role: roleFilter as Role } : {}), ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }] } : {}) },
    select: { id: true, name: true, email: true, role: true, phone: true, loyaltyPoints: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  return response.json({ users })
}))
app.patch('/api/admin/users/:id', requireAuth, allowRoles(Role.ADMIN), asyncRoute(async (request, response) => {
  const data = z.object({ role: z.nativeEnum(Role) }).parse(request.body)
  const target = await prisma.user.findUnique({ where: { id: request.params.id as string } })
  if (!target) return response.status(404).json({ error: 'User not found.' })
  if (target.role === Role.ADMIN && data.role !== Role.ADMIN && request.auth!.sub === target.id) return response.status(409).json({ error: 'You cannot remove your own admin access.' })
  const updated = await prisma.user.update({ where: { id: target.id }, data: { role: data.role }, select: { id: true, name: true, email: true, role: true, phone: true, loyaltyPoints: true, createdAt: true } })
  await prisma.activityLog.create({ data: { userId: request.auth!.sub, action: 'ADMIN_USER_ROLE_UPDATED', metadata: { targetUserId: updated.id, previousRole: target.role, nextRole: updated.role } } })
  return response.json({ user: updated })
}))
app.get('/api/admin/audit-logs', requireAuth, allowRoles(Role.ADMIN), asyncRoute(async (request, response) => {
  const actionFilter = typeof request.query.action === 'string' ? request.query.action.trim() : ''
  const entries = await prisma.activityLog.findMany({ where: actionFilter ? { action: { contains: actionFilter, mode: 'insensitive' } } : {}, orderBy: { createdAt: 'desc' }, take: 100 })
  const actorIds = [...new Set(entries.map((entry) => entry.userId).filter((id): id is string => Boolean(id)))]
  const actors = actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true, role: true } }) : []
  const actorById = new Map(actors.map((actor) => [actor.id, actor]))
  return response.json({ entries: entries.map((entry) => ({ id: entry.id, action: entry.action, createdAt: entry.createdAt, metadata: entry.metadata, actor: entry.userId ? actorById.get(entry.userId) ?? null : null })) })
}))
app.get('/api/admin/settings', requireAuth, allowRoles(Role.ADMIN), asyncRoute(async (_request, response) => {
  const settings = await prisma.platformSettings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton' }, update: {} })
  return response.json({ settings })
}))
app.patch('/api/admin/settings', requireAuth, allowRoles(Role.ADMIN), asyncRoute(async (request, response) => {
  const data = z.object({ platformName: z.string().trim().min(2).optional(), supportEmail: z.string().trim().email().optional(), maintenanceMode: z.boolean().optional(), bookingFeePercent: z.number().min(0).max(100).optional() }).parse(request.body)
  const settings = await prisma.platformSettings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', ...data }, update: data })
  await prisma.activityLog.create({ data: { userId: request.auth!.sub, action: 'ADMIN_SETTINGS_UPDATED', metadata: JSON.parse(JSON.stringify(data)) } })
  return response.json({ settings })
}))

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => { if (error instanceof z.ZodError) return response.status(400).json({ error: 'Validation failed.', details: error.flatten() }); if (error instanceof DestinationDiscoveryUnavailableError) return response.status(503).json({ error: error.message, retryable: true }); const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : ''; if (code === 'P2002') return response.status(409).json({ error: 'That record already exists.' }); if (code === 'P2025') return response.status(404).json({ error: 'The requested record no longer exists.' }); console.error(error); return response.status(500).json({ error: 'We could not complete that request. Please try again.' }) })
const port = Number(process.env.PORT || 4000)
app.listen(port, () => {
  console.log(`TripPilot API listening on http://localhost:${port}`)
  startWeatherCheckJob(prisma, publishEvent, publishNotification)
})
