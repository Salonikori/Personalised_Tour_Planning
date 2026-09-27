import { apiRequest, subscribeToTripEvents } from './apiClient'
import type { UserRole } from '../types/auth'

export type AdminOverview = {
  usersByRole: Array<{ role: string; count: number }>
  tripsByStatus: Array<{ status: string; count: number }>
  vendorCount: number
  totalRevenue: number
  openDisruptions: number
  pendingApprovals: number
  recentActivity: Array<{ id: string; action: string; createdAt: string; metadata: Record<string, unknown> | null; actor: { id: string; name: string; role: string } | null }>
}
export async function getAdminOverview() { return apiRequest<AdminOverview>('/admin/overview') }
export function subscribeToAdminUpdates(onUpdate: () => void) { return subscribeToTripEvents(() => onUpdate()) }

export type AdminUser = { id: string; name: string; email: string; role: string; phone: string | null; loyaltyPoints: number; createdAt: string }
export async function getAdminUsers(params?: { role?: UserRole; search?: string }) {
  const query = new URLSearchParams()
  if (params?.role) query.set('role', params.role.toUpperCase())
  if (params?.search) query.set('search', params.search)
  const suffix = query.toString() ? `?${query.toString()}` : ''
  return (await apiRequest<{ users: AdminUser[] }>(`/admin/users${suffix}`)).users
}
export async function updateAdminUserRole(id: string, role: UserRole) { return (await apiRequest<{ user: AdminUser }>(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ role: role.toUpperCase() }) })).user }

export type AuditLogEntry = { id: string; action: string; createdAt: string; metadata: Record<string, unknown> | null; actor: { id: string; name: string; email: string; role: string } | null }
export async function getAuditLogs(action?: string) { return (await apiRequest<{ entries: AuditLogEntry[] }>(`/admin/audit-logs${action ? `?action=${encodeURIComponent(action)}` : ''}`)).entries }

export type PlatformSettings = { id: string; platformName: string; supportEmail: string; maintenanceMode: boolean; bookingFeePercent: number; updatedAt: string }
export async function getPlatformSettings() { return (await apiRequest<{ settings: PlatformSettings }>('/admin/settings')).settings }
export async function updatePlatformSettings(input: Partial<Pick<PlatformSettings, 'platformName' | 'supportEmail' | 'maintenanceMode' | 'bookingFeePercent'>>) { return (await apiRequest<{ settings: PlatformSettings }>('/admin/settings', { method: 'PATCH', body: JSON.stringify(input) })).settings }

export type AdminReviewTrip = {
  id: string; destination: string; origin: string | null; startDate: string; endDate: string; budget: number; travelerCount: number; tripType: string; travelStyle: string; status: string; approvalStatus: string; adminFeedback: string | null; requestedPlaces: unknown; requestedActivities: unknown; requestedActivityDays: unknown; companyName: string | null; user: { id: string; name: string; email: string }; items: Array<{ id: string; title: string; type: string; startTime: string; endTime: string; location: string; cost: number; vendor?: { name: string } | null }>
}
export async function getPendingTripReviews() { return (await apiRequest<{ trips: AdminReviewTrip[] }>('/admin/trips/pending')).trips }
export async function reviewTrip(id: string, decision: 'APPROVE' | 'REQUEST_CHANGES', feedback?: string) { return (await apiRequest<{ trip: AdminReviewTrip }>(`/admin/trips/${id}/review`, { method: 'POST', body: JSON.stringify({ decision, feedback }) })).trip }
