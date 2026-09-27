export type WeatherRiskInput = { id: string; title: string; type: string; exposure: number; risk: number; expectedDelayMinutes: number }
export type NugenWeatherAssessment = { impacts: Array<{ id: string; risk: number; expectedDelayMinutes: number; rationale?: string }>; model: string; confidenceScore: number | null }

/** Invoke the project-specific Nugen-aligned model. Missing config and provider errors return null. */
export async function assessWeatherRisks(input: { destination: string; rainProbability: number; temperatureC: number; items: WeatherRiskInput[] }): Promise<NugenWeatherAssessment | null> {
  const apiKey = process.env.NUGEN_API_KEY
  const model = process.env.NUGEN_ALIGNED_MODEL_ID
  if (!apiKey || !model) return null
  const response = await fetch('https://api.nugen.in/api/v3/inference/chat/completions', {
    method: 'POST', signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, temperature: 0.1, max_tokens: 700, messages: [{ role: 'user', content: `You are Voyara's weather disruption analyst, aligned on hospitality and travel weather-impact examples. Estimate conditional disruption probabilities for the supplied real itinerary. Respect causal propagation: weather exposure can delay transfers/flights, which can affect hotel arrival and later activities; outdoor activities are directly exposed; indoor lodging is less directly exposed. The supplied heuristic estimates are priors, not ground truth. Return ONLY JSON with {"impacts":[{"id":"exact supplied id","risk":integer 0-100,"expectedDelayMinutes":integer 0-240,"rationale":"short causal explanation"}]}. Preserve one result per input id. Never claim bookings were changed. Destination ${input.destination}; counterfactual rain probability ${input.rainProbability}%; temperature ${input.temperatureC} C. Input items: ${JSON.stringify(input.items)}` }] }),
  })
  if (!response.ok) throw new Error(`Nugen inference returned HTTP ${response.status}`)
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }>; confidence_score?: number }
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('Nugen returned no assessment text')
  const parsed = JSON.parse(content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) as { impacts?: Array<{ id: string; risk: number; expectedDelayMinutes: number; rationale?: string }> }
  if (!Array.isArray(parsed.impacts)) throw new Error('Nugen response did not contain impacts')
  const byId = new Map(input.items.map(item => [item.id, item]))
  const impacts = parsed.impacts.flatMap(item => {
    if (!byId.has(item.id) || !Number.isFinite(item.risk) || !Number.isFinite(item.expectedDelayMinutes)) return []
    return [{ id: item.id, risk: Math.max(0, Math.min(100, Math.round(item.risk))), expectedDelayMinutes: Math.max(0, Math.min(240, Math.round(item.expectedDelayMinutes))), rationale: typeof item.rationale === 'string' ? item.rationale.slice(0, 240) : undefined }]
  })
  if (impacts.length !== input.items.length) throw new Error('Nugen returned incomplete item coverage')
  const confidence = data.confidence_score
  return { impacts, model, confidenceScore: typeof confidence === 'number' ? Math.max(0, Math.min(100, confidence)) : null }
}
