import { apiRequest, subscribeToTripEvents } from './apiClient'
import { approveRecovery, rejectRecovery, type RecoveryPlan } from './tripService'

export type OperatorTrip = { id: string; destination: string; traveler: { id: string; name: string; email: string }; coordinatorId?: string | null; budget: number; plannedCost: number; riskLevel: 'low' | 'medium' | 'high' | 'critical'; openDisruptions: number; pendingApprovals: number; bookingProblems: number; scheduleConflicts: boolean; updatedAt: string }
export type OperatorKpis = { activeTours: number; upcomingTours: number; pendingBookings: number; toursAtRisk: number; issuesRequiringAction: number; pendingApprovals: number; totalRevenue: number }
export type OperatorDisruption = { id: string; type: string; severity: string; status: string; details: string; timestamp: string; trip: { id: string; destination: string; traveler: string }; affectedItem: { id: string; title: string; type: string }; nodes: Array<{ id: string; data: { label: string }; position: { x: number; y: number } }>; edges: Array<{ id: string; source: string; target: string }>; plans: RecoveryPlan[] }
export async function getOperatorTrips() { return apiRequest<{ trips: OperatorTrip[]; kpis: OperatorKpis }>('/operator/trips') }
export async function getOperatorDisruptions() { return (await apiRequest<{ disruptions: OperatorDisruption[] }>('/operator/disruptions')).disruptions }
export type OperatorPayment = { id: string; vendor: string; tourReference: string; amount: number; confirmationStatus: string; paymentStatus: 'PENDING' | 'PAID' | 'REFUNDED'; date: string; auditEvents: Array<{ id: string; event: string; amount: number; createdAt: string }> }
export type OperatorPayments = { kpis: { totalPaid: number; totalPending: number; refundsInProgress: number }; bookings: OperatorPayment[]; settlements: Array<{ vendor: string; paid: number; pending: number; refunded: number }> }
export async function getOperatorPayments() { return apiRequest<OperatorPayments>('/operator/payments') }
export type OperatorAnalytics = { cancellations: Array<{ label: string; value: number }>; preferenceMatch: Array<{ week: string; score: number }>; patterns: Array<{ name: string; value: number }>; disruptions: Array<{ label: string; value: number }>; averagePreferenceMatch: number }
export async function getOperatorAnalytics() { return apiRequest<OperatorAnalytics>('/operator/analytics') }
export type Vendor = { id: string; name: string; category: string; availability: string; priceRange: string; reliabilityScore: number; confirmationRate: number; cancellationRate: number; responseTime: number; user?: { name: string; email: string; phone: string | null } | null }
export type CreateVendorInput = Omit<Vendor, 'id' | 'user'>
export async function getVendors() { return (await apiRequest<{ vendors: Vendor[] }>('/vendors')).vendors }
export async function createVendor(input: CreateVendorInput) { return (await apiRequest<{ vendor: Vendor }>('/vendors', { method: 'POST', body: JSON.stringify(input) })).vendor }
export async function updateVendor(id: string, input: Partial<Pick<Vendor, 'availability' | 'priceRange' | 'reliabilityScore' | 'confirmationRate' | 'cancellationRate' | 'responseTime'>>) { return (await apiRequest<{ vendor: Vendor }>(`/vendors/${id}`, { method: 'PATCH', body: JSON.stringify(input) })).vendor }
export async function editRecoveryPlan(id: string, explanation: string) { return apiRequest<{ plan: RecoveryPlan }>(`/recovery-plans/${id}`, { method: 'PATCH', body: JSON.stringify({ explanation }) }) }
export { approveRecovery, rejectRecovery }
export function subscribeToOperatorUpdates(onUpdate: () => void) { return subscribeToTripEvents(() => onUpdate()) }

export type OperatorCustomer = { id: string; name: string; email: string; phone: string | null; createdAt: string; trips: Array<{ id: string; destination: string; startDate: string; endDate: string; status: string; budget: number; bookedItems: number }> }
export type OperatorCoordinator = { id: string; name: string; email: string; phone: string | null; supportPhone: string | null; assignedTours: number }
export type OperatorInventory = { id: string; vendorId: string; type: 'FLIGHT' | 'HOTEL' | 'ACTIVITY' | 'TRANSFER'; title: string; location: string; price: number; availability: string; tags: string[]; details: Record<string, unknown> | null; source: string; bookable: boolean; vendor: { id: string; name: string; category: string } }
export type OperatorScheduleItem = { id: string; title: string; type: string; startTime: string; endTime: string; location: string; status: string; tripId: string; destination: string; traveler: { id: string; name: string; email: string }; vendor: { id: string; name: string; category: string } | null; bookingStatus: string | null }
export async function getOperatorCustomers() { return (await apiRequest<{ customers: OperatorCustomer[] }>('/operator/customers')).customers }
export async function getOperatorCoordinators() { return (await apiRequest<{ coordinators: OperatorCoordinator[] }>('/operator/coordinators')).coordinators }
export async function getOperatorInventory() { return (await apiRequest<{ inventory: OperatorInventory[] }>('/operator/inventory')).inventory }
export async function createOperatorInventory(input: { vendorId: string; type: OperatorInventory['type']; title: string; location: string; price: number; availability: string; tags: string[]; details: Record<string, unknown> | null }) { return (await apiRequest<{ inventory: OperatorInventory }>('/operator/inventory', { method: 'POST', body: JSON.stringify(input) })).inventory }
export async function updateOperatorInventory(id: string, input: Partial<Pick<OperatorInventory, 'title' | 'location' | 'price' | 'availability' | 'tags' | 'details'>>) { return (await apiRequest<{ inventory: OperatorInventory }>(`/operator/inventory/${id}`, { method: 'PATCH', body: JSON.stringify(input) })).inventory }
export async function deleteOperatorInventory(id: string) { return apiRequest<{ ok: true }>(`/operator/inventory/${id}`, { method: 'DELETE' }) }
export async function getOperatorSchedule() { return (await apiRequest<{ schedule: OperatorScheduleItem[] }>('/operator/schedule')).schedule }
export async function getCoordinatorSchedule() { return (await apiRequest<{ schedule: OperatorScheduleItem[] }>('/coordinator/schedule')).schedule }
export async function updateOperatorItineraryItem(id: string, input: { title: string; location: string; startTime: string; endTime: string }) { return apiRequest<{ item: OperatorScheduleItem }>(`/itinerary-items/${id}`, { method: 'PATCH', body: JSON.stringify(input) }) }
export async function assignTripCoordinator(tripId: string, coordinatorId: string | null) { return apiRequest<{ trip: { id: string; destination: string; coordinatorId: string | null } }>(`/operator/trips/${tripId}/coordinator`, { method: 'PATCH', body: JSON.stringify({ coordinatorId }) }) }
