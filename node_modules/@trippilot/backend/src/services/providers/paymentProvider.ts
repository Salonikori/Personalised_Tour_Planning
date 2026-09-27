// Payment gateway integration behind the PAYMENT_PROVIDER env flag.
//
// PAYMENT_PROVIDER=stripe    -> StripePaymentProvider (needs STRIPE_SECRET_KEY, a real test-mode
//                                secret key). Confirms a PaymentIntent server-side using Stripe's
//                                documented always-succeeding test payment method (pm_card_visa),
//                                so checkout completes synchronously - no frontend widget required.
// PAYMENT_PROVIDER=razorpay  -> RazorpayPaymentProvider (needs RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET,
//                                real test-mode keys). Creates a real Razorpay Order via the Orders
//                                API. Razorpay does not allow raw card capture from a backend alone
//                                (that would defeat PCI-DSS scoping), so the order is completed the
//                                way Razorpay actually works in production: the client finishes
//                                payment with Razorpay Checkout, then calls
//                                POST /api/trips/:id/checkout/verify with the payment id + HMAC
//                                signature Razorpay returns, which verifyRazorpaySignature() checks.
// Anything else / missing keys -> SimulatedPaymentProvider, the original in-memory "always succeeds
//                                immediately" behavior. This is the safe default so the app keeps
//                                working out of the box with no keys configured.
//
// No provider here invents a *successful* payment - Stripe/Razorpay failures propagate as FAILED
// and the caller (server.ts) must not mark a Booking PAID unless a real success came back.

import crypto from 'node:crypto'

export type ChargeParams = {
  amount: number
  currency: string
  receipt: string
  notes?: Record<string, string>
}

export type ChargeResult =
  | { status: 'PAID'; providerRef: string; raw?: unknown }
  | { status: 'PENDING_VERIFICATION'; providerRef: string; checkout: { provider: 'razorpay'; keyId: string; orderId: string; amount: number; currency: string }; raw?: unknown }
  | { status: 'FAILED'; providerRef?: string; reason: string; raw?: unknown }

export interface PaymentProvider {
  readonly name: string
  isConfigured(): boolean
  charge(params: ChargeParams): Promise<ChargeResult>
}

// ---------------------------------------------------------------------------
// Simulated (fallback) provider - unchanged behavior from the original flow.
// ---------------------------------------------------------------------------
export class SimulatedPaymentProvider implements PaymentProvider {
  readonly name = 'Simulated'

  isConfigured() {
    return true
  }

  async charge(_params: ChargeParams): Promise<ChargeResult> {
    return { status: 'PAID', providerRef: `sim_${crypto.randomUUID()}` }
  }
}

// ---------------------------------------------------------------------------
// Stripe test-mode integration.
// ---------------------------------------------------------------------------
export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'Stripe'

  isConfigured() {
    return Boolean(process.env.STRIPE_SECRET_KEY)
  }

  async charge(params: ChargeParams): Promise<ChargeResult> {
    if (!this.isConfigured()) return { status: 'FAILED', reason: 'Stripe is not configured (missing STRIPE_SECRET_KEY).' }
    const body = new URLSearchParams({
      amount: String(Math.round(params.amount * 100)),
      currency: params.currency.toLowerCase(),
      payment_method: 'pm_card_visa', // Stripe's documented test token that always succeeds in test mode.
      confirm: 'true',
      off_session: 'true',
      description: `TripPilot checkout ${params.receipt}`,
    })
    for (const [key, value] of Object.entries(params.notes || {})) body.append(`metadata[${key}]`, value)
    let response: Response
    try {
      response = await fetch('https://api.stripe.com/v1/payment_intents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(15_000),
      })
    } catch (error) {
      return { status: 'FAILED', reason: `Stripe request failed: ${(error as Error).message}` }
    }
    const payload = (await response.json()) as { id?: string; status?: string; error?: { message?: string } }
    if (!response.ok || !payload.id) return { status: 'FAILED', reason: payload.error?.message || `Stripe returned ${response.status}`, raw: payload }
    if (payload.status !== 'succeeded') return { status: 'FAILED', providerRef: payload.id, reason: `Stripe PaymentIntent status was "${payload.status}", not "succeeded".`, raw: payload }
    return { status: 'PAID', providerRef: payload.id, raw: payload }
  }
}

// ---------------------------------------------------------------------------
// Razorpay test-mode integration.
// ---------------------------------------------------------------------------
export class RazorpayPaymentProvider implements PaymentProvider {
  readonly name = 'Razorpay'

  isConfigured() {
    return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)
  }

  async charge(params: ChargeParams): Promise<ChargeResult> {
    if (!this.isConfigured()) return { status: 'FAILED', reason: 'Razorpay is not configured (missing RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET).' }
    const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64')
    let response: Response
    try {
      response = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Math.round(params.amount * 100), // paise
          currency: params.currency.toUpperCase(),
          receipt: params.receipt,
          notes: params.notes || {},
        }),
        signal: AbortSignal.timeout(15_000),
      })
    } catch (error) {
      return { status: 'FAILED', reason: `Razorpay request failed: ${(error as Error).message}` }
    }
    const payload = (await response.json()) as { id?: string; amount?: number; currency?: string; error?: { description?: string } }
    if (!response.ok || !payload.id) return { status: 'FAILED', reason: payload.error?.description || `Razorpay returned ${response.status}`, raw: payload }
    return {
      status: 'PENDING_VERIFICATION',
      providerRef: payload.id,
      checkout: { provider: 'razorpay', keyId: process.env.RAZORPAY_KEY_ID as string, orderId: payload.id, amount: payload.amount ?? Math.round(params.amount * 100), currency: payload.currency ?? params.currency.toUpperCase() },
      raw: payload,
    }
  }
}

// Verifies the HMAC-SHA256 signature Razorpay returns to the client after Checkout completes -
// the standard way to confirm a Razorpay payment server-side without ever touching card data.
export function verifyRazorpaySignature(orderId: string, paymentId: string, signature: string): boolean {
  if (!process.env.RAZORPAY_KEY_SECRET) return false
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  } catch {
    return false
  }
}

export const simulatedPaymentProvider = new SimulatedPaymentProvider()
export const stripePaymentProvider = new StripePaymentProvider()
export const razorpayPaymentProvider = new RazorpayPaymentProvider()

// Picks the provider named by PAYMENT_PROVIDER, falling back to the simulated flow whenever the
// flag is unset, unrecognized, or the named provider is missing its test keys - mirroring how
// FALLBACK_CATALOG_MODE degrades gracefully elsewhere in this codebase instead of throwing at request time.
export function getActivePaymentProvider(): PaymentProvider {
  const flag = (process.env.PAYMENT_PROVIDER || '').trim().toLowerCase()
  if (flag === 'stripe' && stripePaymentProvider.isConfigured()) return stripePaymentProvider
  if (flag === 'razorpay' && razorpayPaymentProvider.isConfigured()) return razorpayPaymentProvider
  if (flag === 'stripe' || flag === 'razorpay') {
    console.warn(`[payments] PAYMENT_PROVIDER=${flag} but its test keys are not set - falling back to the simulated payment flow.`)
  }
  return simulatedPaymentProvider
}
