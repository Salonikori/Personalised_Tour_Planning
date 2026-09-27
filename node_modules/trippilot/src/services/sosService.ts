import { apiRequest, subscribeToTripEvents } from './apiClient'

export type SosAlert = { id: string; tripId: string; userId: string; itineraryItemId: string | null; lat: number | null; lng: number | null; message: string | null; status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED'; createdAt: string; resolvedAt: string | null }
export type NearbyHelp = { id: string; name: string; type: string; distanceKm: number; latitude: number; longitude: number }
export async function createSos(tripId: string, payload: { itineraryItemId?: string; lat?: number | null; lng?: number | null; message?: string | null }) { return (await apiRequest<{ alert: SosAlert }>(`/trips/${tripId}/sos`, { method: 'POST', body: JSON.stringify(payload) })).alert }
export async function getLatestSos(tripId: string) { return (await apiRequest<{ alert: SosAlert | null }>(`/trips/${tripId}/sos`)).alert }
export async function getNearbyHelp(tripId: string) { return (await apiRequest<{ results: NearbyHelp[] }>(`/trips/${tripId}/nearby-help`)).results }
export function subscribeToSosUpdates(onUpdate: (payload: { tripId?: string; alertId?: string; status?: string }) => void) { return subscribeToTripEvents((event, payload) => { if (event === 'sos-created' || event === 'sos-updated') onUpdate(payload) }) }
