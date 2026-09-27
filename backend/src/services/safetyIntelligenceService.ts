import { z } from 'zod'

const decisionSchema = z.object({
  status: z.enum(['SAFE', 'CAUTION', 'UNSAFE']),
  reason: z.string().min(8).max(500),
  confidence: z.number().min(0).max(1),
})

export type SafetyDecisionInput = {
  reportCount: number
  recentReports: number
  categories: string[]
  location: { latitude: number; longitude: number }
}

export async function decideSafetyZone(input: SafetyDecisionInput) {
  const fallback = input.reportCount > 10
    ? { status: 'UNSAFE' as const, reason: `Groq was unavailable; ${input.reportCount} reports are concentrated in this area, crossing the configured concern threshold.`, confidence: 0.99 }
    : input.reportCount >= 5
      ? { status: 'CAUTION' as const, reason: `Groq was unavailable; ${input.reportCount} reports indicate a recurring safety concern.`, confidence: 0.8 }
      : { status: 'SAFE' as const, reason: 'No concentrated safety signal has crossed the configured concern threshold.', confidence: 0.65 }

  if (!process.env.GROQ_API_KEY) return fallback

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are Voyara Safety Intelligence. Decide the safety signal for a map zone from aggregated user reports. You control the classification; the admin has no classification controls. Treat more than 10 reports in one zone as a strong unsafe signal. Never identify or infer a person. Return only JSON: {"status":"SAFE|CAUTION|UNSAFE","reason":"...","confidence":0-1}.',
          },
          {
            role: 'user',
            content: JSON.stringify({ ...input, policy: 'More than 10 reports in one zone should normally be UNSAFE; 5-10 indicates CAUTION unless the report pattern clearly warrants UNSAFE.' }),
          },
        ],
      }),
      signal: AbortSignal.timeout(12_000),
    })
    if (!response.ok) return fallback
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
    return decisionSchema.parse(JSON.parse(payload.choices?.[0]?.message?.content || '{}'))
  } catch {
    return fallback
  }
}
