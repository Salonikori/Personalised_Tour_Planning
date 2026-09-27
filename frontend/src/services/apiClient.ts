const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000/api'
const tokenKey = 'trippilot-api-token'

export class ApiUnavailableError extends Error {}
export function getApiToken() { return localStorage.getItem(tokenKey) || sessionStorage.getItem(tokenKey) }
export function setApiToken(token: string, remember = true) { const target = remember ? localStorage : sessionStorage; localStorage.removeItem(tokenKey); sessionStorage.removeItem(tokenKey); target.setItem(tokenKey, token) }
export function clearApiToken() { localStorage.removeItem(tokenKey); sessionStorage.removeItem(tokenKey) }

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try { response = await fetch(`${apiUrl}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(getApiToken() ? { Authorization: `Bearer ${getApiToken()}` } : {}), ...init.headers } }) } catch { throw new ApiUnavailableError('TripPilot API is unavailable.') }
  const body = await response.json().catch(() => ({})) as { error?: string } & T
  if (!response.ok) throw new Error(body.error || 'The request could not be completed.')
  return body as T
}
export function subscribeToTripEvents(onEvent: (event: string, payload: { tripId?: string; disruptionId?: string; planId?: string; alertId?: string; status?: string }) => void) {
  const token = getApiToken(); if (!token) return () => undefined
  const url = `${apiUrl.replace(/\/api$/, '')}/api/events?token=${encodeURIComponent(token)}`
  const source = new EventSource(url)
  ;['disruption-created', 'recovery-traveler-approved', 'recovery-approved', 'recovery-rejected', 'recovery-reverted', 'recovery-edited', 'checkout-completed', 'simulation-applied', 'review-submitted', 'sos-created', 'sos-updated', 'coordinator-assigned', 'operator-schedule-updated'].forEach((event) => source.addEventListener(event, (message) => { try { onEvent(event, JSON.parse((message as MessageEvent).data)) } catch { /* malformed event ignored */ } }))
  return () => source.close()
}

export type ApiNotification = { id: string; type: string; title: string; message: string; tripId: string | null; readAt: string | null; createdAt: string }
export async function getNotifications() { return (await apiRequest<{ notifications: ApiNotification[] }>('/notifications')).notifications }
export async function markNotificationRead(id: string) { return apiRequest<{ ok: true }>(`/notifications/${id}/read`, { method: 'PATCH' }) }
export function subscribeToNotifications(onNotification: (notification: ApiNotification) => void) {
  const token = getApiToken(); if (!token) return () => undefined
  const url = `${apiUrl.replace(/\/api$/, '')}/api/events?token=${encodeURIComponent(token)}`
  const source = new EventSource(url)
  source.addEventListener('notification', (message) => { try { onNotification(JSON.parse((message as MessageEvent).data) as ApiNotification) } catch { /* malformed event ignored */ } })
  return () => source.close()
}


