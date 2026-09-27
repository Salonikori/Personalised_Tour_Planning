import { apiRequest, ApiUnavailableError, subscribeToTripEvents } from './apiClient'

const activeTripKey = 'trippilot-active-trip-id'
const activeAffectedItemKey = 'trippilot-active-affected-item-id'
export type ApiTrip = { id: string; origin?: string | null; destination: string; startDate: string; endDate: string; budget: number; travelerCount?: number; tripType?: string; travelStyle: string; status: string; approvalStatus?: string; adminFeedback?: string | null; requestedPlaces?: unknown; requestedActivities?: unknown; requestedActivityDays?: unknown; companyName?: string | null; operator?: { supportPhone?: string } | null }
export type CreateTripInput = Omit<ApiTrip, 'id' | 'operator'> & { interests?: string[]; pace?: number; requestedPlaces?: string[]; requestedActivities?: string[]; requestedActivityDays?: Record<string,string> }
export type ApiItem = { id: string; title: string; type: string; startTime: string; endTime: string; location: string; cost: number; status: string; currency?: string; nativeAmount?: number; vendor?: { name: string } | null }
export const activeTrip = { get: () => localStorage.getItem(activeTripKey), set: (id: string) => localStorage.setItem(activeTripKey, id) }
export const activeAffectedItem = { get: () => localStorage.getItem(activeAffectedItemKey), set: (id: string) => localStorage.setItem(activeAffectedItemKey, id), clear: () => localStorage.removeItem(activeAffectedItemKey) }
export async function createTrip(input: CreateTripInput) { const result = await apiRequest<{ trip: ApiTrip }>('/trips', { method: 'POST', body: JSON.stringify(input) }); activeTrip.set(result.trip.id); return result.trip }
export async function getTrips() { return (await apiRequest<{ trips: ApiTrip[] }>('/trips')).trips }
export async function getTrip(id: string) { return (await apiRequest<{ trip: ApiTrip }>(`/trips/${id}`)).trip }
export async function submitTripForReview(id: string) { return (await apiRequest<{ trip: ApiTrip }>(`/trips/${id}/submit-review`, { method: 'POST' })).trip }
export type TripAdjustment = { id: string; type: 'ADDITIONAL_CHARGE' | 'REFUND'; amount: number; reason: string; status: string; createdAt: string }
export async function getTripAdjustments(id: string) { return (await apiRequest<{ adjustments: TripAdjustment[] }>(`/trips/${id}/adjustments`)).adjustments }

