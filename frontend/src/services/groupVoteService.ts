import { apiRequest } from './apiClient'

export type TravelerGroupParticipant = { id: string; status: 'INVITED' | 'CONFIRMED' | 'DECLINED'; shareWeight?: number | null; user: { id: string; name: string; email: string } }
export type TravelerGroup = { id: string; name: string; participants: TravelerGroupParticipant[] }
export type VoteTally = { candidateInventoryId: string; title: string; yes: number; no: number }
export async function getTripGroup(tripId: string) { return (await apiRequest<{ group: TravelerGroup }>(`/trips/${tripId}/group`)).group }
export async function inviteToTripGroup(tripId: string, email: string) { return (await apiRequest<{ participant: TravelerGroupParticipant }>(`/trips/${tripId}/group/invite`, { method: 'POST', body: JSON.stringify({ email }) })).participant }
export async function respondToTripGroup(tripId: string, response: 'accept' | 'decline') { return (await apiRequest<{ participant: TravelerGroupParticipant }>(`/trips/${tripId}/group/respond`, { method: 'POST', body: JSON.stringify({ response }) })).participant }
export async function voteOnAlternative(tripId: string, itemId: string, candidateInventoryId: string, vote: 'YES' | 'NO') { return apiRequest(`/trips/${tripId}/items/${itemId}/vote`, { method: 'POST', body: JSON.stringify({ candidateInventoryId, vote }) }) }
export async function getItemVotes(tripId: string, itemId: string) { return apiRequest<{ tally: VoteTally[]; suggestion: VoteTally | null }>(`/trips/${tripId}/items/${itemId}/votes`) }
