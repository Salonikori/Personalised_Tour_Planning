import { z } from 'zod'

const resultSchema = z.object({
  days: z
    .array(
      z.object({
        day: z.number().int().positive(),
        items: z.array(
          z.object({
            itineraryItemId: z.string().min(1),
            suggestedStartTime: z.string().min(1),
            suggestedEndTime: z.string().min(1),
            reasoning: z.string().min(8),
          })
        ),
      })
    )
    .min(1),
})

export type GeneratedItinerary = z.infer<typeof resultSchema>

export type AiInventory = {
  id: string
  title: string
  type: string
  location: string
  price?: number
  tags: unknown
}

export type AiConstraints = {
  destination: string
  startDate: Date
  endDate: Date
  budget: number
  preferences: unknown
  inventory: AiInventory[]
  // Optional, best-effort context from the live travel-discovery pass (travelDiscoveryEngineService.ts
  // -> a short summary built client-side). This ONLY ever reaches the prompt text below - it's
  // never parsed back out, never added to `inventory`, and curatedGeneration() (the no-API-key path)
  // ignores it completely. It can influence the wording of `reasoning` strings; it can never
  // change which itineraryItemId gets selected, since that's still constrained to `inventory` and
  // re-verified by the caller in server.ts regardless of what the model returns.
  discoverySummary?: string
  requiredItems?: Array<{ title: string; day?: string }>
  // Free-text instructions from the traveler when they hit "Regenerate itinerary with following
  // changes" on an already-composed trip (e.g. "less walking", "swap day 2 for a beach day",
  // "cheaper hotels"). Only ever influences prompt wording/selection like the other preference
  // fields above - the model is still constrained to `inventory` and re-verified by the caller.
  changeRequest?: string
}

function promptFor(input: AiConstraints) {
  const days = Math.max(
    1,
    Math.ceil(
      (input.endDate.getTime() - input.startDate.getTime()) / 86_400_000
    )
  )

  const requiredContext = input.requiredItems?.length ? ` The traveler explicitly selected these places/activities and they MUST be included when possible: ${JSON.stringify(input.requiredItems)}. If a day is supplied, schedule that item on that day; otherwise choose a sensible day. If a selected item has no time, choose the best available time automatically.` : ''

  const discoveryContext = input.discoverySummary
    ? ` Live destination-discovery context, for background/reasoning flavor only - it is NOT bookable inventory and must never be used as an itineraryItemId: ${input.discoverySummary}`
    : ''

  const changeContext = input.changeRequest
    ? ` The traveler previously saw a version of this itinerary and asked for these specific changes - prioritize honoring them over the general preferences above wherever the verified inventory allows: "${input.changeRequest}".`
    : ''

  return `You are TripPilot's itinerary planner. Return ONLY JSON matching this exact schema: {"days":[{"day":1,"items":[{"itineraryItemId":"inventory-id","suggestedStartTime":"2026-06-12T09:00:00.000Z","suggestedEndTime":"2026-06-12T11:00:00.000Z","reasoning":"short personalized explanation"}]}]}. Destination: ${input.destination}. Duration: ${days} days. Budget: ${input.budget}. Traveler preferences: ${JSON.stringify(input.preferences)}.${requiredContext} You may ONLY select an itineraryItemId from this inventory; never invent vendors, titles, prices, or IDs: ${JSON.stringify(input.inventory)}.${discoveryContext}${changeContext}`
}

async function askGroq(input: AiConstraints) {
  const response = await fetch(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        temperature: 0.25,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'Return strictly valid JSON and use only supplied inventory IDs.',
          },
          {
            role: 'user',
            content: promptFor(input),
          },
        ],
      }),
    }
  )

  if (!response.ok) {
    throw new Error(`Groq request failed with ${response.status}.`)
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string
      }
    }>
  }

  return resultSchema.parse(
    JSON.parse(payload.choices?.[0]?.message?.content || '{}')
  )
}