export async function getItinerary(id: string) { return (await apiRequest<{ items: ApiItem[] }>(`/trips/${id}/itinerary`)).items }
export async function getTripGraph(id: string, affectedItemId?: string) { return apiRequest<{ nodes: unknown[]; edges: unknown[]; affectedItemIds: string[] }>(`/trips/${id}/graph${affectedItemId ? `?affectedItemId=${affectedItemId}` : ''}`) }
export type WeatherTwin = { destination: string; location: { latitude: number; longitude: number }; current?: Record<string, number|string>; forecast?: { time: string[]; temperature_2m_max: number[]; precipitation_sum: number[]; precipitation_probability_max: number[]; weather_code: number[] }; modelInference?: { provider: 'nugen-aligned' | 'local-estimate'; model: string | null; confidenceScore: number | null; error?: string }; scenario: { rainProbability: number; temperatureC: number; expectedAffectedItems: number; meanDisruptionProbability: number; impacts: Array<{ id: string; title: string; type: string; location: string; startTime: string; exposure: number; risk: number; expectedDelayMinutes: number; status: string; rationale?: string }> }; socialSignals: Array<{ title: string; url: string; source: string; date: string }> }
export async function getWeatherTwin(id: string, rain: number, temperature: number) { return apiRequest<WeatherTwin>(`/trips/${id}/weather-twin?rain=${rain}&temperature=${temperature}`) }
export type GeneratedComposerItem = { id: string; type: string; title: string; startTime: string; endTime: string; location: string; cost: number; vendor: string; reasoning: string; preferenceScore: number; image?: string }
export type GeneratedComposer = { days: Array<{ day: number; items: GeneratedComposerItem[] }>; budget: { plannedCost: number; budget: number; remainingBudget: number; percentageUsed: number }; preferenceScore: number }
export async function generateItinerary(id: string, discoverySummary?: string, changeRequest?: string) { const body: { discoverySummary?: string; changeRequest?: string } = {}; if (discoverySummary) body.discoverySummary = discoverySummary; if (changeRequest) body.changeRequest = changeRequest; return apiRequest<GeneratedComposer>(`/trips/${id}/generate-itinerary`, { method: 'POST', body: JSON.stringify(body) }) }
// Predefined ready-made itineraries: a fixed, browsable template library the traveler can pick
// from instead of leaving every selection empty and relying on auto-generation alone.
export type ItineraryTemplate = { id: string; name: string; tagline: string; description: string; icon: string; tripType: string; travelStyle: string; pace: number; interestTags: string[]; recommendedDays: { min: number; max: number }; recommendedBudgetTier: 'budget' | 'standard' | 'premium' }
export async function getItineraryTemplates() { return (await apiRequest<{ templates: ItineraryTemplate[] }>('/itinerary-templates')).templates }
export async function applyItineraryTemplate(id: string, templateId: string) { return apiRequest<GeneratedComposer & { template: { id: string; name: string } }>(`/trips/${id}/apply-template`, { method: 'POST', body: JSON.stringify({ templateId }) }) }
export type BudgetCategory = 'flights' | 'hotel' | 'activities' | 'food'
export type CategoryWeights = Record<BudgetCategory, number>
export type CategoryAllocation = { category: BudgetCategory; label: string; weight: number; allocatedBudget: number; actualSpend: number; utilization: number; overAllocated: boolean; overBy: number; itemCount: number }
export type SwapSuggestion = { category: BudgetCategory; overBy: number; candidates: Array<{ id: string; title: string; cost: number }>; projectedSavings: number; closesGap: boolean; message: string }
export type BudgetAllocation = { totalBudget: number; weights: CategoryWeights; categories: CategoryAllocation[]; overAllocatedCategories: BudgetCategory[]; suggestions: SwapSuggestion[]; fullyRebalanced: boolean }
export type WalletSummary = { planned: number; committed: number; paid: number; remaining: number; budget: number; budgetOverflow: boolean; carbonKg?: number; allocation?: BudgetAllocation; costPerParticipant?: number | null; participantShares?: Array<{ id: string; userId: string; name: string; email: string; shareWeight: number; amount: number }> }
export async function getWallet(id: string) { return (await apiRequest<{ wallet: WalletSummary }>(`/trips/${id}/wallet`)).wallet }
export async function updateBudgetWeights(id: string, weights: CategoryWeights) { return (await apiRequest<{ summary: WalletSummary }>(`/trips/${id}/budget-weights`, { method: 'PATCH', body: JSON.stringify(weights) })).summary }
export type CurrencySummary = { homeCurrency: string; subtotal: number; unavailableConversions: number; items: Array<{ itineraryItemId: string; nativeAmount: number; currency: string; convertedAmount: number | null; rate: number | null; rateDate: string | null; rateCached: boolean }> }
export async function getCurrencySummary(id: string) { return apiRequest<CurrencySummary>(`/trips/${id}/currency-summary`) }
export type CheckoutConfirmation = { traveler: { name: string; email: string }; destination: string; startDate: string; endDate: string; itinerary: Array<{ id: string; title: string; vendor: string; amount: number; startTime: string }>; bookings: Array<{ id: string; itineraryItemId: string; vendorId: string; amount: number; confirmationStatus: string; paymentStatus: string }>; totalCost: number; wallet: WalletSummary }
// Razorpay orders can't be captured server-only (see paymentProvider.ts), so checkout can also come
// back "pending verification": the caller opens Razorpay Checkout with `checkout`, then calls
// verifyCheckoutPayment() with what Razorpay hands back to finish the booking.
export type RazorpayCheckoutOrder = { provider: 'razorpay'; keyId: string; orderId: string; amount: number; currency: string }
export type CheckoutResult = { status: 'paid'; confirmation: CheckoutConfirmation } | { status: 'requires_verification'; provider: string; checkout: RazorpayCheckoutOrder; totalCost: number }
export async function checkoutTrip(id: string): Promise<CheckoutResult> {
  const result = await apiRequest<{ confirmation?: CheckoutConfirmation; requiresPaymentVerification?: boolean; provider?: string; checkout?: RazorpayCheckoutOrder; totalCost?: number }>(`/trips/${id}/checkout`, { method: 'POST' })
  if (result.requiresPaymentVerification && result.checkout) return { status: 'requires_verification', provider: result.provider || 'Razorpay', checkout: result.checkout, totalCost: result.totalCost || 0 }
  return { status: 'paid', confirmation: result.confirmation as CheckoutConfirmation }
}
export async function verifyCheckoutPayment(id: string, payload: { orderId: string; paymentId: string; signature: string }) { return (await apiRequest<{ confirmation: CheckoutConfirmation }>(`/trips/${id}/checkout/verify`, { method: 'POST', body: JSON.stringify(payload) })).confirmation }
export type TripSimulation = { simulationId: string; currentItinerary: Array<{ id: string; title: string; type: string; cost: number; startTime: string; endTime: string; location: string }>; simulatedItinerary: Array<{ itineraryItemId: string; title: string; type: string; cost: number; startTime: string; endTime: string; location: string }>; currentCost: number; simulatedCost: number; costDelta: number; timeDelta: number; preferenceScoreDelta: number; currentCarbonKg?: number; simulatedCarbonKg?: number; carbonDeltaKg?: number; budgetImpact: { currentBudget: number; simulatedBudget: number; remaining: number; overflow: boolean }; changes: Array<{ itineraryItemId: string }> }
export async function simulateTrip(id: string, input: { budgetDelta?: number; durationDays?: number; hotelTier?: 'cheaper' | 'standard' | 'premium' }) { return apiRequest<TripSimulation>(`/trips/${id}/simulate`, { method: 'POST', body: JSON.stringify(input) }) }
export async function applySimulation(id: string, simulationId: string) { return apiRequest<{ wallet: WalletSummary }>(`/trips/${id}/simulations/${simulationId}/apply`, { method: 'POST' }) }
export type CompletedTrip = { trip: { id: string; destination: string; status: string }; recap: Array<{ time: string; title: string; note: string; type: string }>; spend: Array<{ name: string; value: number }>; vendors: Array<{ id: string; name: string }>; reviews: Array<{ vendorId: string; rating: number; tags: string[]; comment?: string | null }>; preferences: { interests?: string[]; weights?: Record<string, number> }; loyaltyPoints: number; referralCode: string }
export async function getCompletedTrip(id: string) { return apiRequest<CompletedTrip>(`/trips/${id}/complete`) }
export async function submitReview(id: string, review: { vendorId: string; rating: number; tags: string[]; comment?: string }) { return apiRequest<{ preferences: CompletedTrip['preferences']; pointsEarned: number; loyaltyPoints: number }>(`/trips/${id}/reviews`, { method: 'POST', body: JSON.stringify(review) }) }
export async function updateItineraryItem(id: string, data: { startTime?: string; endTime?: string }) { return apiRequest<{ item: ApiItem; summary: WalletSummary }>(`/itinerary-items/${id}`, { method: 'PATCH', body: JSON.stringify(data) }) }
export async function removeItineraryItem(id: string) { return apiRequest<{ summary: WalletSummary }>(`/itinerary-items/${id}`, { method: 'DELETE' }) }
export async function reorderItinerary(id: string, items: Array<{ id: string; startTime: string; endTime: string }>) { return apiRequest<{ items: ApiItem[]; summary: WalletSummary }>(`/trips/${id}/itinerary/reorder`, { method: 'POST', body: JSON.stringify({ items }) }) }
export function notifyTripUpdated() { window.dispatchEvent(new Event('trippilot:trip-updated')) }
export function subscribeToLiveTripUpdates() { return subscribeToTripEvents((_event, payload) => { if (!payload.tripId || payload.tripId === activeTrip.get()) notifyTripUpdated() }) }
export async function getVendors() { return (await apiRequest<{ vendors: unknown[] }>('/vendors')).vendors }
export async function getBookings() { return (await apiRequest<{ bookings: unknown[] }>('/bookings')).bookings }
export type InventoryItem = { id: string; title: string; type: string; price: number; location: string; vendor: { name: string; reliabilityScore?: number } }
export async function getInventory(tripId?: string) { return (await apiRequest<{ inventory: InventoryItem[] }>(`/inventory${tripId ? `?tripId=${encodeURIComponent(tripId)}` : ''}`)).inventory }
export async function addItineraryItem(tripId: string, inventoryItemId: string, startTime: string, endTime: string) { return apiRequest<{ item: ApiItem; summary: WalletSummary }>(`/trips/${tripId}/itinerary`, { method: 'POST', body: JSON.stringify({ inventoryItemId, startTime, endTime }) }) }
export async function swapItineraryItem(id: string, inventoryItemId: string) { return apiRequest<{ item: ApiItem; summary: WalletSummary }>(`/itinerary-items/${id}/swap`, { method: 'POST', body: JSON.stringify({ inventoryItemId }) }) }
export type RecoveryPlan = { id: string; extraCost: number; timeDelta: number; preferenceScore: number; vendorReliability: number; finalScore: number; explanation: string; status: string }
export const recoveryDecisionModes = ['cheapest', 'fastest', 'comfort', 'experience', 'balanced'] as const
export type DecisionMode = typeof recoveryDecisionModes[number]
export type DisruptionResult = { disruption: { id: string; affectedItemId: string; severity: string; explanation: string; decisionMode: DecisionMode; affectedItems: Array<{ id: string; title: string; type: string; status: string }>; plans: RecoveryPlan[] } }
export async function disruptTrip(id: string, affectedItemId: string, disruptionType: 'delay' | 'cancellation' | 'weather' | 'availability', details: string, decisionMode: DecisionMode = 'balanced') { return apiRequest<DisruptionResult>(`/trips/${id}/disrupt`, { method: 'POST', body: JSON.stringify({ affectedItemId, disruptionType, details, decisionMode }) }) }
export async function approveRecovery(id: string) { return apiRequest<{ plan: { id: string; status: string }; wallet?: WalletSummary }>(`/recovery-plans/${id}/approve`, { method: 'POST' }) }
export async function rejectRecovery(id: string) { return apiRequest<{ plan: { id: string; status: string } }>(`/recovery-plans/${id}/reject`, { method: 'POST' }) }
export async function revertRecovery(id: string) { return apiRequest<{ wallet: WalletSummary }>(`/recovery-plans/${id}/revert`, { method: 'POST' }) }
export type CopilotRecovery = { id: string; affectedItemId: string; severity: string; explanation: string; affectedItems: Array<{ id: string; title: string; type: string }>; plans: RecoveryPlan[] }
export type CopilotResponse = { message: string; action: 'recovery_options' | 'alternatives' | 'budget_simulation' | 'itinerary_summary' | 'trip_summary'; structuredData: { recovery?: CopilotRecovery; itemId?: string; alternatives?: Array<{ id: string; title: string; location: string; cost: number; vendor: string; reliability: number }>; budget?: WalletSummary; remaining?: number; percentageUsed?: number; nextItems?: Array<{ id: string; title: string; location: string; cost: number; startTime: string }> } }
export async function sendCopilotMessage(id: string, message: string, language: string, conversationHistory: Array<{ role: 'user' | 'assistant'; text: string }>) { return apiRequest<CopilotResponse>(`/trips/${id}/copilot-message`, { method: 'POST', body: JSON.stringify({ message, language, conversationHistory }) }) }
export type ChecklistCategory = 'DOCUMENT' | 'PACKING' | 'REMINDER'
export type ChecklistItem = { id: string; tripId: string; category: ChecklistCategory; label: string; isDone: boolean; source: 'AUTO' | 'MANUAL'; createdAt: string }
export async function getChecklist(id: string) { return (await apiRequest<{ items: ChecklistItem[] }>(`/trips/${id}/checklist`)).items }
export async function toggleChecklistItem(tripId: string, itemId: string, isDone: boolean) { return (await apiRequest<{ item: ChecklistItem }>(`/trips/${tripId}/checklist/${itemId}`, { method: 'PATCH', body: JSON.stringify({ isDone }) })).item }
export async function addChecklistItem(tripId: string, category: ChecklistCategory, label: string) { return (await apiRequest<{ item: ChecklistItem }>(`/trips/${tripId}/checklist`, { method: 'POST', body: JSON.stringify({ category, label }) })).item }
export { ApiUnavailableError }
