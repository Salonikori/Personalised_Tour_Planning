import { apiRequest } from './apiClient'

export type MarketplaceCategory = 'FLIGHT' | 'HOTEL' | 'ACTIVITY' | 'TRANSFER'
export type VendorBid = { id: string; price: number; notes: string | null; status: 'PENDING' | 'ACCEPTED' | 'REJECTED'; createdAt: string; vendor: { id: string; name: string; category: string } }
export type SlotRequest = { id: string; tripId: string | null; destination: string; category: MarketplaceCategory; dateNeeded: string; budgetCap: number; status: 'OPEN' | 'AWARDED' | 'CLOSED'; createdAt: string; trip?: { id: string; destination: string } | null; bids?: VendorBid[]; myBid?: VendorBid | null }

export async function getOperatorSlotRequests() { return (await apiRequest<{ requests: SlotRequest[] }>('/operator/slot-requests')).requests }
export async function createOperatorSlotRequest(input: { tripId?: string | null; destination: string; category: MarketplaceCategory; dateNeeded: string; budgetCap: number }) { return (await apiRequest<{ request: SlotRequest }>('/operator/slot-requests', { method: 'POST', body: JSON.stringify(input) })).request }
export async function awardVendorBid(slotRequestId: string, bidId: string) { return apiRequest<{ request: SlotRequest; accepted: VendorBid; inventory: { id: string; title: string; price: number } }>(`/operator/slot-requests/${slotRequestId}/award`, { method: 'POST', body: JSON.stringify({ bidId }) }) }
export async function getVendorSlotRequests() { return (await apiRequest<{ requests: SlotRequest[] }>('/vendor/slot-requests')).requests }
export async function submitVendorBid(slotRequestId: string, price: number, notes: string) { return (await apiRequest<{ bid: VendorBid }>(`/vendor/slot-requests/${slotRequestId}/bid`, { method: 'POST', body: JSON.stringify({ price, notes: notes || undefined }) })).bid }
