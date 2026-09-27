import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { authService } from '../services/authService'
import type { AuthUser, LoginCredentials, RegisterPayload, UserRole } from '../types/auth'

type AuthContextValue = { user: AuthUser | null; role: UserRole | null; isAuthenticated: boolean; loading: boolean; login: (credentials: LoginCredentials) => Promise<AuthUser>; register: (payload: RegisterPayload) => Promise<AuthUser>; completeOnboarding: () => void; logout: () => void }
const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => authService.getCurrentUser())
  const [loading, setLoading] = useState(false)
  const value = useMemo<AuthContextValue>(() => ({
    user, role: user?.role ?? null, isAuthenticated: Boolean(user), loading,
    async login(credentials) { setLoading(true); try { const nextUser = await authService.login(credentials); setUser(nextUser); return nextUser } finally { setLoading(false) } },
    async register(payload) { setLoading(true); try { const nextUser = await authService.register(payload); setUser(nextUser); return nextUser } finally { setLoading(false) } },
    completeOnboarding() { if (!user) return; const nextUser = { ...user, onboardingComplete: true }; authService.updateSession(nextUser); setUser(nextUser) },
    logout() { authService.logout(); setUser(null) },
  }), [loading, user])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() { const context = useContext(AuthContext); if (!context) throw new Error('useAuth must be used inside AuthProvider'); return context }