function curatedGeneration(input: AiConstraints): GeneratedItinerary {
  const days = Math.max(
    1,
    Math.ceil(
      (input.endDate.getTime() - input.startDate.getTime()) / 86_400_000
    )
  )

  const required = input.requiredItems || []
  const requiredTitles = required.map((item) => item.title.toLowerCase())
  const requiredInventory = input.inventory.filter((item) => requiredTitles.some((title) => item.title.toLowerCase() === title || item.title.toLowerCase().includes(title)))
  const rest = input.inventory.filter((item) => !requiredInventory.includes(item))
  const affordable = [...requiredInventory, ...rest.sort((a, b) => (a.price || 0) - (b.price || 0))]

  const picks = Array.from(
    { length: days * 2 },
    (_, index) => affordable[index % affordable.length]
  )

  const byDay = Array.from({ length: days }, (_, index) => ({
    day: index + 1,
    items: picks
      .slice(index * 2, index * 2 + 2)
      .map((item, position) => ({
        itineraryItemId: item.id,
        suggestedStartTime: new Date(
          input.startDate.getTime() +
            index * 86_400_000 +
            (9 + position * 4) * 3_600_000
        ).toISOString(),
        suggestedEndTime: new Date(
          input.startDate.getTime() +
            index * 86_400_000 +
            (11 + position * 4) * 3_600_000
        ).toISOString(),
        reasoning: `Selected from verified ${item.type.toLowerCase()} inventory to fit your travel preferences and day ${
          index + 1
        } pace.`,
      })),
  }))

  return resultSchema.parse({ days: byDay })
}

export async function generateWithGroq(input: AiConstraints) {
  if (!process.env.GROQ_API_KEY) {
    console.log(
      '⚠️ MODEL PROVIDER: Local fallback (GROQ_API_KEY missing)'
    )
    return curatedGeneration(input)
  }

  try {
    console.log(
      '🤖 MODEL PROVIDER: Groq (openai/gpt-oss-120b)'
    )

    return await askGroq(input)
  } catch (error) {
    console.error(
      '❌ GROQ FAILED - USING LOCAL FALLBACK:',
      error instanceof Error ? error.message : error
    )

    return curatedGeneration(input)
  }
}

export async function generateRecoveryNarratives(input: {
  disruption: string
  alternatives: Array<{
    id: string
    title: string
    vendor: string
  }>
}) {
  const fallback = input.alternatives.map(
    (alternative) =>
      `Use verified ${alternative.title} from ${alternative.vendor} to restore the itinerary with the lowest practical disruption.`
  )

  if (!process.env.GROQ_API_KEY) {
    return fallback
  }

  const response = await fetch(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You propose recovery language only. Never invent inventory, vendors, prices, or changes.',
          },
          {
            role: 'user',
            content: `For ${
              input.disruption
            }, draft exactly 3 recovery strategies. Return only JSON {"strategies":[{"name":"...","changedItems":["verified-inventory-id"],"extraCost":0,"timeDeltaMinutes":0,"preferenceMatchScore":0,"explanation":"..."}]}. The numeric fields are descriptive only and are recalculated by the server. Use exactly one of these verified alternatives per strategy and no others: ${JSON.stringify(
              input.alternatives
            )}`,
          },
        ],
      }),
    }
  )

  if (!response.ok) {
    return fallback
  }

  try {
    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string
        }
      }>
    }

    const parsed = JSON.parse(
      data.choices?.[0]?.message?.content || '{}'
    ) as {
      strategies?: Array<{
        explanation?: string
      }>
    }

    const explanations = parsed.strategies
      ?.map((strategy) => strategy.explanation)
      .filter(
        (explanation): explanation is string =>
          typeof explanation === 'string' && explanation.length > 0
      )

    return explanations?.length === input.alternatives.length
      ? explanations
      : fallback
  } catch {
    return fallback
  }
}

export type CopilotIntent =
  | 'disruption'
  | 'hotel_alternatives'
  | 'budget_simulation'
  | 'itinerary_summary'
  | 'trip_summary'

export async function classifyCopilotIntent(
  message: string,
  context: unknown
): Promise<CopilotIntent | null> {
  if (!process.env.GROQ_API_KEY) {
    return null
  }

  try {
    const response = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                'Classify the request into one permitted backend tool intent. Do not claim a change was applied. Return only JSON {"intent":"disruption|hotel_alternatives|budget_simulation|itinerary_summary|trip_summary"}.',
            },
            {
              role: 'user',
              content: JSON.stringify({
                message,
                context,
              }),
            },
          ],
        }),
      }
    )

    if (!response.ok) {
      return null
    }

    const payload = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string
        }
      }>
    }

    const intent = JSON.parse(
      payload.choices?.[0]?.message?.content || '{}'
    ).intent

    return [
      'disruption',
      'hotel_alternatives',
      'budget_simulation',
      'itinerary_summary',
      'trip_summary',
    ].includes(intent)
      ? intent
      : null
  } catch {
    return null
  }
}