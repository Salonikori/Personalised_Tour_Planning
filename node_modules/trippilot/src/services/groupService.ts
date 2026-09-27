import { apiRequest } from './apiClient'

export type GroupParticipantStatus = 'INVITED' | 'CONFIRMED' | 'DECLINED'
export type GroupParticipant = {
  id: string
  status: GroupParticipantStatus
  itineraryStatus: GroupParticipantStatus
  user: { id: string; name: string; email: string }
}
export type TourGroup = {
  id: string
  name: string
  trip: { id: string; destination: string; startDate: string; endDate: string; status: string }
  operator: { id: string; name: string; email: string }
  coordinator: { id: string; name: string; email: string } | null
  participants: GroupParticipant[]
  createdAt: string
  updatedAt: string
}
export type DirectoryUser = { id: string; name: string; email: string; role: string }

export async function getGroups() {
  return (await apiRequest<{ groups: TourGroup[] }>('/groups')).groups
}
export async function getGroup(id: string) {
  return (await apiRequest<{ group: TourGroup }>(`/groups/${id}`)).group
}
export async function createGroup(input: { tripId: string; name: string; coordinatorId?: string | null }) {
  return (await apiRequest<{ group: TourGroup }>('/groups', { method: 'POST', body: JSON.stringify(input) })).group
}
export async function assignCoordinator(groupId: string, coordinatorId: string | null) {
  return (await apiRequest<{ group: TourGroup }>(`/groups/${groupId}/coordinator`, { method: 'PATCH', body: JSON.stringify({ coordinatorId }) })).group
}
export async function addParticipant(groupId: string, userId: string, status?: GroupParticipantStatus) {
  return (await apiRequest<{ participant: GroupParticipant }>(`/groups/${groupId}/participants`, { method: 'POST', body: JSON.stringify({ userId, status }) })).participant
}
export async function getUsersByRole(role: string) {
  return (await apiRequest<{ users: DirectoryUser[] }>(`/users?role=${encodeURIComponent(role)}`)).users
}
