import { ItemType, PrismaClient, type ItineraryItem } from '@prisma/client'
import { generateRecoveryNarratives } from './generationService.js'
import { analyzeImpact, buildProposals } from './recoveryService.js'
import type { PreferenceProfile } from './preferenceService.js'

export type CopilotContext = { trip: { id: string; destination: string; budget: number; travelStyle: string; user: { preferences: unknown } }; items: Array<ItineraryItem & { dependenciesFrom: Array<{ predecessorId: string; dependentId: string }>; booking: unknown }>; inventory: Array<{ id: string; type: ItemType; title: string; location: string; price: number; tags: unknown; vendor: { name: string; reliabilityScore: number } }> }

export const getItinerarySummary = (items: CopilotContext['items']) => ({ count: items.length, plannedCost: items.reduce((sum, item) => sum + item.cost, 0), nextItems: items.slice(0, 4).map((item) => ({ id: item.id, title: item.title, type: item.type, startTime: item.startTime, location: item.location, cost: item.cost })) })
export const getBudgetSummary = (trip: CopilotContext['trip'], items: CopilotContext['items']) => { const planned = items.reduce((sum, item) => sum + item.cost, 0); const committed = items.filter((item) => item.booking).reduce((sum, item) => sum + item.cost, 0); return { budget: trip.budget, planned, committed, remaining: trip.budget - committed, percentageUsed: Math.round((planned / trip.budget) * 100) } }
export const simulateBudgetChange = (trip: CopilotContext['trip'], items: CopilotContext['items'], delta: number) => { const current = getBudgetSummary(trip, items); const budget = Math.max(0, trip.budget + delta); return { ...current, budget, remaining: budget - current.committed, percentageUsed: Math.round((current.planned / budget) * 100), delta } }
export const getAvailableAlternatives = (context: CopilotContext, item: ItineraryItem, cheaperOnly = false) => context.inventory.filter((candidate) => candidate.type === item.type && candidate.id !== item.inventoryItemId && (!cheaperOnly || candidate.price < item.cost)).sort((a, b) => Number(b.location === item.location) - Number(a.location === item.location) || b.vendor.reliabilityScore - a.vendor.reliabilityScore || a.price - b.price).slice(0, 3)

export async function triggerDisruptionAnalysis(prisma: PrismaClient, context: CopilotContext, affected: ItineraryItem, type: 'delay' | 'cancellation' | 'weather' | 'availability', details: string) {
  const dependencies = context.items.flatMap((item) => item.dependenciesFrom.map((edge) => ({ predecessorId: edge.predecessorId, dependentId: edge.dependentId })))
  const impact = analyzeImpact(affected, context.items, dependencies, type, details)
  const impacted = context.items.filter((item) => impact.ids.includes(item.id))
  const recoveryTarget = impacted.find((item) => item.type === ItemType.ACTIVITY) || impacted[impacted.length - 1]
  const alternatives = getAvailableAlternatives(context, recoveryTarget)
  if (alternatives.length < 3) throw new Error('Not enough verified inventory alternatives are available.')
  const proposals = buildProposals(impacted, alternatives as never, { ...((context.trip.user.preferences || {}) as PreferenceProfile), travelStyle: context.trip.travelStyle })
  const narratives = await generateRecoveryNarratives({ disruption: `${type}: ${details}`, alternatives: proposals.map((proposal) => { const alternative = alternatives.find((candidate) => candidate.id === proposal.changedItems[0].replacementInventoryItemId)!; return { id: alternative.id, title: alternative.title, vendor: alternative.vendor.name } }) })
  proposals.forEach((proposal, index) => { proposal.explanation = narratives[index] || proposal.explanation })
  const disruption = await prisma.disruption.create({ data: { tripId: context.trip.id, affectedItemId: affected.id, type: type.toUpperCase(), severity: impact.severity, status: 'PROPOSED', details: `${details} ${impact.explanation}` } })
  const plans = await Promise.all(proposals.map((proposal) => prisma.recoveryPlan.create({ data: { disruptionId: disruption.id, changedItems: proposal.changedItems, extraCost: proposal.extraCost, timeDelta: proposal.timeDeltaMinutes, preferenceScore: proposal.preferenceMatchScore, vendorReliability: proposal.vendorReliability, finalScore: proposal.finalScore, explanation: proposal.explanation, status: 'PROPOSED' } })))
  return { id: disruption.id, affectedItemId: affected.id, severity: impact.severity, explanation: impact.explanation, affectedItems: impacted.map((item) => ({ id: item.id, title: item.title, type: item.type, status: item.status })), plans }
}

/** Localizes only human-readable Copilot prose. Structured recovery/swap payloads remain language-neutral. */
export async function localizeCopilotMessage(message: string, language = 'en') {
  const normalized = language.toLowerCase().split('-')[0]
  if (normalized === 'en' || !process.env.GROQ_API_KEY) return message
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        temperature: 0,
        messages: [
          { role: 'system', content: `Reply only with a faithful translation of the supplied Copilot message. Use language code "${normalized}". Preserve numbers, currency, proper nouns, product names, and meaning. Do not translate JSON or structured data; only translate the prose message.` },
          { role: 'user', content: message },
        ],
      }),
    })
    if (!response.ok) return message
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
    return payload.choices?.[0]?.message?.content?.trim() || message
  } catch {
    return message
  }
}
