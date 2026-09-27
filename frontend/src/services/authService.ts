import { ApiUnavailableError, apiRequest, clearApiToken, setApiToken } from './apiClient'
import type { AuthUser, LoginCredentials, RegisterPayload, UserRole } from '../types/auth'

type StoredUser = AuthUser & { passwordHash?: string; seeded?: boolean }
type ApiUser = { id: string; name: string; email: string; phone?: string | null; role: 'TRAVELER' | 'OPERATOR' | 'VENDOR' | 'COORDINATOR' | 'ADMIN'; preferences?: unknown; vendorId?: string | null; currentLocation?: string | null }
const sessionKey = 'trippilot-auth-session'
const usersKey = 'trippilot-auth-users'
const samplePassword = 'TripPilotAccess!'
const sampleUsers: StoredUser[] = [{ id: 'sample-traveler', name: 'Saloni Sharma', email: 'traveler@trippilot.io', role: 'traveler', onboardingComplete: false, seeded: true }, { id: 'sample-operator', name: 'Alex Morgan', email: 'operator@trippilot.io', role: 'operator', onboardingComplete: true, seeded: true }, { id: 'sample-vendor', name: 'Mika Tanaka', email: 'vendor@trippilot.io', role: 'vendor', onboardingComplete: true, seeded: true }, { id: 'sample-admin', name: 'Priya Nair', email: 'admin@trippilot.io', role: 'admin', onboardingComplete: true, seeded: true }]
const toRole = (role: ApiUser['role']): UserRole => role.toLowerCase() as UserRole
const toAuthUser = (user: ApiUser): AuthUser => ({ id: user.id, name: user.name, email: user.email, phone: user.phone ?? undefined, role: toRole(user.role), onboardingComplete: Boolean((user.preferences as { onboardingComplete?: boolean } | null)?.onboardingComplete), vendorId: user.vendorId ?? undefined, currentLocation: user.currentLocation ?? undefined })
function fingerprint(password: string, email: string) { let hash = 2166136261; for (const char of `${email.toLowerCase()}:trippilot:${password}`) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619) } return `tp_${(hash >>> 0).toString(16)}` }
function storedUsers() { try { const raw = localStorage.getItem(usersKey); return raw ? [...sampleUsers, ...(JSON.parse(raw) as StoredUser[])] : sampleUsers } catch { return sampleUsers } }
function safeUser(user: StoredUser): AuthUser { const { passwordHash: _passwordHash, seeded: _seeded, ...result } = user; return result }
function saveSession(user: AuthUser, remember: boolean) { const target = remember ? localStorage : sessionStorage; localStorage.removeItem(sessionKey); sessionStorage.removeItem(sessionKey); target.setItem(sessionKey, JSON.stringify(user)) }
async function localLogin({ email, password, role, remember, currentLocation }: LoginCredentials) { const user = storedUsers().find((candidate) => candidate.email.toLowerCase() === email.toLowerCase()); if (!user || user.role !== role || (user.seeded ? password !== samplePassword : user.passwordHash !== fingerprint(password, user.email))) throw new Error('Incorrect email, password, or role. Try the provided sample credentials.'); const result = safeUser(user); if (currentLocation) result.currentLocation = currentLocation; saveSession(result, remember); return result }

export const authService = {
  async login(credentials: LoginCredentials): Promise<AuthUser> {
    try { const result = await apiRequest<{ user: ApiUser; token: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ email: credentials.email, password: credentials.password, role: credentials.role.toUpperCase(), currentLocation: credentials.currentLocation }) }); const user = toAuthUser(result.user); setApiToken(result.token, credentials.remember); saveSession(user, credentials.remember); return user } catch (error) { if (error instanceof ApiUnavailableError) return localLogin(credentials); throw error }
  },
  async register(payload: RegisterPayload): Promise<AuthUser> {
    try { const result = await apiRequest<{ user: ApiUser; token: string }>('/auth/register', { method: 'POST', body: JSON.stringify({ ...payload, role: payload.role.toUpperCase() }) }); const user = toAuthUser(result.user); setApiToken(result.token); saveSession(user, true); return user } catch (error) { if (!(error instanceof ApiUnavailableError)) throw error; if (storedUsers().some((user) => user.email.toLowerCase() === payload.email.toLowerCase())) throw new Error('An account with this email already exists.'); const user: StoredUser = { id: `user-${Date.now()}`, name: payload.name, email: payload.email.toLowerCase(), phone: payload.phone, role: payload.role, onboardingComplete: payload.role !== 'traveler', passwordHash: fingerprint(payload.password, payload.email) }; localStorage.setItem(usersKey, JSON.stringify([...storedUsers().filter((item) => !item.seeded), user])); const result = safeUser(user); saveSession(result, true); return result }
  },
  getCurrentUser(): AuthUser | null { for (const storage of [localStorage, sessionStorage]) { const raw = storage.getItem(sessionKey); if (raw) try { return JSON.parse(raw) as AuthUser } catch { storage.removeItem(sessionKey) } } return null },
  logout() { localStorage.removeItem(sessionKey); sessionStorage.removeItem(sessionKey); clearApiToken() },
  updateSession(user: AuthUser) { const target = localStorage.getItem(sessionKey) ? localStorage : sessionStorage; target.setItem(sessionKey, JSON.stringify(user)); const raw = localStorage.getItem(usersKey); if (raw) try { const users = JSON.parse(raw) as StoredUser[]; localStorage.setItem(usersKey, JSON.stringify(users.map((stored) => stored.id === user.id ? { ...stored, onboardingComplete: user.onboardingComplete } : stored))) } catch { /* Local fallback data is optional. */ } },
}
export const roleLabel: Record<UserRole, string> = { traveler: 'Traveler', operator: 'Tour Operator', vendor: 'Vendor', coordinator: 'Tour Coordinator', admin: 'Platform Admin' }
const roleLabelKeys: Record<UserRole, string> = { traveler: 'roles.traveler', operator: 'roles.operator', vendor: 'roles.vendor', coordinator: 'roles.coordinator', admin: 'roles.admin' }
export function roleLabelKey(role: UserRole): string { return roleLabelKeys[role] }
